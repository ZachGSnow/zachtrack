<script lang="ts">
  import { liveQuery } from 'dexie';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import Repeat from '@lucide/svelte/icons/repeat';
  import { db } from '../lib/db';
  import { dayKey, describeDue } from '../lib/utils/tasks';
  import { doneSince, tallyTasks } from '../lib/utils/taskStats';
  import { taskUi } from '../lib/stores/taskUi.svelte';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';
  import SectionHeading from '../lib/components/ui/SectionHeading.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import TaskHost from '../lib/components/TaskHost.svelte';
  import { loadPrefs, oneOf, savePrefs } from '../lib/utils/prefs';

  // What got done (ARCHITECTURE.md 3.66): tasks and subtasks closed, and each
  // time a repeating task was done, by day, over the last week or month.
  const projects = liveQuery(() => db.taskProjects.toArray());
  const tasks = liveQuery(() => db.tasks.toArray());
  const completions = liveQuery(() => db.taskCompletions.toArray());

  const RANGES = [
    { id: '7', label: '7 days' },
    { id: '30', label: '30 days' },
    { id: '365', label: 'Year' },
  ] as const;
  type Range = (typeof RANGES)[number]['id'];
  let range = $state<Range>(oneOf(loadPrefs<{ range: unknown }>('tasks-done', { range: '7' }).range, ['7', '30', '365'], '7'));
  $effect(() => savePrefs('tasks-done', { range }));

  const now = Date.now();
  const today = dayKey(now);
  const since = $derived(new Date(new Date().setHours(0, 0, 0, 0)).getTime() - (Number(range) - 1) * 86_400_000);
  const days = $derived(doneSince($tasks ?? [], $completions ?? [], $projects ?? [], since));
  const tally = $derived(tallyTasks($tasks ?? [], $completions ?? [], since, now + 1));
  const dayLabel = (day: string) => {
    const text = describeDue(day, undefined, today).text;
    return text === 'Today' || text === 'Yesterday' ? text : new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  };
  const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-4 px-5 py-6">
  <h1 class="text-xl font-semibold text-text">Done</h1>
  <div class="flex flex-wrap items-center justify-between gap-2">
    <SegmentedControl options={[...RANGES]} bind:value={range} />
    {#if tally.done > 0}
      <p class="text-sm text-text-muted">
        {tally.done} done{tally.repeats ? `, ${tally.repeatsOnTime} of ${tally.repeats} repeats on time` : ''}
      </p>
    {/if}
  </div>

  {#if $tasks === undefined || $completions === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if days.length === 0}
    <EmptyState icon="&#x2705;" title="Nothing done yet in this time" text="Completed tasks, and each time a repeating task is done, show here by day." />
  {:else}
    {#each days as d (d.day)}
      <section class="flex flex-col gap-1" aria-labelledby="done-{d.day}">
        <SectionHeading id="done-{d.day}" title="{dayLabel(d.day)} ({d.items.length})" />
        <ul class="flex flex-col">
          {#each d.items as item (item.key)}
            <li>
              <button type="button" class="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-surface-2" onclick={() => taskUi.show(item.taskId)}>
                <span class="text-brand">
                  {#if item.kind === 'repeat'}<Repeat size={18} aria-label="repeating task, done" />{:else}<CircleCheck size={18} aria-label="done" />{/if}
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm text-text">{item.name}</span>
                  <span class="flex flex-wrap gap-x-2 text-xs text-text-muted">
                    {#if item.context}<span class="truncate">{item.context}</span>{/if}
                    {#if item.timing}<span class:text-warn={item.timing === 'late'}>{item.timing}</span>{/if}
                  </span>
                </span>
                <span class="shrink-0 text-xs text-text-muted">{time(item.at)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  {/if}
</div>

<TaskHost tasks={$tasks ?? []} projects={$projects ?? []} />
