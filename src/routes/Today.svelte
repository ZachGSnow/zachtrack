<script lang="ts">
  import { liveQuery } from 'dexie';
  import { link } from 'svelte-spa-router';
  import { db, updateTrackable } from '../lib/db';
  import { DATES_WITHIN_DAYS, LOG_RECENT_DAYS, groupByTimeOfDay, lapsedHabits, suggestGoals, TIME_OF_DAY_LABEL, todayDates, todayHabits, todayLogs, type GoalSuggestion } from '../lib/utils/today';
  import { weeklyReview } from '../lib/utils/weeklyReview';
  import { sinceLastVisit } from '../lib/utils/sinceLastVisit';
  import { visitStore } from '../lib/stores/visit.svelte';
  import { measurementView } from '../lib/stores/measurementView.svelte';
  import DataSafetyCard from '../lib/components/DataSafetyCard.svelte';
  import AwayCard from '../lib/components/AwayCard.svelte';
  import LapsedHabitCard from '../lib/components/LapsedHabitCard.svelte';
  import InlineLog from '../lib/components/InlineLog.svelte';
  import { takeShortcut } from '../lib/utils/shortcuts';
  import { resolveBodyFieldIds } from '../lib/utils/health';
  import { loadPrefs, savePrefs } from '../lib/utils/prefs';
  import { settingsStore } from '../lib/stores/settings.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import { dateItemKey } from '../lib/utils/dates';
  import { readableGraphic } from '../lib/utils/color';
  import { themeStore } from '../lib/stores/theme.svelte';
  import { quickLog } from '../lib/stores/quickLog.svelte';
  import FastNow from '../lib/components/FastNow.svelte';
  import HabitRow from '../lib/components/HabitRow.svelte';
  import HabitMatrix from '../lib/components/HabitMatrix.svelte';
  import QuickLogHost from '../lib/components/QuickLogHost.svelte';
  import Card from '../lib/components/ui/Card.svelte';
  import SectionHeading from '../lib/components/ui/SectionHeading.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';

  // Today: what to do now, gathered from every part of the app (ARCHITECTURE.md
  // 3.41). The fast, the habits with a goal, what you've been logging, and the
  // dates coming up. Each row links to where the rest lives.
  const trackables = liveQuery(() => db.trackableDefinitions.toArray());
  const allFields = liveQuery(() => db.fieldDefinitions.toArray());
  const allEntries = liveQuery(() => db.trackableEntries.toArray());

  // "2h ago", due states and the fast move with the clock.
  let now = $state(Date.now());
  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  const habits = $derived(todayHabits($trackables ?? [], $allFields ?? [], $allEntries ?? [], now));
  const logs = $derived(todayLogs($trackables ?? [], $allFields ?? [], $allEntries ?? [], now, undefined, measurementView.view));
  const dates = $derived(todayDates($trackables ?? [], $allEntries ?? [], now));
  const hasDates = $derived(($trackables ?? []).some((t) => !t.archived && t.displayMode === 'ages'));
  const groups = $derived(groupByTimeOfDay(habits, now));

  // Habits that slipped after going well (3.53); "Start again" hides the card for 14 days on this device.
  const LAPSE_KEY = 'lapsed-dismissed';
  let lapseDismissed = $state<Record<string, number>>(loadPrefs<Record<string, number>>(LAPSE_KEY, {}));
  const lapsed = $derived(lapsedHabits(habits, now).filter((l) => !(lapseDismissed[l.habit.trackable.id] > now)));
  function dismissLapse(id: string) {
    lapseDismissed = { ...lapseDismissed, [id]: Date.now() + 14 * 24 * 3600_000 };
    savePrefs(LAPSE_KEY, lapseDismissed);
  }
  const counted = $derived(habits.filter((h) => !h.offDay));

  // The weekly review (utils/weeklyReview.ts): Sunday and Monday, dismissible per week on this device.
  const recentFasts = liveQuery(() => db.fasts.where('startDay').aboveOrEqual(Date.now() - 16 * 24 * 3600_000).toArray());
  const REVIEW_KEY = 'weekly-review';
  let reviewDismissed = $state(Number(loadPrefs<{ week: unknown }>(REVIEW_KEY, { week: 0 }).week) || 0);
  const review = $derived(
    weeklyReview(
      $trackables ?? [],
      $allFields ?? [],
      $allEntries ?? [],
      $recentFasts ?? [],
      resolveBodyFieldIds($allFields ?? [], settingsStore.data).weight,
      now,
    ),
  );
  // Since you were last here (utils/sinceLastVisit.ts): needs the sync log from the gap.
  const syncLog = liveQuery(() => db.syncLog.toArray());
  const awayLines = $derived(
    visitStore.previous == null || visitStore.dismissed
      ? []
      : sinceLastVisit({
          lastActive: visitStore.previous,
          now,
          trackables: $trackables ?? [],
          fields: $allFields ?? [],
          entries: $allEntries ?? [],
          fasts: $recentFasts ?? [],
          syncLog: $syncLog ?? [],
        }),
  );

  const showReview = $derived(review != null && review.weekStart !== reviewDismissed && (review.habits || review.weight || review.fasts.count));
  function dismissReview() {
    if (!review) return;
    reviewDismissed = review.weekStart;
    savePrefs(REVIEW_KEY, { week: review.weekStart });
  }
  const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
  const weekLabel = (start: number) => new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const done = $derived(counted.filter((h) => h.goal?.state === 'done').length);

  // Goal suggestions (utils/today.ts): "Not now" hides one on this device for 30 days.
  const SNOOZE_KEY = 'goal-suggestions';
  let snoozed = $state<Record<string, number>>(loadPrefs<Record<string, number>>(SNOOZE_KEY, {}));
  const suggestions = $derived(suggestGoals($trackables ?? [], $allEntries ?? [], now).filter((s) => !(snoozed[s.trackable.id] > now)));
  function snooze(id: string) {
    snoozed = { ...snoozed, [id]: Date.now() + 30 * 24 * 3600_000 };
    savePrefs(SNOOZE_KEY, snoozed);
  }
  async function adopt(s: GoalSuggestion) {
    await updateTrackable(s.trackable.id, { goalType: s.goalType, goalValue: s.goalValue });
  }

  // The "Log weight" home-screen shortcut: the entry sheet for the trackable holding the weight
  // field (the one BMI follows), prefilled from the last reading, once everything has loaded.
  let shortcutChecked = false;
  $effect(() => {
    if (shortcutChecked || $trackables === undefined || $allFields === undefined || !settingsStore.ready) return;
    shortcutChecked = true;
    if (!takeShortcut('log-weight')) return;
    const weightId = resolveBodyFieldIds($allFields, settingsStore.data).weight;
    const holder = weightId ? $trackables.filter((t) => t.fieldIds.includes(weightId)).sort((a, b) => Number(!!a.archived) - Number(!!b.archived))[0] : undefined;
    if (holder) void quickLog.log(holder);
  });

  const dateLine = $derived(new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }));
  const when = (at: number) => new Date(at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-4 px-5 py-6 lg:grid lg:max-w-6xl lg:grid-cols-2 lg:items-start lg:gap-6">
  <div class="lg:col-span-2">
    <h1 class="text-xl font-semibold text-text">Today</h1>
    <p class="text-sm text-text-muted">{dateLine}</p>
  </div>

  {#if awayLines.length > 0 && visitStore.previous != null}
    <div class="lg:col-span-2">
      <AwayCard lines={awayLines} since={visitStore.previous} />
    </div>
  {/if}

  {#if showReview && review}
    <div class="lg:col-span-2">
      <Card tone="muted" padding="p-4" label="Weekly review">
        <div class="flex items-baseline justify-between gap-2">
          <p class="text-xs font-semibold tracking-wide text-text-muted uppercase">
            {review.partial ? 'This week so far' : `Week of ${weekLabel(review.weekStart)}`}
          </p>
          <button class="text-xs text-text-muted" onclick={dismissReview}>Dismiss</button>
        </div>
        <ul class="mt-2 grid gap-2 text-sm sm:grid-cols-3">
          {#if review.habits}
            <li>
              <span class="block text-xs text-text-muted">Habits</span>
              <span class="font-heading text-lg font-semibold text-text">{review.habits.met} of {review.habits.of}</span>
              <span class="text-xs text-text-muted"> met</span>
            </li>
          {/if}
          {#if review.weight}
            {@const change = review.weight.change}
            <li>
              <span class="block text-xs text-text-muted">Weight, 7-day average</span>
              <span class="font-heading text-lg font-semibold text-text">{nf1.format(review.weight.average)}{review.weight.unit ? ` ${review.weight.unit}` : ''}</span>
              {#if change != null}
                <span class="text-xs text-text-muted"> {Math.abs(change) < 0.05 ? 'same as the week before' : `${change > 0 ? '\u25b2' : '\u25bc'}${nf1.format(Math.abs(change))} on the week`}</span>
              {/if}
            </li>
          {/if}
          <li>
            <span class="block text-xs text-text-muted">Fasts</span>
            <span class="font-heading text-lg font-semibold text-text">{review.fasts.count}</span>
            <span class="text-xs text-text-muted"> {review.fasts.count === 1 ? 'fast' : 'fasts'}, {review.fasts.goal} to goal</span>
          </li>
        </ul>
      </Card>
    </div>
  {/if}

  <div class="flex flex-col gap-4">
    <FastNow {now} />

    <section class="flex flex-col gap-2" aria-labelledby="today-habits">
      <SectionHeading id="today-habits" title="Habits">
        {#snippet action()}
          {#if counted.length > 0}
            <span class="text-xs text-text-muted">{done} of {counted.length} done</span>
          {/if}
        {/snippet}
      </SectionHeading>
      {#each lapsed as l (l.habit.trackable.id)}
        <LapsedHabitCard lapsed={l} onDismiss={() => dismissLapse(l.habit.trackable.id)} />
      {/each}
      {#if suggestions.length > 0}
        <!-- At most three, the most regular first, so they don't push the habits themselves down. -->
        <Card tone="brand" padding="px-3 py-2" label="Suggested goals">
          <p class="text-xs font-semibold tracking-wide text-brand uppercase">Make these habits?</p>
          <ul class="divide-y divide-border">
            {#each suggestions.slice(0, 3) as s (s.trackable.id)}
              <li class="flex items-center gap-3 py-2" aria-label="Suggested goal for {s.trackable.name}">
                <span class="text-lg" aria-hidden="true">{s.trackable.icon}</span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-text">{s.trackable.name}</span>
                  <span class="block truncate text-xs text-text-muted">{s.reason}</span>
                </span>
                <Button variant="primary" size="sm" class="shrink-0 whitespace-nowrap" onclick={() => adopt(s)}>{s.label}</Button>
                <button class="shrink-0 text-xs text-text-muted" onclick={() => snooze(s.trackable.id)} aria-label="Not now: {s.trackable.name}">Not now</button>
              </li>
            {/each}
          </ul>
        </Card>
      {/if}
      {#if $trackables === undefined}
        <p class="text-sm text-text-muted">Loading&hellip;</p>
      {:else if habits.length === 0 && suggestions.length > 0}
        <!-- The suggestions above stand in for the empty state. -->
      {:else if habits.length === 0}
        <EmptyState title="No goals yet" text="Give a trackable a goal in its Edit sheet and it shows up here each day with a check button.">
          {#snippet action()}
            <a href="/trackables" use:link class="text-sm font-semibold text-brand">Open Trackables</a>
          {/snippet}
        </EmptyState>
      {:else}
        <Card padding="px-3 py-1">
          <!-- Grouped by when each is usually logged (utils/today.ts timeOfDay), headings only when there's more than one group. -->
          {#each groups as g (g.time)}
            <div aria-label="{TIME_OF_DAY_LABEL[g.time]} habits" role="group">
              {#if groups.length > 1}
                <p class="pt-2 text-[11px] font-semibold tracking-wide text-text-muted uppercase">{TIME_OF_DAY_LABEL[g.time]}</p>
              {/if}
              <ul class="divide-y divide-border">
                {#each g.habits as h (h.trackable.id)}
                  <HabitRow habit={h} {now} />
                {/each}
              </ul>
            </div>
          {/each}
        </Card>
        <HabitMatrix {habits} {now} />
      {/if}
    </section>
  </div>

  <div class="flex flex-col gap-4">
    <section class="flex flex-col gap-2" aria-labelledby="today-log">
      <SectionHeading id="today-log" title="Log">
        {#snippet action()}
          <a href="/trackables" use:link class="text-xs font-semibold text-brand">All trackables</a>
        {/snippet}
      </SectionHeading>
      {#if logs.length === 0}
        <p class="px-1 text-sm text-text-muted">Nothing without a goal logged in the last {LOG_RECENT_DAYS} days.</p>
      {:else}
        <Card padding="px-3 py-1">
          <ul class="divide-y divide-border">
            {#each logs as l (l.trackable.id)}
              {@const ink = readableGraphic(l.trackable.color, themeStore.effective)}
              <li class="flex flex-col gap-1 py-1.5">
                <div class="flex items-center gap-3">
                  <a href="/trackables/{l.trackable.id}" use:link class="flex min-w-0 flex-1 items-center gap-3">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg" style="background: {l.trackable.color}22;">{l.trackable.icon}</span>
                    <span class="min-w-0">
                      <span class="block truncate text-sm font-medium text-text">{l.trackable.name}</span>
                      <span class="block truncate text-xs text-text-muted">{l.summary}</span>
                    </span>
                  </a>
                  <button
                    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base font-semibold"
                    style="background: {l.trackable.color}22; color: {ink};"
                    onclick={() => quickLog.log(l.trackable)}
                    aria-label="Log {l.trackable.name}"
                  >+</button>
                </div>
                <!-- A reading or a rating straight from here, without the sheet (3.55). -->
                <InlineLog trackable={l.trackable} fields={l.fields} entries={l.entries} kind={l.kind} />
              </li>
            {/each}
          </ul>
        </Card>
      {/if}
    </section>

    {#if hasDates}
      <section class="flex flex-col gap-2" aria-labelledby="today-dates">
        <SectionHeading id="today-dates" title="Coming up">
          {#snippet action()}
            <a href="/dates" use:link class="text-xs font-semibold text-brand">All dates</a>
          {/snippet}
        </SectionHeading>
        <Card padding="px-3 py-1">
          {#if dates.length === 0}
            <p class="py-1.5 text-sm text-text-muted">Nothing in the next {DATES_WITHIN_DAYS} days.</p>
          {:else}
            <ul class="divide-y divide-border">
              {#each dates as d (dateItemKey(d))}
                <li>
                  <a href="/trackables/{d.trackableId}" use:link class="flex items-center gap-3 py-1.5 text-sm">
                    <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg" style="background: {d.color}22;">{d.icon}</span>
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-text">{d.name}{d.detail ? `: ${d.detail}` : ''}</span>
                      <span class="block text-xs text-text-muted">{when(d.at)}</span>
                    </span>
                    <span class="shrink-0 text-xs font-medium" class:text-brand={d.daysUntil <= 1} class:text-text-muted={d.daysUntil > 1}>{d.countdown}</span>
                  </a>
                </li>
              {/each}
            </ul>
          {/if}
        </Card>
      </section>
    {/if}

    <!-- Synced, backed up, exported: the app says where your data is (utils/dataSafety.ts). -->
    <DataSafetyCard {now} />
  </div>
</div>

<QuickLogHost />
