<script lang="ts">
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import type { Task } from '../db';
  import { describeDue, subtaskProgress, type DueState } from '../utils/tasks';
  import { taskUi } from '../stores/taskUi.svelte';
  import TaskCheck from './TaskCheck.svelte';

  // One task in a list: its checkbox, name, due date, subtask count and a
  // mark when it has notes. Tapping the row opens the task sheet.
  let {
    task,
    tasks,
    today,
    onMove,
  }: {
    task: Task;
    /** Every task, for the subtask count. */
    tasks: readonly Task[];
    today: string;
    /** Reorder mode: up and down buttons instead of opening the sheet. */
    onMove?: (direction: -1 | 1) => void;
  } = $props();

  const due = $derived(task.dueOn ? describeDue(task.dueOn, task.dueTime, today) : null);
  const progress = $derived(subtaskProgress(tasks, task.id));
  const DUE_COLORS: Record<DueState, string> = {
    overdue: 'var(--color-danger)',
    today: 'var(--color-warn)',
    soon: 'var(--color-text)',
    later: 'var(--color-text-muted)',
  };
</script>

<li class="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-surface-2">
  <TaskCheck done={!!task.completedAt} name={task.name} onclick={() => taskUi.toggle(task)} />
  <button type="button" class="min-w-0 flex-1 text-left" onclick={() => taskUi.show(task.id)} disabled={!!onMove}>
    <span class="block truncate text-sm {task.completedAt ? 'text-text-muted line-through' : 'text-text'}">{task.name || 'Untitled task'}</span>
    {#if (due && !task.completedAt) || progress || task.notes}
      <span class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
        {#if due && !task.completedAt}
          <span style="color: {DUE_COLORS[due.state]};">{due.text}</span>
        {/if}
        {#if progress}
          <span aria-label="{progress.done} of {progress.total} subtasks done">{progress.done}/{progress.total} subtasks</span>
        {/if}
        {#if task.notes}
          <span>Notes</span>
        {/if}
      </span>
    {/if}
  </button>
  {#if onMove}
    <span class="flex shrink-0 gap-1">
      <button type="button" class="rounded-lg p-1.5 text-text-muted hover:bg-surface" onclick={() => onMove(-1)} aria-label="Move {task.name} up"><ArrowUp size={16} aria-hidden="true" /></button>
      <button type="button" class="rounded-lg p-1.5 text-text-muted hover:bg-surface" onclick={() => onMove(1)} aria-label="Move {task.name} down"><ArrowDown size={16} aria-hidden="true" /></button>
    </span>
  {/if}
</li>
