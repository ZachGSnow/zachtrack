<script lang="ts">
  import type { WeekDay, WeekDayState } from '../utils/fastingJourney';

  // This week on the Fasting tab, Monday to Sunday: a dot per day, filled
  // for a goal fast, half for a short one, a ring for the running one, hollow
  // for a rest day, faint for a day missed, outlined for today.
  let { days }: { days: WeekDay[] } = $props();

  const LABEL: Record<WeekDayState, string> = {
    goal: 'goal met',
    short: 'fasted, short of the goal',
    running: 'fasting now',
    rest: 'rest day',
    missed: 'no fast',
    open: 'no fast yet',
    upcoming: 'later this week',
  };
  const STYLE: Record<WeekDayState, string> = {
    goal: 'background: var(--color-brand);',
    short: 'background: color-mix(in oklab, var(--color-brand) 45%, var(--color-surface-2));',
    running: 'box-shadow: inset 0 0 0 3px var(--color-brand);',
    rest: 'box-shadow: inset 0 0 0 1.5px var(--color-border);',
    missed: 'background: var(--color-surface-2);',
    open: 'box-shadow: inset 0 0 0 1.5px var(--color-text-muted);',
    upcoming: 'box-shadow: inset 0 0 0 1px var(--color-border); opacity: 0.6;',
  };
  const initial = (day: number) => new Date(day).toLocaleDateString(undefined, { weekday: 'narrow' });
  const describe = (d: WeekDay) => `${new Date(d.day).toLocaleDateString(undefined, { weekday: 'short' })}: ${LABEL[d.state]}${d.isToday ? ', today' : ''}`;
</script>

<ul class="flex w-full max-w-xs items-center justify-between gap-1" aria-label="This week">
  {#each days as d (d.day)}
    <li class="flex flex-col items-center gap-1" aria-label={describe(d)} title={describe(d)}>
      <span class="text-[10px] leading-none text-text-muted" class:font-semibold={d.isToday} class:text-text={d.isToday}>{initial(d.day)}</span>
      <span class="block h-5 w-5 rounded-full" style={STYLE[d.state]} aria-hidden="true"></span>
    </li>
  {/each}
</ul>
