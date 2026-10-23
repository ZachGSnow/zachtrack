<script lang="ts">
  import { link } from 'svelte-spa-router';
  import type { FastRecord, FieldDefinition, TrackableDefinition, TrackableEntry } from '../db';
  import { trackableInsights } from '../utils/insights';
  import { goalStatus } from '../utils/trackableGoals';
  import { computeFastStats } from '../utils/stats';
  import { goalMet } from '../utils/fastingJourney';

  // Insights > Overview and Patterns: one line per trackable from its own
  // insights (utils/insights.ts) and goal, plus fasting, so how everything is
  // going reads in one place. Each links to its page for the detail.
  let {
    fasts,
    trackables,
    entries,
    fields,
  }: { fasts: FastRecord[]; trackables: TrackableDefinition[]; entries: TrackableEntry[]; fields: FieldDefinition[] } = $props();

  const now = Date.now();
  const PATTERNS_SHOWN = 5;

  const tracked = $derived(trackables.filter((t) => !t.archived && t.displayMode !== 'ages'));
  const byTrackable = $derived.by(() => {
    const map = new Map<string, TrackableEntry[]>();
    for (const e of entries) {
      const list = map.get(e.trackableId);
      if (list) list.push(e);
      else map.set(e.trackableId, [e]);
    }
    return map;
  });

  const rows = $derived.by(() => {
    const others = tracked.map((t) => ({ trackable: t, entries: byTrackable.get(t.id) ?? [] }));
    return tracked
      .map((t) => {
        const own = byTrackable.get(t.id) ?? [];
        const attached = t.fieldIds.map((id) => fields.find((f) => f.id === id)).filter((f): f is FieldDefinition => f != null);
        const insights = own.length ? trackableInsights(t, own, attached, others, now) : [];
        const goal = t.goalType ? goalStatus(t, own, attached, now) : null;
        return {
          trackable: t,
          consistency: insights.find((i) => i.label === 'Last 30 days')?.text ?? (own.length ? null : 'Nothing logged yet'),
          streak: goal?.streak ?? null,
          patterns: insights.filter((i) => i.label === 'On days with' || i.label === 'By weekday').map((i) => i.text),
          hasGoal: !!t.goalType,
          empty: own.length === 0,
        };
      })
      // A trackable never logged and without a goal has nothing to say yet.
      .filter((r) => !(r.empty && !r.hasGoal))
      .sort((a, b) => Number(b.hasGoal) - Number(a.hasGoal) || a.trackable.name.localeCompare(b.trackable.name));
  });

  const patterns = $derived(rows.flatMap((r) => r.patterns.map((text) => ({ trackable: r.trackable, text }))).slice(0, PATTERNS_SHOWN));

  const fastStats = $derived(computeFastStats(fasts));
  const fasts30 = $derived(fasts.filter((f) => f.endTime != null && f.startTime >= now - 30 * 24 * 3600_000));
</script>

<section class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);" aria-labelledby="insights-overview">
  <h2 id="insights-overview" class="mb-2 text-sm font-semibold text-text">Overview</h2>
  <ul class="flex flex-col">
    {#if fasts.length}
      <li class="border-t py-2 first:border-t-0" style="border-color: var(--color-border);">
        <a href="/journey" use:link class="flex items-start gap-3">
          <span class="w-6 text-center text-lg">&#x23F1;&#xFE0F;</span>
          <span class="min-w-0 flex-1 text-sm">
            <span class="block font-medium text-text">Fasting</span>
            <span class="block text-xs text-text-muted">
              {fasts30.length ? `Goal met on ${fasts30.filter((f) => goalMet(f, now)).length} of ${fasts30.length} fasts in the last 30 days` : 'No finished fasts in the last 30 days'}
            </span>
          </span>
          <span class="shrink-0 text-xs text-text-muted">{fastStats.currentStreak}-day goal streak</span>
        </a>
      </li>
    {/if}
    {#each rows as r (r.trackable.id)}
      <li class="border-t py-2 first:border-t-0" style="border-color: var(--color-border);">
        <a href="/trackables/{r.trackable.id}" use:link class="flex items-start gap-3">
          <span class="w-6 text-center text-lg">{r.trackable.icon}</span>
          <span class="min-w-0 flex-1 text-sm">
            <span class="block font-medium text-text">{r.trackable.name}</span>
            {#if r.consistency}<span class="block text-xs text-text-muted">{r.consistency}</span>{/if}
          </span>
          {#if r.streak}<span class="shrink-0 text-xs text-text-muted">{r.streak}</span>{/if}
        </a>
      </li>
    {/each}
  </ul>
</section>

<section class="rounded-2xl border p-4" style="border-color: var(--color-border); background: var(--color-surface);" aria-labelledby="insights-patterns">
  <h2 id="insights-patterns" class="mb-2 text-sm font-semibold text-text">Patterns</h2>
  {#if patterns.length === 0}
    <p class="text-sm text-text-muted">None clear yet. Patterns show once there are at least 5 days on each side of a comparison and the difference is large.</p>
  {:else}
    <ul class="flex flex-col gap-1.5 text-sm">
      {#each patterns as p, i (i)}
        <li><a href="/trackables/{p.trackable.id}" use:link><span class="font-medium text-text">{p.trackable.name}:</span> <span class="text-text-muted">{p.text}</span></a></li>
      {/each}
    </ul>
    <p class="mt-2 text-xs text-text-muted">Patterns, not causes; each trackable's page has the rest.</p>
  {/if}
</section>
