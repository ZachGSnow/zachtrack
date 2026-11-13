import { getDevice } from '../db';

/**
 * Daily reminders on this device (ARCHITECTURE.md 3.73): the browser's push
 * subscription, and what and when to remind, kept by the server
 * (/api/push), which sends them from the scheduled Worker. Each device turns
 * them on for itself; Settings > Reminders (RemindersSection.svelte) shows
 * this store.
 */

export interface ReminderChoices {
  remindAt: string;
  include: { habits: boolean; tasks: boolean; dates: boolean };
  /** Name what's due; off, the notification only gives counts, since the lock screen shows it. */
  named: boolean;
}

export const DEFAULT_CHOICES: ReminderChoices = { remindAt: '20:00', include: { habits: true, tasks: true, dates: true }, named: false };

type State = 'loading' | 'unsupported' | 'not set up' | 'blocked' | 'off' | 'on';

function urlBase64ToBytes(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const s = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function api<T>(body?: unknown): Promise<T> {
  const response = await fetch('/api/push', {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    redirect: 'manual',
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.type === 'opaqueredirect' || response.status === 401) throw new Error('Your login expired: log in again, then try once more.');
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`);
  return data;
}

class RemindersStore {
  state = $state<State>('loading');
  choices = $state<ReminderChoices>(structuredClone(DEFAULT_CHOICES));
  lastSentOn = $state<string | null>(null);
  busy = $state(false);
  error = $state('');
  /** A short note after an action: "Saved", "Test sent". */
  note = $state('');
  private publicKey: string | null = null;

  private supported() {
    return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  private async subscription(): Promise<PushSubscription | null> {
    const registration = await navigator.serviceWorker.ready;
    return registration.pushManager.getSubscription();
  }

  /** Reads this device's state: the browser's permission and subscription, and the server's copy of the choices. */
  async load() {
    this.error = '';
    if (!this.supported()) {
      this.state = 'unsupported';
      return;
    }
    try {
      this.publicKey = (await api<{ publicKey: string | null }>()).publicKey;
      if (!this.publicKey) {
        this.state = 'not set up';
        return;
      }
      if (Notification.permission === 'denied') {
        this.state = 'blocked';
        return;
      }
      const sub = await this.subscription();
      const saved = sub ? (await api<{ settings: (ReminderChoices & { lastSentOn: string | null }) | null }>({ action: 'get', endpoint: sub.endpoint })).settings : null;
      if (saved) {
        this.choices = { remindAt: saved.remindAt, include: { ...saved.include }, named: saved.named };
        this.lastSentOn = saved.lastSentOn;
        this.state = 'on';
      } else {
        this.state = 'off';
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
      this.state = 'off';
    }
  }

  private async run(work: () => Promise<void>) {
    this.busy = true;
    this.error = '';
    this.note = '';
    try {
      await work();
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  private async send(sub: PushSubscription) {
    const json = sub.toJSON();
    const device = await getDevice();
    const saved = await api<{ settings: { lastSentOn: string | null } }>({
      action: 'save',
      endpoint: sub.endpoint,
      keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      deviceId: device.id,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      remindAt: this.choices.remindAt,
      include: { ...this.choices.include },
      named: this.choices.named,
    });
    this.lastSentOn = saved.settings.lastSentOn;
  }

  /** Asks for permission, subscribes this device and saves its choices. */
  enable() {
    return this.run(async () => {
      if (!this.publicKey) throw new Error('Reminders are not set up on the server.');
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        this.state = permission === 'denied' ? 'blocked' : 'off';
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const sub =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(this.publicKey) }));
      await this.send(sub);
      this.state = 'on';
      this.note = 'Reminders are on.';
    });
  }

  /** Saves changed choices (time, what to include, wording). */
  save() {
    return this.run(async () => {
      const sub = await this.subscription();
      if (!sub) {
        this.state = 'off';
        throw new Error('This device is no longer subscribed: turn reminders on again.');
      }
      await this.send(sub);
      this.note = 'Saved.';
    });
  }

  /** Unsubscribes this device and tells the server to forget it. */
  disable() {
    return this.run(async () => {
      const sub = await this.subscription();
      if (sub) {
        await api({ action: 'delete', endpoint: sub.endpoint }).catch(() => undefined);
        await sub.unsubscribe();
      }
      this.state = 'off';
      this.note = 'Reminders are off on this device.';
    });
  }

  /** Sends a sample notification now, to see that it arrives. */
  test() {
    return this.run(async () => {
      const sub = await this.subscription();
      if (!sub) throw new Error('Turn reminders on first.');
      const { outcome } = await api<{ outcome: 'sent' | 'gone' | 'failed' }>({ action: 'test', endpoint: sub.endpoint });
      if (outcome === 'gone') {
        await sub.unsubscribe();
        this.state = 'off';
        throw new Error('The browser dropped this subscription: turn reminders on again.');
      }
      if (outcome === 'failed') throw new Error('The push service did not take it. Try again in a minute.');
      this.note = 'Test sent. It should arrive within a minute.';
    });
  }
}

export const reminders = new RemindersStore();
