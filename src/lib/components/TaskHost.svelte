<script lang="ts">
  import { onDestroy } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db } from '../db';
  import { fly } from 'svelte/transition';
  import type { Task, TaskProject } from '../db';
  import { taskUi } from '../stores/taskUi.svelte';
  import BottomSheet from './BottomSheet.svelte';
  import TaskSheet from './TaskSheet.svelte';
  import DateChoices from './DateChoices.svelte';

  // The task sheet and the undo toast (stores/taskUi.svelte.ts). Mounted once
  // on each page that lists tasks, with the tasks and projects it already reads.
  let { tasks, projects }: { tasks: readonly Task[]; projects: readonly TaskProject[] } = $props();
  // Only the sheet needs the completion history.
  const completions = liveQuery(() => db.taskCompletions.toArray());

  // Leaving the page closes the sheet, so it doesn't reopen on the next page that lists tasks.
  onDestroy(() => {
    taskUi.open = false;
    taskUi.rescheduleId = null;
  });

  // The reschedule sheet: a tap on a row's date (3.64).
  const rescheduling = $derived(taskUi.rescheduleId ? tasks.find((t) => t.id === taskUi.rescheduleId) : undefined);
  let rescheduleOpen = $state(false);
  $effect(() => {
    rescheduleOpen = !!taskUi.rescheduleId;
  });
  $effect(() => {
    if (!rescheduleOpen) taskUi.rescheduleId = null;
  });
  function pick(dueOn: string | undefined) {
    if (rescheduling) void taskUi.reschedule(rescheduling, dueOn);
    rescheduleOpen = false;
  }
</script>

{#if taskUi.undo}
  <div
    class="fixed inset-x-0 bottom-20 z-30 mx-auto flex w-[calc(100%-2.5rem)] max-w-md items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm shadow-lg lg:bottom-6"
    role="status"
    transition:fly={{ y: 16, duration: 150 }}
  >
    <span class="truncate text-text">{taskUi.undo.message}</span>
    <button class="shrink-0 font-semibold text-brand" onclick={() => taskUi.undoNow()}>Undo</button>
  </div>
{/if}
{#if taskUi.error}
  <p class="px-5 text-sm text-danger">{taskUi.error}</p>
{/if}

<BottomSheet bind:open={rescheduleOpen}>
  {#if rescheduling}
    <div class="space-y-3">
      <h2 class="text-lg font-semibold text-text">Move {rescheduling.name}</h2>
      <DateChoices dueOn={rescheduling.dueOn} onpick={pick} />
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Or pick a date</span>
        <input
          type="date"
          class="w-full rounded-lg border bg-transparent p-2 text-text border-border"
          value={rescheduling.dueOn ?? ''}
          onchange={(e) => e.currentTarget.value && pick(e.currentTarget.value)}
        />
      </label>
    </div>
  {/if}
</BottomSheet>

<BottomSheet bind:open={taskUi.open}>
  <TaskSheet {tasks} {projects} completions={$completions ?? []} />
</BottomSheet>
