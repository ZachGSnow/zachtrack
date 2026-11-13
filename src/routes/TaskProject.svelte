<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { liveQuery } from 'dexie';
  import { link, push } from 'svelte-spa-router';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { createTask, db, updateTask, updateTaskProject } from '../lib/db';
  import { dayKey, groupBySection, INBOX_ID, nextSortOrder, topLevelTasks, type SectionGroup } from '../lib/utils/tasks';
  import { moveManyTo, renumber } from '../lib/utils/reorder';
  import { taskUi } from '../lib/stores/taskUi.svelte';
  import { sortable, type DropEvent } from '../lib/actions/sortable';
  import { describeQuickAdd, parseQuickAdd } from '../lib/utils/quickAdd';
  import { describeDue } from '../lib/utils/tasks';
  import { loadPrefs, savePrefs } from '../lib/utils/prefs';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import ProjectSheet from '../lib/components/ProjectSheet.svelte';
  import SegmentedControl from '../lib/components/SegmentedControl.svelte';
  import TaskBoard from '../lib/components/TaskBoard.svelte';
  import TaskHost from '../lib/components/TaskHost.svelte';
  import TaskRow from '../lib/components/TaskRow.svelte';

  // One project (or the inbox): its tasks by section, a box to add a task to
  // each section, completed tasks on request, and drag and drop within and
  // between sections (3.60, 3.65). A project shows as a list or a board of
  // columns (TaskBoard.svelte, 3.76), chosen per project on each device.
  // Ctrl+click selects several open tasks, which then drag as one (3.77).
  let { params }: { params: { id: string } } = $props();

  const projects = liveQuery(() => db.taskProjects.toArray());
  const tasks = liveQuery(() => db.tasks.toArray());

  const isInbox = $derived(params.id === INBOX_ID);
  const project = $derived(isInbox ? null : (($projects ?? []).find((p) => p.id === params.id) ?? null));
  const groups = $derived(groupBySection(project, topLevelTasks($tasks ?? [], params.id)));
  const doneCount = $derived(groups.reduce((n, g) => n + g.done.length, 0));
  const openCount = $derived(groups.reduce((n, g) => n + g.open.length, 0));
  const today = dayKey(Date.now());

  // Per device, like the other view choices: which sections are folded, completed tasks shown, and which projects are boards.
  const PREFS_KEY = 'task-view';
  const saved = loadPrefs<{ collapsed: unknown; showDone: unknown; boards: unknown }>(PREFS_KEY, { collapsed: [], showDone: false, boards: [] });
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  let collapsed = $state<string[]>(strings(saved.collapsed));
  let showDone = $state(saved.showDone === true);
  let boards = $state<string[]>(strings(saved.boards));
  $effect(() => {
    savePrefs(PREFS_KEY, { collapsed: [...collapsed], showDone, boards: [...boards] });
  });
  type Layout = 'list' | 'board';
  const LAYOUTS: { id: Layout; label: string }[] = [
    { id: 'list', label: 'List' },
    { id: 'board', label: 'Board' },
  ];
  const layout = $derived<Layout>(project && boards.includes(project.id) ? 'board' : 'list');
  function setLayout(next: Layout) {
    if (!project) return;
    const id = project.id;
    boards = next === 'board' ? [...boards.filter((x) => x !== id), id] : boards.filter((x) => x !== id);
  }
  // A project without sections still gets a column to add its first task to.
  const boardGroups = $derived<SectionGroup[]>(groups.length > 0 ? groups : [{ section: null, open: [], done: [] }]);
  const keyOf = (g: SectionGroup) => g.section?.id ?? `${params.id}:top`;
  function toggleCollapsed(g: SectionGroup) {
    const k = keyOf(g);
    collapsed = collapsed.includes(k) ? collapsed.filter((x) => x !== k) : [...collapsed, k];
  }

  let editOpen = $state(false);

  // The text in each section's add box, by section key.
  let drafts = $state<Record<string, string>>({});

  /** What a typed date in an add box will set, shown under it. */
  function draftPreview(text: string | undefined): string {
    return text?.trim() ? describeQuickAdd(parseQuickAdd(text, today), (d, t) => describeDue(d, t, today).text) : '';
  }

  async function add(g: SectionGroup) {
    const k = keyOf(g);
    const name = (drafts[k] ?? '').trim();
    if (!name) return;
    // Cleared first, so typing the next one straight away starts empty.
    drafts = { ...drafts, [k]: '' };
    await addTask(g, name);
  }

  /** A task typed into a section's (or a column's) add box. */
  async function addTask(g: SectionGroup, name: string) {
    // A date typed at the end sets the due date and repeat (3.64).
    const q = parseQuickAdd(name, today);
    await createTask({
      name: q.name,
      ...(q.dueOn ? { dueOn: q.dueOn } : {}),
      ...(q.dueTime ? { dueTime: q.dueTime } : {}),
      ...(q.repeat ? { repeat: q.repeat } : {}),
      ...(project ? { projectId: project.id } : {}),
      ...(g.section ? { sectionId: g.section.id } : {}),
      sortOrder: nextSortOrder([...g.open, ...g.done]),
    });
  }

  // Ctrl+click selects on this page only; leaving it, or another project, starts with nothing selected.
  taskUi.selectable = true;
  $effect(() => {
    void params.id;
    // Untracked: reading the selection here would clear every new pick.
    untrack(() => taskUi.clearSelection());
  });
  onDestroy(() => {
    taskUi.selectable = false;
    taskUi.clearSelection();
  });

  /**
   * Tasks dropped at `index` in a section's open tasks: one, or every selected
   * one (3.77), maybe from other sections. They keep the order they showed in.
   */
  async function drop(e: DropEvent) {
    const target = groups.find((g) => keyOf(g) === e.to);
    if (!target) return;
    const moving = groups.flatMap((g) => g.open.map((t) => t.id)).filter((id) => e.ids.includes(id));
    if (moving.length === 0) return;
    const order = moveManyTo(
      target.open.map((t) => t.id),
      moving,
      e.index,
    );
    const changes = renumber(order, new Map(target.open.map((t) => [t.id, t.sortOrder])));
    const here = new Set(target.open.map((t) => t.id));
    for (const c of changes) await updateTask(c.id, { sortOrder: c.sortOrder, ...(here.has(c.id) ? {} : { sectionId: target.section?.id }) });
    if (moving.length > 1) taskUi.clearSelection();
  }

  /** Arrow Up / Down on a task's handle: one place within its section. */
  function keyMove(g: SectionGroup, id: string, direction: -1 | 1) {
    const at = g.open.findIndex((t) => t.id === id);
    if (at < 0 || at + direction < 0 || at + direction >= g.open.length) return;
    void drop({ id, ids: [id], from: keyOf(g), to: keyOf(g), index: at + direction });
  }
</script>

<div class="mx-auto flex w-full min-w-0 flex-1 flex-col gap-3 px-5 py-6">
  <a href="/tasks" use:link class="flex items-center gap-1 self-start text-sm text-text-muted"><ChevronLeft size={16} aria-hidden="true" /> Projects</a>

  {#if $projects === undefined || $tasks === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else if !isInbox && !project}
    <p class="text-sm text-text-muted">This project is no longer here. It may have been deleted on another device.</p>
  {:else}
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="truncate text-xl font-semibold text-text">
          {#if project?.icon}<span aria-hidden="true">{project.icon} </span>{/if}{project ? project.name : 'Inbox'}
        </h1>
        <p class="text-sm text-text-muted">
          {openCount} open{doneCount ? `, ${doneCount} completed` : ''}{isInbox ? ' - tasks without a project' : ''}
        </p>
      </div>
      {#if project}
        <button type="button" class="flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm text-text-muted" onclick={() => (editOpen = true)}>
          <Pencil size={14} aria-hidden="true" /> Edit
        </button>
      {/if}
    </div>
    {#if project?.notes}
      <p class="whitespace-pre-line text-sm text-text-muted">{project.notes}</p>
    {/if}
    {#if project?.archived}
      <div class="flex items-center justify-between gap-2 rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm">
        <span class="text-text-muted">Archived: hidden from the project list.</span>
        <button class="font-semibold text-brand" onclick={() => updateTaskProject(project.id, { archived: false })}>Unarchive</button>
      </div>
    {/if}

    <div class="flex items-center justify-between gap-4">
      {#if doneCount > 0}
        <button class="text-sm text-text-muted" onclick={() => (showDone = !showDone)} aria-pressed={showDone}>{showDone ? 'Hide' : 'Show'} completed ({doneCount})</button>
      {:else}
        <span></span>
      {/if}
      {#if project}
        <SegmentedControl options={LAYOUTS} value={layout} onchange={setLayout} label="Layout" />
      {/if}
    </div>

    {#if taskUi.selected.length > 0}
      <div class="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-xl border border-brand bg-surface px-3 py-2 text-sm shadow-lg" role="status">
        <span class="text-text"><strong>{taskUi.selected.length} selected.</strong> Drag one to move them all; Esc clears.</span>
        <button type="button" class="font-semibold text-brand" onclick={() => taskUi.clearSelection()}>Clear</button>
      </div>
    {/if}

    {#if project && layout === 'board'}
      <TaskBoard {project} groups={boardGroups} tasks={$tasks} {today} {showDone} {keyOf} onDrop={drop} onKeyMove={keyMove} onAdd={addTask} />
    {:else}
      {#each groups as g (keyOf(g))}
        {@const k = keyOf(g)}
        {@const folded = collapsed.includes(k)}
        <section class="flex flex-col gap-1" aria-label={g.section?.name ?? 'Tasks'}>
          {#if g.section}
            <button type="button" class="flex items-center gap-1.5 self-start pt-2 text-left" onclick={() => toggleCollapsed(g)} aria-expanded={!folded}>
              {#if folded}<ChevronRight size={16} class="text-text-muted" aria-hidden="true" />{:else}<ChevronDown size={16} class="text-text-muted" aria-hidden="true" />{/if}
              <span class="font-heading text-sm font-semibold text-text">{g.section.name}</span>
              <span class="text-xs text-text-muted">{g.open.length}</span>
            </button>
          {/if}
          {#if !folded}
            <!-- Always there, even empty, so a task can be dropped into an empty section. -->
            <ul
              class="flex min-h-2 flex-col"
              use:sortable={{
                group: `tasks:${params.id}`,
                zone: k,
                onDrop: drop,
                onKeyMove: (id, d) => keyMove(g, id, d),
                mouseAnywhere: true,
                selection: () => taskUi.selected,
              }}
            >
              {#each g.open as t (t.id)}
                <TaskRow task={t} tasks={$tasks} {today} draggable />
              {/each}
            </ul>
            {#if showDone && g.done.length > 0}
              <ul class="flex flex-col" aria-label="Completed in {g.section?.name ?? 'this project'}">
                {#each g.done as t (t.id)}
                  <TaskRow task={t} tasks={$tasks} {today} />
                {/each}
              </ul>
            {/if}
            {#if true}
              <form
                class="pl-11"
                onsubmit={(e) => {
                  e.preventDefault();
                  void add(g);
                }}
              >
                <input
                  type="text"
                  bind:value={drafts[k]}
                  placeholder="+ Add a task"
                  aria-label="Add a task{g.section ? ` to ${g.section.name}` : ''}"
                  class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-border"
                />
                {#if draftPreview(drafts[k])}
                  <p class="px-2 text-xs text-brand">{draftPreview(drafts[k])}</p>
                {/if}
              </form>
            {/if}
          {/if}
        </section>
      {/each}

      {#if groups.length === 0}
        <!-- The inbox, or a project with no sections, before its first task still needs somewhere to type. -->
        <form
          onsubmit={(e) => {
            e.preventDefault();
            void add({ section: null, open: [], done: [] });
          }}
        >
          <input type="text" bind:value={drafts[`${params.id}:top`]} placeholder="+ Add a task" aria-label="Add a task" class="w-full rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-muted" />
        </form>
      {/if}
    {/if}
  {/if}
</div>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && taskUi.selected.length > 0 && !taskUi.open && !taskUi.menuId && !taskUi.rescheduleId) taskUi.clearSelection();
  }}
/>

<TaskHost tasks={$tasks ?? []} projects={$projects ?? []} />

<BottomSheet bind:open={editOpen}>
  <ProjectSheet bind:open={editOpen} {project} tasks={$tasks ?? []} onDeleted={() => push('/tasks')} />
</BottomSheet>
