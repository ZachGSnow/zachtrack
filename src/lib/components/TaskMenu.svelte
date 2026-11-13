<script lang="ts">
  import CalendarClock from '@lucide/svelte/icons/calendar-clock';
  import Copy from '@lucide/svelte/icons/copy';
  import PanelBottomOpen from '@lucide/svelte/icons/panel-bottom-open';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { deleteTask, duplicateTask, type Task, type TaskProject } from '../db';
  import { subtaskProgress } from '../utils/tasks';
  import { taskUi } from '../stores/taskUi.svelte';
  import SectionChips from './SectionChips.svelte';
  import Button from './ui/Button.svelte';

  // A task's quick menu (3.77), from a long press on a phone or a right-click:
  // the project's sections to move it to in one tap (the quick way across a
  // board's columns on a phone, where dragging is fiddly), then Open, Date,
  // Duplicate and Delete.
  let {
    task,
    tasks,
    projects,
    onclose,
  }: {
    task: Task;
    tasks: readonly Task[];
    projects: readonly TaskProject[];
    onclose: () => void;
  } = $props();

  const project = $derived(!task.parentId && task.projectId ? projects.find((p) => p.id === task.projectId) : undefined);
  const progress = $derived(subtaskProgress(tasks, task.id));
  let confirmDelete = $state(false);

  function open() {
    onclose();
    taskUi.show(task.id);
  }

  function date() {
    onclose();
    taskUi.rescheduleId = task.id;
  }

  async function duplicate() {
    const copy = await duplicateTask(task.id);
    onclose();
    if (copy) taskUi.show(copy.id);
  }

  async function remove() {
    await deleteTask(task.id);
    onclose();
  }

  const row = 'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-text hover:bg-surface-2';
</script>

<div class="space-y-4">
  <h2 class="line-clamp-2 text-lg font-semibold text-text">{task.name || 'Untitled task'}</h2>

  {#if project && project.sections.length > 0}
    <section aria-label="Move to" class="space-y-2">
      <p class="text-sm text-text-muted">Move to</p>
      <SectionChips {task} {project} onpicked={onclose} />
    </section>
  {/if}

  <div class="flex flex-col">
    <button type="button" class={row} onclick={open}><PanelBottomOpen size={18} class="text-text-muted" aria-hidden="true" /> Open</button>
    {#if !task.completedAt}
      <button type="button" class={row} onclick={date}><CalendarClock size={18} class="text-text-muted" aria-hidden="true" /> {task.dueOn ? 'Move the date' : 'Set a date'}</button>
    {/if}
    <button type="button" class={row} onclick={duplicate}><Copy size={18} class="text-text-muted" aria-hidden="true" /> Duplicate</button>
    {#if !confirmDelete}
      <button type="button" class="{row} text-danger" onclick={() => (confirmDelete = true)}><Trash2 size={18} aria-hidden="true" /> Delete</button>
    {:else}
      <div class="space-y-2 rounded-xl border border-danger-line p-3">
        <p class="text-sm text-text">
          Delete this task{progress ? ` and its ${progress.total} subtask${progress.total === 1 ? '' : 's'}` : ''}? This can't be undone.
        </p>
        <div class="flex gap-2">
          <Button variant="danger" onclick={remove}>Delete</Button>
          <Button variant="ghost" onclick={() => (confirmDelete = false)}>Keep it</Button>
        </div>
      </div>
    {/if}
  </div>
</div>
