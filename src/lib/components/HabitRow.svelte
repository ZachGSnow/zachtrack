<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { TodayHabit } from '../utils/today';
  import { checkState } from '../utils/quickCheck';
  import { GOAL_STATE_COLORS, habitStrength } from '../utils/trackableGoals';
  import { readableGraphic } from '../utils/color';
  import { themeStore } from '../stores/theme.svelte';
  import { quickLog } from '../stores/quickLog.svelte';
  import CheckButton from './CheckButton.svelte';

  // One habit on Today: its icon and name (a link to its page), where it
  // stands against its goal, and the check button.
  let { habit, now }: { habit: TodayHabit; now: number } = $props();

  const t = $derived(habit.trackable);
  const ink = $derived(readableGraphic(t.color, themeStore.effective));
  const state = $derived(checkState(t, habit.kind, habit.entries, habit.fields, now));
  const OFF: Record<NonNullable<TodayHabit['offDay']>, string> = { rest: 'Rest day', skipped: 'Skipped today', paused: 'Paused' };
  const line = $derived(habit.offDay ? OFF[habit.offDay] : (habit.goal?.text ?? ''));
  const color = $derived(habit.offDay ? undefined : GOAL_STATE_COLORS[habit.goal?.state ?? 'ok']);
  // How established it is (utils/trackableGoals.ts habitStrength), next to the streak.
  const strength = $derived(habitStrength(t, habit.entries, habit.fields, now));
  const extras = $derived(
    // Strength once there's something logged; a brand-new habit at 0% would only discourage.
    habit.offDay ? [] : [strength != null && habit.entries.length > 0 ? `${Math.round(strength * 100)}% strong` : undefined, habit.goal?.streak].filter(Boolean),
  );
</script>

<li class="flex items-center gap-3 py-1.5" class:opacity-60={habit.offDay != null}>
  <a href="/trackables/{t.id}" use:link class="flex min-w-0 flex-1 items-center gap-3">
    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg" style="background: {t.color}22;">{t.icon}</span>
    <span class="min-w-0">
      <span class="block truncate text-sm font-medium text-text">{t.name}</span>
      <span class="block truncate text-xs text-text-muted" style={color ? `color: ${color};` : ''}>
        {[line, ...extras].join(' \u00b7 ')}
      </span>
    </span>
  </a>
  <CheckButton {state} color={ink} size="sm" onclick={() => quickLog.toggle(t, habit.entries, state.doneToday)} />
</li>
