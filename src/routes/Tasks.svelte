<script lang="ts">
  import { liveQuery } from 'dexie';
  import { link, push } from 'svelte-spa-router';
  import Inbox from '@lucide/svelte/icons/inbox';
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import { db, updateTaskProject, type TaskProject } from '../lib/db';
  import { dayKey, INBOX_ID, orderProjects, projectSummary, type ProjectSummary } from '../lib/utils/tasks';
  import { moveInOrder } from '../lib/utils/trackableList';
  import { readableGraphic } from '../lib/utils/color';
  import { themeStore } from '../lib/stores/theme.svelte';
  import BottomSheet from '../lib/components/BottomSheet.svelte';
  import ProjectSheet from '../lib/components/ProjectSheet.svelte';
  import EmptyState from '../lib/components/ui/EmptyState.svelte';
  import Button from '../lib/components/ui/Button.svelte';
  import HelpLink from '../lib/components/HelpLink.svelte';
  import { onMount } from 'svelte';
  import { takeShortcut } from '../lib/utils/shortcuts';
  import { quickAdd } from '../lib/stores/quickAdd.svelte';

  // The Tasks tab (ARCHITECTURE.md 3.60): every project with its open tasks
  // and what's due, the inbox of tasks without a project, + Project and + Task.
  const projects = liveQuery(() => db.taskProjects.toArray());
  const tasks = liveQuery(() => db.tasks.toArray());

  const today = dayKey(Date.now());
  const ordered = $derived(orderProjects($projects ?? []));
  const inbox = $derived(projectSummary($tasks ?? [], INBOX_ID, today));
  let showArchived = $state(false);
  let reordering = $state(false);

  let sheetOpen = $state(false);

  // The home-screen shortcut "Add a task" opens here with the sheet up.
  onMount(() => {
    if (takeShortcut('add-task')) quickAdd.show();
  });

  async function move(p: TaskProject, direction: -1 | 1) {
    const list = ordered.active;
    const current = new Map(list.map((x) => [x.id, x.sortOrder]));
    for (const change of moveInOrder(list.map((x) => x.id), p.id, direction, current)) {
      await updateTaskProject(change.id, { sortOrder: change.sortOrder });
    }
  }

  function summaryText(s: ProjectSummary): string {
    if (s.open === 0) return 'Nothing open';
    return `${s.open} open`;
  }
</script>

{#snippet dueBits(s: ProjectSummary)}
  {#if s.overdue > 0}
    <span class="text-danger">{s.overdue} overdue</span>
  {/if}
  {#if s.dueToday > 0}
    <span class="text-warn">{s.dueToday} due today</span>
  {/if}
  {#if s.next && s.next.state !== 'today'}
    <span>next {s.next.text}</span>
  {/if}
{/snippet}

<div class="mx-auto flex w-full flex-1 flex-col gap-3 px-5 py-6">
  <div class="flex items-center justify-between">
    <h1 class="flex items-center gap-2 text-xl font-semibold text-text">Tasks <HelpLink topic="tasks" label="tasks" /></h1>
    <div class="flex items-center gap-2">
      <button class="rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-text" onclick={() => (sheetOpen = true)}>+ Project</button>
      <button class="rounded-full px-3 py-1.5 text-sm font-semibold bg-brand text-brand-fg" onclick={() => quickAdd.show()}>+ Task</button>
    </div>
  </div>

  {#if $projects === undefined || $tasks === undefined}
    <p class="text-sm text-text-muted">Loading&hellip;</p>
  {:else}
    {#if ordered.active.length === 0 && inbox.open === 0}
      <EmptyState icon="&#x2705;" title="No projects yet" text="A project holds tasks, in sections if you like, and each task can have subtasks and a due date.">
        {#snippet action()}
          <Button variant="primary" onclick={() => (sheetOpen = true)}>New project</Button>
        {/snippet}
      </EmptyState>
    {/if}

    <ul class="flex flex-col gap-2 lg:grid lg:grid-cols-2 2xl:grid-cols-3" aria-label="Projects">
      <li>
        <a href="/tasks/{INBOX_ID}" use:link class="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:bg-surface-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-2 text-text-muted"><Inbox size={18} aria-hidden="true" /></span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-text">Inbox</span>
            <span class="flex flex-wrap gap-x-2 text-xs text-text-muted">
              <span>{inbox.open === 0 ? 'Tasks without a project' : summaryText(inbox)}</span>
              {@render dueBits(inbox)}
            </span>
          </span>
        </a>
      </li>
      {#each ordered.active as p (p.id)}
        {@const s = projectSummary($tasks, p.id, today)}
        {@const ink = readableGraphic(p.color, themeStore.effective)}
        <li class="flex items-center gap-2">
          <a href="/tasks/{p.id}" use:link class="flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:bg-surface-2" style="border-left: 4px solid {ink};">
            <span class="flex h-9 w-9 items-center justify-center rounded-xl text-lg" style="background: {ink}22;">{p.icon || p.name.slice(0, 1).toUpperCase()}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-text">{p.name}</span>
              <span class="flex flex-wrap gap-x-2 text-xs text-text-muted">
                <span>{summaryText(s)}</span>
                {@render dueBits(s)}
              </span>
            </span>
          </a>
          {#if reordering}
            <span class="flex shrink-0 flex-col">
              <button type="button" class="rounded-lg p-1 text-text-muted hover:bg-surface-2" onclick={() => move(p, -1)} aria-label="Move {p.name} up"><ArrowUp size={16} aria-hidden="true" /></button>
              <button type="button" class="rounded-lg p-1 text-text-muted hover:bg-surface-2" onclick={() => move(p, 1)} aria-label="Move {p.name} down"><ArrowDown size={16} aria-hidden="true" /></button>
            </span>
          {/if}
        </li>
      {/each}
    </ul>

    <div class="flex items-center gap-4">
      {#if ordered.active.length > 1}
        <button class="text-sm text-text-muted" onclick={() => (reordering = !reordering)}>{reordering ? 'Done' : 'Reorder'}</button>
      {/if}
      {#if ordered.archived.length > 0}
        <button class="text-sm text-text-muted" onclick={() => (showArchived = !showArchived)} aria-expanded={showArchived}>
          {showArchived ? 'Hide' : 'Show'} archived ({ordered.archived.length})
        </button>
      {/if}
    </div>
    {#if showArchived}
      <ul class="flex flex-col gap-2 opacity-70" aria-label="Archived projects">
        {#each ordered.archived as p (p.id)}
          <li>
            <a href="/tasks/{p.id}" use:link class="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:bg-surface-2">
              <span class="w-9 text-center text-lg">{p.icon || p.name.slice(0, 1).toUpperCase()}</span>
              <span class="truncate text-text">{p.name}</span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<BottomSheet bind:open={sheetOpen}>
  <ProjectSheet bind:open={sheetOpen} project={null} tasks={$tasks ?? []} onSaved={(id) => push(`/tasks/${id}`)} />
</BottomSheet>
