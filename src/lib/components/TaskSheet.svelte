<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import { createTask, deleteTask, updateTask, type Task, type TaskProject } from '../db';
  import { INBOX_ID, nextSortOrder, parentChain, subtaskProgress, subtasksOf } from '../utils/tasks';
  import { taskUi } from '../stores/taskUi.svelte';
  import TaskCheck from './TaskCheck.svelte';
  import Button from './ui/Button.svelte';

  // One task, edited in place: every change saves as it's made, like Asana's
  // task pane. Subtasks open in the same sheet, with a way back to the parent.
  let {
    tasks,
    projects,
  }: {
    tasks: readonly Task[];
    projects: readonly TaskProject[];
  } = $props();

  const task = $derived(tasks.find((t) => t.id === taskUi.taskId) ?? null);
  const chain = $derived(task ? parentChain(tasks, task) : []);
  const subtasks = $derived(task ? subtasksOf(tasks, task.id) : []);
  const progress = $derived(task ? subtaskProgress(tasks, task.id) : null);
  const project = $derived(task?.projectId ? projects.find((p) => p.id === task.projectId) : undefined);
  const activeProjects = $derived(projects.filter((p) => !p.archived || p.id === task?.projectId));

  let newSubtask = $state('');
  let confirmDelete = $state(false);
  let error = $state<string | null>(null);

  // A different task starts without a pending delete question.
  $effect(() => {
    void taskUi.taskId;
    confirmDelete = false;
    error = null;
  });

  async function save(patch: Partial<Task>) {
    if (!task) return;
    error = null;
    try {
      await updateTask(task.id, patch);
    } catch (err) {
      error = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  function rename(value: string) {
    const name = value.trim();
    if (name && name !== task?.name) void save({ name });
  }

  function setDue(value: string) {
    // No date means no time either; a repeat rule (later) needs a date too.
    void save(value ? { dueOn: value } : { dueOn: undefined, dueTime: undefined });
  }

  function moveTo(projectId: string) {
    void save({ projectId: projectId === INBOX_ID ? undefined : projectId, sectionId: undefined });
  }

  async function addSubtask() {
    const name = newSubtask.trim();
    if (!task || !name) return;
    // Cleared first, so typing the next one straight away starts empty.
    newSubtask = '';
    await createTask({ name, parentId: task.id, sortOrder: nextSortOrder(subtasks) });
  }

  async function remove() {
    if (!task) return;
    const parentId = task.parentId;
    await deleteTask(task.id);
    confirmDelete = false;
    // A deleted subtask goes back to its parent; a deleted task closes the sheet.
    if (parentId) taskUi.show(parentId);
    else taskUi.open = false;
  }

  const inputClass = 'w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted border-border';
</script>

{#if !task}
  <p class="text-sm text-text-muted">This task is no longer here. It may have been deleted on another device.</p>
{:else}
  <div class="space-y-4">
    {#if chain.length > 0}
      {@const parent = chain[chain.length - 1]}
      <button type="button" class="flex items-center gap-1 text-sm text-text-muted" onclick={() => taskUi.show(parent.id)}>
        <ChevronLeft size={16} aria-hidden="true" />
        <span class="truncate">Subtask of {parent.name}</span>
      </button>
    {/if}

    <div class="flex items-start gap-3">
      <div class="pt-2.5"><TaskCheck done={!!task.completedAt} name={task.name} onclick={() => taskUi.toggle(task)} /></div>
      <label class="block min-w-0 flex-1 text-sm">
        <span class="sr-only">Task name</span>
        {#key task.id}
          <input
            type="text"
            value={task.name}
            onchange={(e) => rename(e.currentTarget.value)}
            onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            class="{inputClass} font-heading text-base font-semibold"
            aria-label="Task name"
          />
        {/key}
      </label>
    </div>
    {#if task.completedAt}
      <p class="text-xs text-text-muted">Completed {new Date(task.completedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>
    {/if}

    {#if !task.parentId}
      <div class="grid grid-cols-2 gap-2">
        <label class="block text-sm">
          <span class="mb-1 block text-text-muted">Project</span>
          <select class={inputClass} value={task.projectId ?? INBOX_ID} onchange={(e) => moveTo(e.currentTarget.value)}>
            <option value={INBOX_ID}>Inbox (no project)</option>
            {#each activeProjects as p (p.id)}
              <option value={p.id}>{p.icon ? `${p.icon} ` : ''}{p.name}</option>
            {/each}
          </select>
        </label>
        {#if project && project.sections.length > 0}
          <label class="block text-sm">
            <span class="mb-1 block text-text-muted">Section</span>
            <select
              class={inputClass}
              value={task.sectionId && project.sections.some((s) => s.id === task.sectionId) ? task.sectionId : ''}
              onchange={(e) => save({ sectionId: e.currentTarget.value || undefined })}
            >
              <option value="">(none)</option>
              {#each project.sections as s (s.id)}
                <option value={s.id}>{s.name}</option>
              {/each}
            </select>
          </label>
        {/if}
      </div>
    {/if}

    <div class="grid grid-cols-[1fr_auto] items-end gap-2">
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Due date</span>
        <input type="date" class={inputClass} value={task.dueOn ?? ''} onchange={(e) => setDue(e.currentTarget.value)} />
      </label>
      {#if task.dueOn}
        <label class="block text-sm">
          <span class="mb-1 block text-text-muted">Time (optional)</span>
          <input type="time" class={inputClass} value={task.dueTime ?? ''} onchange={(e) => save({ dueTime: e.currentTarget.value || undefined })} />
        </label>
      {/if}
    </div>
    {#if task.dueOn}
      <button type="button" class="-mt-2 text-xs text-text-muted" onclick={() => setDue('')}>Clear due date</button>
    {/if}

    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Notes</span>
      {#key task.id}
        <textarea
          rows="3"
          class={inputClass}
          value={task.notes ?? ''}
          placeholder="Anything to remember about it"
          onchange={(e) => save({ notes: e.currentTarget.value.trim() ? e.currentTarget.value : undefined })}
        ></textarea>
      {/key}
    </label>

    <section aria-label="Subtasks" class="space-y-1">
      <p class="text-sm text-text-muted">
        Subtasks{#if progress}<span> &middot; {progress.done} of {progress.total} done</span>{/if}
      </p>
      {#if subtasks.length > 0}
        <ul class="flex flex-col">
          {#each subtasks as s (s.id)}
            {@const sp = subtaskProgress(tasks, s.id)}
            <li class="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-2">
              <TaskCheck size="sm" done={!!s.completedAt} name={s.name} onclick={() => taskUi.toggle(s)} />
              <button type="button" class="min-w-0 flex-1 truncate text-left text-sm {s.completedAt ? 'text-text-muted line-through' : 'text-text'}" onclick={() => taskUi.show(s.id)}>
                {s.name}
              </button>
              {#if sp}
                <span class="shrink-0 text-xs text-text-muted">{sp.done}/{sp.total}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      <form
        class="flex gap-2"
        onsubmit={(e) => {
          e.preventDefault();
          void addSubtask();
        }}
      >
        <input type="text" bind:value={newSubtask} placeholder="Add a subtask" aria-label="New subtask" class="{inputClass} text-sm" />
        <Button type="submit" size="md" disabled={!newSubtask.trim()}>Add</Button>
      </form>
    </section>

    {#if error}
      <p class="text-sm text-danger">{error}</p>
    {/if}

    <div class="border-t border-border pt-3">
      {#if confirmDelete}
        <p class="mb-2 text-sm text-text">
          Delete this task{progress ? ` and its ${progress.total} subtask${progress.total === 1 ? '' : 's'}` : ''}? This can't be undone.
        </p>
        <div class="flex gap-2">
          <Button variant="danger" onclick={remove}>Delete</Button>
          <Button variant="ghost" onclick={() => (confirmDelete = false)}>Keep it</Button>
        </div>
      {:else}
        <Button variant="danger" size="sm" onclick={() => (confirmDelete = true)}>Delete task</Button>
      {/if}
    </div>
  </div>
{/if}
