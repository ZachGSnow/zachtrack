<script lang="ts">
  import type { CheckState } from '../utils/quickCheck';

  // The round check button of a goal card or Today habit row: filled when
  // today is done, a ring filling toward today's total or count while it
  // isn't, a "+" when there are fields to fill in.
  let {
    state,
    color,
    onclick,
    size = 'md',
  }: {
    state: CheckState;
    /** The trackable's colour, already made readable on this theme. */
    color: string;
    onclick: () => void;
    size?: 'md' | 'sm';
  } = $props();

  const dims = $derived(size === 'sm' ? 'h-9 w-9 text-base' : 'h-10 w-10 text-lg');
</script>

<button
  class="relative flex shrink-0 items-center justify-center rounded-full font-bold transition-colors {dims}"
  style={state.doneToday
    ? `background: ${color}; color: var(--color-brand-fg);`
    : `box-shadow: inset 0 0 0 2px ${state.ring != null ? `${color}33` : `${color}99`}; color: ${color};`}
  {onclick}
  aria-label={state.label}
  aria-pressed={state.noFields ? state.doneToday : undefined}
>
  {#if state.ring != null}
    <!-- Progress toward today's total. -->
    <svg class="absolute inset-0 -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="19" fill="none" stroke={color} stroke-width="2" stroke-linecap="round" pathLength="100" stroke-dasharray="{state.ring * 100} 100" />
    </svg>
    <span class="text-sm">{state.multiple && state.noFields ? state.todayCount : '+'}</span>
  {:else if state.doneToday}
    &#10003;
  {:else if !state.noFields}
    <span class="text-base">+</span>
  {/if}
</button>
