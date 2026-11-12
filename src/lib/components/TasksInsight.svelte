<script lang="ts">
  import { liveQuery } from 'dexie';
  import { link } from 'svelte-spa-router';
  import { db } from '../db';
  import { dayKey, dueTasks } from '../utils/tasks';
  import { tallyTasks } from '../utils/taskStats';

  // Insights > Tasks (ARCHITECTURE.md 3.66): the last 30 days of tasks done,
  // how repeating tasks kept to their dates, and what's late now. Shown only
  // when there are tasks at all.
  const tasks = liveQuery(() => db.tasks.toArray());
  const completions = liveQuery(() => db.taskCompletions.toArray());
  const projects = liveQuery(() => db.taskProjects.toArray());

  const now = Date.now();
  const DAYS = 30;
  const from = new Date(new Date().setHours(0, 0, 0, 0)).getTime() - (DAYS - 1) * 86_400_000;
  const tally = $derived(tallyTasks($tasks ?? [], $completions ?? [], from, now + 1));
  const overdue = $derived(
    dueTasks($tasks ?? [], dayKey(now), new Set(($projects ?? []).filter((p) => p.archived).map((p) => p.id))).filter((t) => t.dueOn! < dayKey(now)).length,
  );
  const perWeek = $derived(Math.round((tally.done / DAYS) * 7 * 10) / 10);
</script>

{#if ($tasks ?? []).length > 0}
  <section class="rounded-2xl border p-4 border-border bg-surface" aria-labelledby="tasks-insight">
    <div class="mb-2 flex items-baseline justify-between gap-2">
      <h2 id="tasks-insight" class="text-sm font-semibold text-text">Tasks, last {DAYS} days</h2>
      <a href="/tasks/done" use:link class="text-xs font-semibold text-brand">Done</a>
    </div>
    <ul class="flex flex-col gap-1 text-sm text-text">
      <li>{tally.done} done{tally.done ? `, about ${perWeek} a week` : ''}</li>
      {#if tally.repeats > 0}
        <li>Repeating tasks: {tally.repeatsOnTime} of {tally.repeats} done by their date</li>
      {/if}
      <li class:text-danger={overdue > 0}>{overdue === 0 ? 'Nothing overdue' : `${overdue} overdue now`}</li>
    </ul>
  </section>
{/if}
