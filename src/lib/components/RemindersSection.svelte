<script lang="ts">
  import { onMount } from 'svelte';
  import { reminders } from '../stores/reminders.svelte';
  import HelpLink from './HelpLink.svelte';

  // Settings > Reminders (3.73): a daily notification on this device of what
  // is due, sent by the server at the time chosen here. Each device turns it
  // on for itself.
  onMount(() => {
    void reminders.load();
  });

  const box = 'rounded-lg border bg-transparent p-2 text-sm text-text border-border';
</script>

<section class="space-y-3" aria-labelledby="settings-reminders">
  <h2 id="settings-reminders" class="flex items-center gap-1.5 text-sm font-semibold uppercase tracking-wide text-text-muted">
    <span>Reminders</span> <HelpLink topic="reminders" label="daily reminders" />
  </h2>

  {#if reminders.state === 'loading'}
    <p class="text-sm text-text-muted">Checking this device...</p>
  {:else if reminders.state === 'unsupported'}
    <p class="text-sm text-text-muted">This browser can't show notifications from the app. On Android, install ZachTrack to the home screen from Chrome; on an iPhone, add it to the home screen first.</p>
  {:else if reminders.state === 'not set up'}
    <p class="text-sm text-text-muted">Reminders aren't set up on the server yet (README, "Reminders").</p>
  {:else if reminders.state === 'blocked'}
    <p class="text-sm text-text-muted">Notifications are blocked for ZachTrack. Allow them in the phone's settings for the app (or the site's settings in the browser), then come back here.</p>
  {:else if reminders.state === 'off'}
    <p class="text-sm text-text-muted">A notification once a day, at a time you pick, when habits, tasks or dates need a look. Nothing comes on a day with nothing due.</p>
    <button class="rounded-lg py-2 px-4 text-sm font-semibold bg-brand text-brand-fg disabled:opacity-50" disabled={reminders.busy} onclick={() => reminders.enable()}>Turn on reminders</button>
  {:else}
    <div class="space-y-3">
      <label class="flex items-center justify-between gap-3 text-sm text-text">
        <span>Remind me at</span>
        <input type="time" bind:value={reminders.choices.remindAt} class={box} aria-label="Remind me at" />
      </label>
      <fieldset class="space-y-1.5">
        <legend class="mb-1 text-sm text-text-muted">Include</legend>
        <label class="flex items-center gap-2 text-sm text-text"><input type="checkbox" bind:checked={reminders.choices.include.habits} class="h-4 w-4" style="accent-color: var(--color-brand);" /> Habits due or overdue</label>
        <label class="flex items-center gap-2 text-sm text-text"><input type="checkbox" bind:checked={reminders.choices.include.tasks} class="h-4 w-4" style="accent-color: var(--color-brand);" /> Tasks due today or overdue</label>
        <label class="flex items-center gap-2 text-sm text-text"><input type="checkbox" bind:checked={reminders.choices.include.dates} class="h-4 w-4" style="accent-color: var(--color-brand);" /> Dates coming up</label>
      </fieldset>
      <label class="flex items-start gap-2 text-sm text-text">
        <input type="checkbox" bind:checked={reminders.choices.named} class="mt-0.5 h-4 w-4" style="accent-color: var(--color-brand);" />
        <span>
          Name what's due
          <span class="block text-xs text-text-muted">Off: "2 habits and 1 task need a look today", so the lock screen shows no names.</span>
        </span>
      </label>
      <div class="flex flex-wrap gap-2">
        <button class="rounded-lg py-2 px-4 text-sm font-semibold bg-brand text-brand-fg disabled:opacity-50" disabled={reminders.busy} onclick={() => reminders.save()}>Save</button>
        <button class="rounded-lg border py-2 px-4 text-sm text-text border-border disabled:opacity-50" disabled={reminders.busy} onclick={() => reminders.test()}>Send a test</button>
        <button class="rounded-lg border py-2 px-4 text-sm text-text-muted border-border disabled:opacity-50" disabled={reminders.busy} onclick={() => reminders.disable()}>Turn off</button>
      </div>
      {#if reminders.lastSentOn}
        <p class="text-xs text-text-muted">Last checked for this device on {reminders.lastSentOn}.</p>
      {/if}
    </div>
  {/if}

  {#if reminders.note}
    <p class="text-sm text-text" role="status">{reminders.note}</p>
  {/if}
  {#if reminders.error}
    <p class="text-sm text-danger" role="alert">{reminders.error}</p>
  {/if}
</section>
