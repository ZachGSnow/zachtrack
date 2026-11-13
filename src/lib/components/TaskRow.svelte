<script lang="ts">
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Check from '@lucide/svelte/icons/check';
  import CalendarClock from '@lucide/svelte/icons/calendar-clock';
  import Repeat from '@lucide/svelte/icons/repeat';
  import NotebookText from '@lucide/svelte/icons/notebook-text';
  import type { Task } from '../db';
  import { describeDue, DUE_COLORS, subtaskProgress } from '../utils/tasks';
  import { taskUi } from '../stores/taskUi.svelte';
  import TaskCheck from './TaskCheck.svelte';

  // One task in a list: its checkbox, name, where it lives, subtask count, a
  // mark when it has notes, and its date on the right, which reschedules it
  // when tapped (3.64). Tapping the row opens the task sheet. On a list that
  // can be reordered it has a drag handle (actions/sortable.ts), and on a
  // touch screen a swipe right completes it and a swipe left moves its date
  // (3.65).
  let {
    task,
    tasks,
    today,
    context,
    draggable = false,
  }: {
    task: Task;
    /** Every task, for the subtask count. */
    tasks: readonly Task[];
    today: string;
    /** Where it lives, on a list that mixes projects (Upcoming, Today). */
    context?: string;
    /** Shows the drag handle; the list it's in has the sortable action. */
    draggable?: boolean;
  } = $props();

  const due = $derived(task.dueOn ? describeDue(task.dueOn, task.dueTime, today) : null);
  const progress = $derived(subtaskProgress(tasks, task.id));

  // The tick shows for a moment before a completed task leaves the list.
  let completing = $state(false);
  function check() {
    if (task.completedAt || completing) return void taskUi.toggle(task);
    completing = true;
    setTimeout(() => {
      void taskUi.toggle(task).finally(() => (completing = false));
    }, 350);
  }

  // Swipes, on a touch screen only: right completes, left moves the date.
  const SWIPE = 80;
  let dx = $state(0);
  let swiping = false;
  let start: { x: number; y: number; id: number } | null = null;
  let suppressClick = false;
  function down(e: PointerEvent) {
    if (e.pointerType !== 'touch' || (e.target as Element).closest('[data-drag-handle]')) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
    swiping = false;
  }
  function moveTouch(e: PointerEvent) {
    if (!start || e.pointerId !== start.id) return;
    const x = e.clientX - start.x;
    const y = e.clientY - start.y;
    if (!swiping) {
      if (Math.abs(y) > 12) return void (start = null); // a scroll
      if (Math.abs(x) < 12) return;
      swiping = true;
      try {
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
      } catch {
        // No capture for this pointer: the swipe still follows it while it stays on the row.
      }
    }
    dx = Math.max(-140, Math.min(140, x));
  }
  function up() {
    if (!start) return;
    start = null;
    if (!swiping) return;
    swiping = false;
    suppressClick = true;
    setTimeout(() => (suppressClick = false), 400);
    if (dx >= SWIPE && !task.completedAt) check();
    else if (dx >= SWIPE) void taskUi.toggle(task);
    else if (dx <= -SWIPE) taskUi.rescheduleId = task.id;
    dx = 0;
  }
  function swallow(e: MouseEvent) {
    if (!suppressClick) return;
    e.preventDefault();
    e.stopPropagation();
    suppressClick = false;
  }
</script>

<li
  data-sort-id={task.id}
  class="relative overflow-hidden rounded-xl {completing ? 'opacity-60' : ''}"
  style="touch-action: pan-y;"
  onpointerdown={down}
  onpointermove={moveTouch}
  onpointerup={up}
  onpointercancel={() => ((start = null), (swiping = false), (dx = 0))}
  onclickcapture={swallow}
>
  {#if dx !== 0}
    <!-- What letting go does. -->
    <div class="absolute inset-0 flex items-center px-4 text-sm font-semibold {dx > 0 ? 'justify-start bg-brand-soft text-brand' : 'justify-end bg-warn-soft text-warn'}" aria-hidden="true">
      {#if dx > 0}<Check size={18} />&nbsp;{task.completedAt ? 'Reopen' : 'Done'}{:else}Move date&nbsp;<CalendarClock size={18} />{/if}
    </div>
  {/if}
  <div
    class="relative flex items-center gap-3 rounded-xl px-2 py-2 transition-opacity hover:bg-surface-2"
    style={dx !== 0 ? `transform: translateX(${dx}px); background: var(--color-surface);` : ''}
  >
  {#if draggable}
    <button
      type="button"
      data-drag-handle
      class="-mr-2 flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded text-text-muted/60 hover:text-text-muted focus:text-text"
      style="touch-action: none;"
      aria-label="Drag {task.name} to move it, or use the arrow keys"
    ><GripVertical size={16} aria-hidden="true" /></button>
  {/if}
  <TaskCheck done={!!task.completedAt || completing} name={task.name} onclick={check} />
  <button type="button" class="min-w-0 flex-1 text-left" onclick={() => taskUi.show(task.id)}>
    <span class="block truncate text-sm {task.completedAt || completing ? 'text-text-muted line-through' : 'text-text'}">{task.name || 'Untitled task'}</span>
    {#if progress || task.notes || context}
      <span class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
        {#if context}
          <span class="truncate">{context}</span>
        {/if}
        {#if progress}
          <span aria-label="{progress.done} of {progress.total} subtasks done">{progress.done}/{progress.total} subtasks</span>
        {/if}
        {#if task.notes}
          <NotebookText size={12} aria-label="has notes" />
        {/if}
      </span>
    {/if}
  </button>
  {#if due && !task.completedAt}
    <button
      type="button"
      class="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-xs font-medium hover:bg-surface"
      style="color: {DUE_COLORS[due.state]};"
      onclick={() => (taskUi.rescheduleId = task.id)}
      aria-label="Due {due.text}{task.repeat ? ', repeats' : ''}. Reschedule {task.name}"
    >
      {due.text}{#if task.repeat}<Repeat size={11} aria-hidden="true" />{/if}
    </button>
  {/if}
  </div>
</li>
