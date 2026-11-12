<script lang="ts">
  import { liveQuery } from 'dexie';
  import { db } from '../lib/db';
  import { dayKey, taskContext, upcomingGroups, type DueState } from '../lib/utils/tasks';
  import SectionHeading from '../lib/components/ui/SectionHeading.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import TaskHost from '../lib/components/TaskHost.svelte';
  import TaskRow from '../lib/components/TaskRow.svelte';

  // Every open task with a due date, across projects, by when it's due
  // (ARCHITECTURE.md 3.62): Asana's My Tasks without the assignee.
  const projects = liveQuery(() => db.taskProjects.toArray());
  const tasks = liveQuery(() => db.tasks.toArray());

  const today = dayKey(Date.now());
  const archived = $derived(new Set(($projects ?? []).filter((p) => p.archived).map((p) => p.id)));
  const groups = $derived(upcomingGroups($tasks ?? [], today, archived));
  const TONE: Record<DueState, 'danger' | 'warn' | 'muted'> = { overdue: 'danger', today: 'warn', soon: 'muted', later: 'muted' };
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-4 px-5 py-6">
  <h1 class="text-xl font-semibold text-text">Upcoming</h1>

  {#if $projects === undefined || $tasks === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if groups.length === 0}
    <EmptyState icon="&#x1F4C5;" title="Nothing with a due date" text="Tasks with a due date show here by day, overdue first, from every project." />
  {:else}
    {#each groups as g (g.key)}
      <section class="flex flex-col gap-1" aria-labelledby="upcoming-{g.key}">
        <SectionHeading id="upcoming-{g.key}" title="{g.label} ({g.tasks.length})" tone={TONE[g.state]} />
        <ul class="flex flex-col">
          {#each g.tasks as t (t.id)}
            <TaskRow task={t} tasks={$tasks} {today} context={taskContext(t, $tasks, $projects)} />
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<TaskHost tasks={$tasks ?? []} projects={$projects ?? []} />
