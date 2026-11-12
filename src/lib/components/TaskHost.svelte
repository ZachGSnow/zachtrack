<script lang="ts">
  import { onDestroy } from 'svelte';
  import { liveQuery } from 'dexie';
  import { db } from '../db';
  import type { Task, TaskProject } from '../db';
  import { taskUi } from '../stores/taskUi.svelte';
  import BottomSheet from './BottomSheet.svelte';
  import TaskSheet from './TaskSheet.svelte';
  import DateChoices from './DateChoices.svelte';

  // The task sheet and the reschedule sheet (stores/taskUi.svelte.ts); the undo message is UndoToast.svelte. Mounted once
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
