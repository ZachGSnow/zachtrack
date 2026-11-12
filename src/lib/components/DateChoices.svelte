<script lang="ts">
  import { dateChoices, dayKey, describeDue } from '../utils/tasks';

  // One-tap dates for a task (3.64): Today, Tomorrow, This weekend, Next
  // week, and No date when it has one. The one it's on is marked.
  let {
    dueOn,
    onpick,
  }: {
    dueOn: string | undefined;
    onpick: (dueOn: string | undefined) => void;
  } = $props();

  const today = dayKey(Date.now());
  const choices = dateChoices(today);
</script>

<div class="flex flex-wrap gap-1.5" role="group" aria-label="Quick dates">
  {#each choices as c (c.label)}
    <button
      type="button"
      class="rounded-full border px-2.5 py-1 text-xs font-medium {dueOn === c.dueOn ? 'border-brand bg-brand text-brand-fg' : 'border-border text-text-muted hover:text-text'}"
      aria-pressed={dueOn === c.dueOn}
      title={describeDue(c.dueOn, undefined, today).text}
      onclick={() => onpick(c.dueOn)}>{c.label}</button
    >
  {/each}
  {#if dueOn}
    <button type="button" class="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-text-muted hover:text-text" onclick={() => onpick(undefined)}>No date</button>
  {/if}
</div>
