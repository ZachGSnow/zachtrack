import { ZONES } from '../data/zones';

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  return Notification.requestPermission();
}

function notify(title: string, body: string) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  try {
    new Notification(title, { body, icon: '/pwa-192.png', badge: '/pwa-192.png' });
  } catch {
    // Some browsers (notably iOS Safari outside of an installed PWA) throw
    // when constructing Notification directly; fail silently in that case.
  }
}

/**
 * Schedules a browser notification for every future zone milestone of an
 * active fast. Only fires while this tab/app stays open in the foreground or
 * background - true background push requires a server + the Push API
 * (planned for a later phase alongside cloud sync).
 */
export function scheduleZoneMilestones(startTime: number): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  const now = Date.now();

  for (const zone of ZONES) {
    if (zone.hourStart === 0) continue; // "fed" milestone fires immediately at start; skip the noise
    const fireAt = startTime + zone.hourStart * 60 * 60 * 1000;
    const delay = fireAt - now;
    if (delay <= 0) continue;
    // setTimeout is capped at ~24.8 days (2^31 - 1 ms); our longest zone
    // boundary (48h) is well within range.
    const timer = setTimeout(() => notify('SnowFast', zone.milestone), delay);
    timers.push(timer);
  }

  return () => timers.forEach(clearTimeout);
}
