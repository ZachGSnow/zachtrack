<script lang="ts">
  import type { FastDayPlan } from '../db';
  import { allPresets } from '../data/presets';
  import { settingsStore } from '../stores/settings.svelte';
  import { WEEKDAY_NAMES } from '../utils/trackableGoals';

  // Settings > Fasting > Weekly plan: per weekday, a method and start time,
  // or a rest day (settings.fastWeekPlan, Monday first). A day left on
  // Default uses the default method and the daily start time.

  const presets = $derived(allPresets(settingsStore.data.customFastPresets));
  const plan = $derived(settingsStore.data.fastWeekPlan ?? Array<FastDayPlan | null>(7).fill(null));
  const defaultLabel = $derived(presets.find((p) => p.id === settingsStore.data.defaultPresetId)?.label ?? 'default');
  let error = $state('');

  /** A plain copy without unset keys: the settings store's $state proxies can't be stored in IndexedDB (ARCHITECTURE.md 4.4). */
  function clean(d: FastDayPlan | null | undefined): FastDayPlan | null {
    if (!d) return null;
    if (d.rest) return { rest: true };
    const out: FastDayPlan = {};
    if (d.presetId) out.presetId = d.presetId;
    if (d.time) out.time = d.time;
    return Object.keys(out).length ? out : null;
  }

  async function setDay(i: number, day: FastDayPlan | null) {
    const next = plan.map(clean);
    next[i] = clean(day);
    error = '';
    try {
      await settingsStore.update({ fastWeekPlan: next.every((d) => d === null) ? undefined : next });
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not save the plan. Please try again.';
    }
  }

  function setMethod(i: number, value: string) {
    const current = plan[i];
    if (value === 'rest') return setDay(i, { rest: true });
    return setDay(i, { presetId: value || undefined, time: current?.rest ? undefined : current?.time });
  }

  function setTime(i: number, value: string) {
    const current = plan[i];
    return setDay(i, { presetId: current?.presetId, time: value || undefined });
  }
</script>

<div class="text-sm">
  <p class="mb-1 text-text-muted">Weekly plan (optional)</p>
  <ul class="flex flex-col gap-1.5">
    {#each WEEKDAY_NAMES as name, i (name)}
      {@const day = plan[i]}
      <li class="flex items-center gap-2">
        <span class="w-9 shrink-0 text-text-muted">{name}</span>
        <select
          class="min-w-0 flex-1 rounded-lg border bg-transparent p-1.5 text-text"
          style="border-color: var(--color-border); color-scheme: dark;"
          aria-label="{name} method"
          value={day?.rest ? 'rest' : (day?.presetId ?? '')}
          onchange={(e) => setMethod(i, (e.target as HTMLSelectElement).value)}
        >
          <option value="">Default ({defaultLabel})</option>
          {#each presets as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
          <option value="rest">Rest day</option>
        </select>
        <input
          type="time"
          class="w-28 rounded-lg border bg-transparent p-1.5 text-text disabled:opacity-40"
          style="border-color: var(--color-border); color-scheme: dark;"
          aria-label="{name} start time"
          disabled={!!day?.rest}
          value={day?.time ?? ''}
          placeholder={settingsStore.data.fastScheduleTime ?? ''}
          onchange={(e) => setTime(i, (e.target as HTMLInputElement).value)}
        />
      </li>
    {/each}
  </ul>
  {#if error}<p class="mt-1 text-xs" style="color: #f87171;">{error}</p>{/if}
  <p class="mt-1 text-xs text-text-muted">
    A blank time uses the daily start time. On a rest day nothing is due; Start Fast picks the day's method.
  </p>
</div>
