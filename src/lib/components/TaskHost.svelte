<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fly } from 'svelte/transition';
  import type { Task, TaskProject } from '../db';
  import { taskUi } from '../stores/taskUi.svelte';
  import BottomSheet from './BottomSheet.svelte';
  import TaskSheet from './TaskSheet.svelte';

  // The task sheet and the undo toast (stores/taskUi.svelte.ts). Mounted once
  // on each page that lists tasks, with the tasks and projects it already reads.
  let { tasks, projects }: { tasks: readonly Task[]; projects: readonly TaskProject[] } = $props();

  // Leaving the page closes the sheet, so it doesn't reopen on the next page that lists tasks.
  onDestroy(() => {
    taskUi.open = false;
  });
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

<BottomSheet bind:open={taskUi.open}>
  <TaskSheet {tasks} {projects} />
</BottomSheet>
