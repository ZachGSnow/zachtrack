<script lang="ts">
  import { liveQuery } from 'dexie';
  import { tick } from 'svelte';
  import { createTask, db } from '../db';
  import { quickAdd } from '../stores/quickAdd.svelte';
  import { describeQuickAdd, parseQuickAdd } from '../utils/quickAdd';
  import { dayKey, describeDue, INBOX_ID, nextSortOrder } from '../utils/tasks';
  import BottomSheet from './BottomSheet.svelte';
  import Button from './ui/Button.svelte';

  // Add a task from anywhere (stores/quickAdd.svelte.ts): a name with its due
  // date and repeat typed at the end ("Pay bills fri"), and where it goes.
  // It stays open after adding, for the next one.
  const projects = liveQuery(() => db.taskProjects.toArray());

  let text = $state('');
  let ignoreDate = $state(false);
  let projectId = $state(INBOX_ID);
  let sectionId = $state('');
  let added = $state<string[]>([]);
  let input = $state<HTMLInputElement | null>(null);

  const today = $derived(dayKey(Date.now()));
  const parsed = $derived(parseQuickAdd(text, today));
  const preview = $derived(ignoreDate ? '' : describeQuickAdd(parsed, (d, t) => describeDue(d, t, today).text));
  const active = $derived(($projects ?? []).filter((p) => !p.archived || p.id === projectId).sort((a, b) => (a.sortOrder ?? 1e9) - (b.sortOrder ?? 1e9) || a.name.localeCompare(b.name)));
  const project = $derived(($projects ?? []).find((p) => p.id === projectId));

  // Each opening starts from where it was opened.
  $effect(() => {
    if (!quickAdd.open) return;
    projectId = quickAdd.projectId ?? INBOX_ID;
    sectionId = quickAdd.sectionId ?? '';
    text = '';
    ignoreDate = false;
    added = [];
    void tick().then(() => input?.focus());
  });

  // A typed date that's dropped comes back when the text changes.
  $effect(() => {
    void text;
    ignoreDate = false;
  });

  async function add() {
    const raw = text.trim();
    if (!raw) return;
    const q = ignoreDate ? { name: raw } : parsed;
    // Cleared first, so the next one can be typed straight away.
    text = '';
    const inProject = projectId !== INBOX_ID;
    const siblings = await db.tasks.filter((t) => !t.parentId && (inProject ? t.projectId === projectId : !t.projectId)).toArray();
    await createTask({
      name: q.name,
      ...(inProject ? { projectId } : {}),
      ...(inProject && sectionId ? { sectionId } : {}),
      ...('dueOn' in q && q.dueOn ? { dueOn: q.dueOn } : {}),
      ...('dueTime' in q && q.dueTime ? { dueTime: q.dueTime } : {}),
      ...('repeat' in q && q.repeat ? { repeat: q.repeat } : {}),
      sortOrder: nextSortOrder(siblings),
    });
    added = [...added, q.name];
    input?.focus();
  }

  const inputClass = 'w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted border-border';
</script>

<BottomSheet bind:open={quickAdd.open}>
  <form
    class="space-y-3"
    onsubmit={(e) => {
      e.preventDefault();
      void add();
    }}
  >
    <h2 class="text-lg font-semibold text-text">Add a task</h2>
    <label class="block text-sm">
      <span class="sr-only">Task</span>
      <input bind:this={input} type="text" bind:value={text} placeholder="e.g. Pay bills fri, or Water plants every 3 days" class={inputClass} aria-label="Task" />
    </label>
    {#if preview}
      <p class="flex items-center justify-between gap-2 text-xs text-brand" aria-live="polite">
        <span>{preview}</span>
        <button type="button" class="shrink-0 text-text-muted underline" onclick={() => (ignoreDate = true)}>Keep "{parsed.read.join(' ')}" in the name</button>
      </p>
    {/if}
    <div class="grid grid-cols-2 gap-2">
      <label class="block text-sm">
        <span class="mb-1 block text-text-muted">Project</span>
        <select class={inputClass} bind:value={projectId} onchange={() => (sectionId = '')}>
          <option value={INBOX_ID}>Inbox</option>
          {#each active as p (p.id)}
            <option value={p.id}>{p.icon ? `${p.icon} ` : ''}{p.name}</option>
          {/each}
        </select>
      </label>
      {#if project && project.sections.length > 0}
        <label class="block text-sm">
          <span class="mb-1 block text-text-muted">Section</span>
          <select class={inputClass} bind:value={sectionId}>
            <option value="">(top)</option>
            {#each project.sections as s (s.id)}
              <option value={s.id}>{s.name}</option>
            {/each}
          </select>
        </label>
      {/if}
    </div>
    <div class="flex gap-2">
      <Button type="submit" variant="primary" disabled={!text.trim()}>Add</Button>
      <Button variant="ghost" onclick={() => (quickAdd.open = false)}>Done</Button>
    </div>
    {#if added.length > 0}
      <p class="text-xs text-text-muted" role="status">Added {added.length === 1 ? added[0] : `${added.length} tasks`}.</p>
    {/if}
  </form>
</BottomSheet>
