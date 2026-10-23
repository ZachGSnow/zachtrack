<script lang="ts">
  import { syncStore } from '../stores/sync.svelte';
  import { pluralize } from '../utils/syncHistory';

  // Settings > Sync: Sign out, and Sign out and erase this device. Both go
  // through Cloudflare Access's sign-out page, which ends the login on every
  // device. Erasing asks for a confirmation that says what would be deleted
  // and whether anything hasn't reached the server.

  type EraseCheck = Awaited<ReturnType<typeof syncStore.prepareErase>>;
  let step = $state<'idle' | 'checking' | 'confirm' | 'working'>('idle');
  let check = $state<EraseCheck | undefined>(undefined);
  let error = $state<string | undefined>(undefined);

  async function signOut() {
    if (
      !confirm(
        'Sign out? Cloudflare ends the login on every device, so each one asks for the email code again before it syncs. Your data stays on this device.',
      )
    )
      return;
    step = 'working';
    await syncStore.signOut();
  }

  async function startErase() {
    error = undefined;
    step = 'checking';
    check = await syncStore.prepareErase();
    step = 'confirm';
  }

  async function erase() {
    step = 'working';
    try {
      await syncStore.eraseAndSignOut();
    } catch {
      error = 'Could not erase this device. Close the app everywhere else and try again.';
      step = 'confirm';
    }
  }

  const summary = $derived(
    check
      ? [
          pluralize(check.counts.trackableEntries, 'entry', 'entries'),
          pluralize(check.counts.fasts, 'fast'),
          pluralize(check.counts.trackableDefinitions, 'trackable'),
          pluralize(check.counts.fieldDefinitions, 'field'),
        ].join(', ')
      : '',
  );
</script>

<div class="space-y-2 border-t pt-3" style="border-color: var(--color-border);">
  <p class="text-xs text-text-muted">
    Signing out ends the Cloudflare login on every device, not just this one: each asks for the email code again before it
    syncs. Erase also deletes everything stored here; your data stays on the server and your other devices.
  </p>
  <div class="flex flex-wrap gap-2">
    <button
      class="rounded-lg border px-3 py-1.5 text-sm text-text-muted"
      style="border-color: var(--color-border);"
      disabled={step !== 'idle'}
      onclick={signOut}>Sign out</button
    >
    <button
      class="rounded-lg border px-3 py-1.5 text-sm"
      style="border-color: #f87171; color: #f87171;"
      disabled={step !== 'idle'}
      onclick={startErase}>Sign out and erase this device</button
    >
  </div>

  {#if step === 'checking'}
    <p class="text-xs text-text-muted" role="status">Sending this device's changes first...</p>
  {:else if (step === 'confirm' || step === 'working') && check}
    <div role="alertdialog" aria-labelledby="erase-title" aria-describedby="erase-body" class="space-y-2 rounded-lg border p-3 text-sm" style="border-color: #f87171; background: var(--color-surface);">
      <p id="erase-title" class="font-semibold text-text">Erase this device and sign out?</p>
      <div id="erase-body" class="space-y-1 text-xs text-text-muted">
        <p>This deletes everything the app stores here ({summary}, plus settings and sync history), then signs out every device.</p>
        {#if check.waiting > 0}
          <p class="font-semibold" style="color: #f87171;">
            {pluralize(check.waiting, 'change')} on this device {check.waiting === 1 ? "hasn't" : "haven't"} reached the server and will be lost.
          </p>
        {:else if !check.synced}
          <p>The server couldn't be reached just now, but every change here had already synced.</p>
        {:else}
          <p>Every change here is on the server, so nothing is lost: log in again on this device to get it all back.</p>
        {/if}
      </div>
      {#if error}<p class="text-xs" style="color: #f87171;">{error}</p>{/if}
      <div class="flex flex-wrap gap-2">
        <button
          class="rounded-lg px-3 py-1.5 text-sm font-semibold"
          style="background: #dc2626; color: #fff;"
          disabled={step === 'working'}
          onclick={erase}>Erase and sign out</button
        >
        <button
          class="rounded-lg border px-3 py-1.5 text-sm text-text-muted"
          style="border-color: var(--color-border);"
          disabled={step === 'working'}
          onclick={() => {
            step = 'idle';
            check = undefined;
          }}>Cancel</button
        >
      </div>
    </div>
  {/if}
</div>
