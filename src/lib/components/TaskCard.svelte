<script lang="ts">
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Repeat from '@lucide/svelte/icons/repeat';
  import NotebookText from '@lucide/svelte/icons/notebook-text';
  import type { Task } from '../db';
  import { describeDue, DUE_COLORS, subtaskProgress } from '../utils/tasks';
  import { taskUi } from '../stores/taskUi.svelte';
  import TaskCheck from './TaskCheck.svelte';

  // One task on a board (3.76): a card with its checkbox and name, and under
  // them its date (tap to reschedule), repeat mark, subtask count and a mark
  // when it has notes. Tapping the card opens the task sheet. It drags by the
  // dots on its left, or from anywhere with a mouse (actions/sortable.ts).
  let {
    task,
    tasks,
    today,
    draggable = false,
  }: {
    task: Task;
    /** Every task, for the subtask count. */
    tasks: readonly Task[];
    today: string;
    /** Shows the drag handle; the list it's in has the sortable action. */
    draggable?: boolean;
  } = $props();

  const due = $derived(task.dueOn && !task.completedAt ? describeDue(task.dueOn, task.dueTime, today) : null);
  const progress = $derived(subtaskProgress(tasks, task.id));

  // The tick shows for a moment before a completed task leaves the column.
  let completing = $state(false);
  function check() {
    if (task.completedAt || completing) return void taskUi.toggle(task);
    completing = true;
    setTimeout(() => {
      void taskUi.toggle(task).finally(() => (completing = false));
    }, 350);
  }
</script>

<li data-sort-id={task.id} class="rounded-lg border border-border bg-surface transition-opacity {completing ? 'opacity-60' : ''}">
  <div class="flex items-start gap-2 p-2">
    {#if draggable}
      <button
        type="button"
        data-drag-handle
        class="-mr-1 flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded text-text-muted/60 hover:text-text-muted focus:text-text"
        style="touch-action: none;"
        aria-label="Drag {task.name} to move it, or use the arrow keys"
      ><GripVertical size={14} aria-hidden="true" /></button>
    {/if}
    <div class="pt-0.5"><TaskCheck size="sm" done={!!task.completedAt || completing} name={task.name} onclick={check} /></div>
    <button type="button" class="min-w-0 flex-1 text-left" onclick={() => taskUi.show(task.id)}>
      <span class="line-clamp-3 break-words text-sm {task.completedAt || completing ? 'text-text-muted line-through' : 'text-text'}">{task.name || 'Untitled task'}</span>
    </button>
  </div>
  {#if due || progress || task.notes}
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-2 pb-2 {draggable ? 'pl-[3.5rem]' : 'pl-[2.25rem]'} text-xs text-text-muted">
      {#if due}
        <button
          type="button"
          class="-ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium hover:bg-surface-2"
          style="color: {DUE_COLORS[due.state]};"
          onclick={() => (taskUi.rescheduleId = task.id)}
          aria-label="Due {due.text}{task.repeat ? ', repeats' : ''}. Reschedule {task.name}"
        >
          {due.text}{#if task.repeat}<Repeat size={11} aria-hidden="true" />{/if}
        </button>
      {/if}
      {#if progress}
        <span aria-label="{progress.done} of {progress.total} subtasks done">{progress.done}/{progress.total}</span>
      {/if}
      {#if task.notes}
        <NotebookText size={12} aria-label="has notes" />
      {/if}
    </div>
  {/if}
</li>
