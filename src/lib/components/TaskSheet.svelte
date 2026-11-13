<script lang="ts">
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import SkipForward from '@lucide/svelte/icons/skip-forward';
  import { createTask, deleteTask, duplicateTask, setTaskParent, updateTask, type Task, type TaskCompletion, type TaskProject } from '../db';
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import Copy from '@lucide/svelte/icons/copy';
  import { sortable, type DropEvent } from '../actions/sortable';
  import { moveTo as placeAt, renumber } from '../utils/reorder';
  import { rootOf } from '../utils/tasks';
  import { dayKey, daysFrom } from '../utils/tasks';
  import RepeatPicker from './RepeatPicker.svelte';
  import DateChoices from './DateChoices.svelte';
  import ExternalLink from '@lucide/svelte/icons/external-link';
  import { parseQuickAdd } from '../utils/quickAdd';
  import { linksIn } from '../utils/tasks';
  import { followDueDate } from '../utils/taskRepeat';
  import { INBOX_ID, nextSortOrder, parentChain, subtaskProgress, subtasksOf } from '../utils/tasks';
  import { taskUi } from '../stores/taskUi.svelte';
  import TaskCheck from './TaskCheck.svelte';
  import SectionChips from './SectionChips.svelte';
  import Button from './ui/Button.svelte';

  // One task, edited in place: every change saves as it's made, like Asana's
  // task pane. Subtasks open in the same sheet, with a way back to the parent.
  let {
    tasks,
    projects,
    completions = [],
  }: {
    tasks: readonly Task[];
    projects: readonly TaskProject[];
    /** Completions of repeating tasks, for the task's history. */
    completions?: readonly TaskCompletion[];
  } = $props();

  const task = $derived(tasks.find((t) => t.id === taskUi.taskId) ?? null);
  const chain = $derived(task ? parentChain(tasks, task) : []);
  const subtasks = $derived(task ? subtasksOf(tasks, task.id) : []);
  const progress = $derived(task ? subtaskProgress(tasks, task.id) : null);
  const project = $derived(task?.projectId ? projects.find((p) => p.id === task.projectId) : undefined);
  const activeProjects = $derived(projects.filter((p) => !p.archived || p.id === task?.projectId));
  const links = $derived(task?.notes ? linksIn(task.notes) : []);

  // Where it can go (3.65): another open task in the same project (or the
  // inbox), but not itself or one of its own subtasks.
  const below = $derived.by(() => {
    if (!task) return new Set<string>();
    const ids = new Set([task.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of tasks) if (t.parentId && ids.has(t.parentId) && !ids.has(t.id)) (ids.add(t.id), (grew = true));
    }
    return ids;
  });
  const parentChoices = $derived.by(() => {
    if (!task) return [];
    const home = rootOf(tasks, task).projectId;
    return tasks
      .filter((t) => !t.completedAt && !below.has(t.id) && rootOf(tasks, t).projectId === home)
      .map((t) => {
        const chain = parentChain(tasks, t);
        return { id: t.id, label: [...chain.map((c) => c.name), t.name].join(' / '), depth: chain.length };
      })
      .filter((c) => c.depth <= 2)
      .sort((a, b) => a.label.localeCompare(b.label));
  });

  async function setParent(value: string) {
    if (!task) return;
    const ok = await setTaskParent(task.id, value || null);
    if (!ok) error = "A task can't go under itself or one of its own subtasks.";
  }

  async function duplicate() {
    if (!task) return;
    const copy = await duplicateTask(task.id);
    if (copy) taskUi.show(copy.id);
  }

  /** A subtask dragged to a new place among the open ones. */
  async function dropSubtask(e: DropEvent) {
    const open = subtasks.filter((s) => !s.completedAt);
    const order = placeAt(open.map((s) => s.id), e.id, e.index);
    for (const c of renumber(order, new Map(open.map((s) => [s.id, s.sortOrder])))) await updateTask(c.id, { sortOrder: c.sortOrder });
  }
  function keyMoveSubtask(id: string, direction: -1 | 1) {
    const open = subtasks.filter((s) => !s.completedAt);
    const at = open.findIndex((s) => s.id === id);
    if (at < 0 || at + direction < 0 || at + direction >= open.length) return;
    void dropSubtask({ id, ids: [id], from: '', to: '', index: at + direction });
  }
  const history = $derived(task ? completions.filter((c) => c.taskId === task.id).sort((a, b) => b.completedAt - a.completedAt) : []);
  /** "on time", "3 days late", "1 day early": when it was done against its due date. */
  function timing(dueOn: string, completedAt: number): string {
    const late = daysFrom(dueOn, dayKey(completedAt));
    if (late === 0) return 'on time';
    const n = Math.abs(late);
    return `${n} day${n === 1 ? '' : 's'} ${late > 0 ? 'late' : 'early'}`;
  }
  const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

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
    // No date means no time and no repeat either; a repeat rule follows the date (followDueDate).
    if (!value) return void save({ dueOn: undefined, dueTime: undefined, repeat: undefined });
    const repeat = task?.repeat && task.dueOn ? followDueDate(task.repeat, task.dueOn, value) : task?.repeat;
    void save({ dueOn: value, ...(repeat ? { repeat } : {}) });
  }

  function moveTo(projectId: string) {
    void save({ projectId: projectId === INBOX_ID ? undefined : projectId, sectionId: undefined });
  }

  async function addSubtask() {
    const name = newSubtask.trim();
    if (!task || !name) return;
    // Cleared first, so typing the next one straight away starts empty.
    newSubtask = '';
    // A date typed at the end works here too ("Buy filters fri").
    const q = parseQuickAdd(name, dayKey(Date.now()));
    await createTask({
      name: q.name,
      parentId: task.id,
      ...(q.dueOn ? { dueOn: q.dueOn } : {}),
      ...(q.dueTime ? { dueTime: q.dueTime } : {}),
      ...(q.repeat ? { repeat: q.repeat } : {}),
      sortOrder: nextSortOrder(subtasks),
    });
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
      <div class="space-y-3">
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
          <div class="text-sm">
            <span class="mb-1 block text-text-muted">Section</span>
            <SectionChips {task} {project} allowNone />
          </div>
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
      <DateChoices dueOn={task.dueOn} onpick={(d) => setDue(d ?? '')} />
      {#if !task.completedAt}
        <RepeatPicker repeat={task.repeat} dueOn={task.dueOn} onchange={(repeat) => save({ repeat })} />
      {/if}
      {#if task.repeat && !task.completedAt}
        <button type="button" class="flex items-center gap-1.5 text-sm text-text-muted" onclick={() => taskUi.skip(task)}>
          <SkipForward size={14} aria-hidden="true" /> Skip this one
        </button>
      {/if}
    {:else}
      <DateChoices dueOn={undefined} onpick={(d) => setDue(d ?? '')} />
      <p class="text-xs text-text-muted">Set a due date to make it repeat.</p>
    {/if}
    {#if history.length > 0}
      <details class="text-sm">
        <summary class="cursor-pointer text-text-muted">Done {history.length} {history.length === 1 ? 'time' : 'times'}, last on {shortDate(history[0].completedAt)}</summary>
        <ul class="mt-1 space-y-0.5 text-xs text-text-muted" aria-label="Completion history">
          {#each history.slice(0, 20) as c (c.id)}
            <li>{shortDate(c.completedAt)}{c.dueOn ? ` (${timing(c.dueOn, c.completedAt)})` : ''}</li>
          {/each}
        </ul>
      </details>
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
    {#if links.length > 0}
      <ul class="-mt-2 flex flex-col gap-1 text-sm" aria-label="Links in the notes">
        {#each links as url (url)}
          <li>
            <a href={url} target="_blank" rel="noopener noreferrer" class="inline-flex max-w-full items-center gap-1.5 text-brand hover:underline">
              <ExternalLink size={14} class="shrink-0" aria-hidden="true" /><span class="truncate">{url.replace(/^https?:\/\/(www\.)?/, '')}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}

    <section aria-label="Subtasks" class="space-y-1">
      <p class="text-sm text-text-muted">
        Subtasks{#if progress}<span> &middot; {progress.done} of {progress.total} done</span>{/if}
      </p>
      {#if subtasks.length > 0}
        <ul class="flex flex-col" use:sortable={{ group: `subtasks:${task.id}`, zone: task.id, onDrop: dropSubtask, onKeyMove: keyMoveSubtask }}>
          {#each subtasks as s (s.id)}
            {@const sp = subtaskProgress(tasks, s.id)}
            <li class="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-surface-2" data-sort-id={s.completedAt ? undefined : s.id}>
              {#if !s.completedAt}
                <button
                  type="button"
                  data-drag-handle
                  class="-mx-1 flex h-7 w-5 shrink-0 cursor-grab items-center justify-center rounded text-text-muted/60 hover:text-text-muted"
                  style="touch-action: none;"
                  aria-label="Drag {s.name} to move it, or use the arrow keys"
                ><GripVertical size={14} aria-hidden="true" /></button>
              {:else}
                <span class="w-4 shrink-0"></span>
              {/if}
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

    <div class="space-y-2 border-t border-border pt-3">
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Subtask of</span>
        <select class={inputClass} value={task.parentId ?? ''} onchange={(e) => setParent(e.currentTarget.value)}>
          <option value="">(none: a task of its own)</option>
          {#each parentChoices as c (c.id)}
            <option value={c.id}>{c.label}</option>
          {/each}
        </select>
      </label>
      <Button size="sm" onclick={duplicate}><Copy size={14} aria-hidden="true" /> Duplicate</Button>
    </div>

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
