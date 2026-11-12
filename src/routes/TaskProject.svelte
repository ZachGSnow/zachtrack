<script lang="ts">
  import { liveQuery } from 'dexie';
  import { link, push } from 'svelte-spa-router';
  import ChevronLeft from '@lucide/svelte/icons/chevron-left';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import Pencil from '@lucide/svelte/icons/pencil';
  import { createTask, db, updateTask, updateTaskProject, type Task } from '../lib/db';
  import { dayKey, groupBySection, INBOX_ID, nextSortOrder, topLevelTasks, type SectionGroup } from '../lib/utils/tasks';
  import { moveInOrder } from '../lib/utils/trackableList';
  import { loadPrefs, savePrefs } from '../lib/utils/prefs';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import ProjectSheet from '../lib/components/ProjectSheet.svelte';
  import TaskHost from '../lib/components/TaskHost.svelte';
  import TaskRow from '../lib/components/TaskRow.svelte';

  // One project (or the inbox): its tasks by section, a box to add a task to
  // each section, completed tasks on request, and reordering (3.60).
  let { params }: { params: { id: string } } = $props();

  const projects = liveQuery(() => db.taskProjects.toArray());
  const tasks = liveQuery(() => db.tasks.toArray());

  const isInbox = $derived(params.id === INBOX_ID);
  const project = $derived(isInbox ? null : (($projects ?? []).find((p) => p.id === params.id) ?? null));
  const groups = $derived(groupBySection(project, topLevelTasks($tasks ?? [], params.id)));
  const doneCount = $derived(groups.reduce((n, g) => n + g.done.length, 0));
  const openCount = $derived(groups.reduce((n, g) => n + g.open.length, 0));
  const today = dayKey(Date.now());

  // Per device, like the other view choices: which sections are folded, and completed tasks shown.
  const PREFS_KEY = 'task-view';
  const saved = loadPrefs<{ collapsed: unknown; showDone: unknown }>(PREFS_KEY, { collapsed: [], showDone: false });
  let collapsed = $state<string[]>(Array.isArray(saved.collapsed) ? saved.collapsed.filter((x): x is string => typeof x === 'string') : []);
  let showDone = $state(saved.showDone === true);
  $effect(() => {
    savePrefs(PREFS_KEY, { collapsed: [...collapsed], showDone });
  });
  const keyOf = (g: SectionGroup) => g.section?.id ?? `${params.id}:top`;
  function toggleCollapsed(g: SectionGroup) {
    const k = keyOf(g);
    collapsed = collapsed.includes(k) ? collapsed.filter((x) => x !== k) : [...collapsed, k];
  }

  let reordering = $state(false);
  let editOpen = $state(false);

  // The text in each section's add box, by section key.
  let drafts = $state<Record<string, string>>({});

  async function add(g: SectionGroup) {
    const k = keyOf(g);
    const name = (drafts[k] ?? '').trim();
    if (!name) return;
    // Cleared first, so typing the next one straight away starts empty.
    drafts = { ...drafts, [k]: '' };
    await createTask({
      name,
      ...(project ? { projectId: project.id } : {}),
      ...(g.section ? { sectionId: g.section.id } : {}),
      sortOrder: nextSortOrder([...g.open, ...g.done]),
    });
  }

  async function move(g: SectionGroup, t: Task, direction: -1 | 1) {
    const current = new Map(g.open.map((x) => [x.id, x.sortOrder]));
    for (const change of moveInOrder(g.open.map((x) => x.id), t.id, direction, current)) {
      await updateTask(change.id, { sortOrder: change.sortOrder });
    }
  }
</script>

<div class="mx-auto flex w-full flex-1 flex-col gap-3 px-5 py-6">
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

    <div class="flex items-center gap-4">
      {#if openCount > 1}
        <button class="text-sm text-text-muted" onclick={() => (reordering = !reordering)}>{reordering ? 'Done' : 'Reorder'}</button>
      {/if}
      {#if doneCount > 0}
        <button class="text-sm text-text-muted" onclick={() => (showDone = !showDone)} aria-pressed={showDone}>{showDone ? 'Hide' : 'Show'} completed ({doneCount})</button>
      {/if}
    </div>

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
          {#if g.open.length > 0 || (showDone && g.done.length > 0)}
            <ul class="flex flex-col">
              {#each g.open as t (t.id)}
                <TaskRow task={t} tasks={$tasks} {today} onMove={reordering ? (d) => move(g, t, d) : undefined} />
              {/each}
              {#if showDone}
                {#each g.done as t (t.id)}
                  <TaskRow task={t} tasks={$tasks} {today} />
                {/each}
              {/if}
            </ul>
          {/if}
          {#if !reordering}
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
</div>

<TaskHost tasks={$tasks ?? []} projects={$projects ?? []} />

<BottomSheet bind:open={editOpen}>
  <ProjectSheet bind:open={editOpen} {project} tasks={$tasks ?? []} onDeleted={() => push('/tasks')} />
</BottomSheet>
