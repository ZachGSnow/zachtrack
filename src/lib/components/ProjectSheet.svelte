<script lang="ts">
  import ArrowUp from '@lucide/svelte/icons/arrow-up';
  import ArrowDown from '@lucide/svelte/icons/arrow-down';
  import X from '@lucide/svelte/icons/x';
  import { createTaskProject, deleteTaskProject, deleteTaskSection, updateTaskProject, type Task, type TaskProject, type TaskSection } from '../db';
  import { PROJECT_COLORS, SECTION_TEMPLATES } from '../utils/tasks';
  import Button from './ui/Button.svelte';

  // A new project, or an existing one's name, icon, colour, notes and
  // sections. Sections are edited as a list and written with Save; a removed
  // section's tasks move to the top of the project.
  let {
    open = $bindable(false),
    project,
    tasks,
    onSaved,
    onDeleted,
  }: {
    open: boolean;
    project: TaskProject | null;
    tasks: readonly Task[];
    onSaved?: (id: string) => void;
    onDeleted?: () => void;
  } = $props();

  let name = $state('');
  let icon = $state('');
  let color = $state(PROJECT_COLORS[0]);
  let notes = $state('');
  let sections = $state<TaskSection[]>([]);
  let template = $state(0);
  let newSection = $state('');
  let confirmDelete = $state(false);
  let error = $state<string | null>(null);

  // Fill the form each time the sheet opens.
  $effect(() => {
    if (!open) return;
    name = project?.name ?? '';
    icon = project?.icon ?? '';
    color = project?.color ?? PROJECT_COLORS[0];
    notes = project?.notes ?? '';
    sections = (project?.sections ?? []).map((s) => ({ ...s }));
    template = 0;
    newSection = '';
    confirmDelete = false;
    error = null;
  });

  const taskCount = $derived(project ? tasks.filter((t) => t.projectId === project.id && !t.parentId).length : 0);
  const countIn = (sectionId: string) => (project ? tasks.filter((t) => t.projectId === project.id && t.sectionId === sectionId && !t.parentId).length : 0);

  function moveSection(i: number, direction: -1 | 1) {
    const j = i + direction;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    sections = next;
  }

  function addSection() {
    const n = newSection.trim();
    if (!n) return;
    sections = [...sections, { id: crypto.randomUUID(), name: n }];
    newSection = '';
  }

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      error = 'Give the project a name.';
      return;
    }
    error = null;
    // Plain copies: $state proxies can't be stored in IndexedDB (4.4).
    const cleanSections = sections.map((s) => ({ id: s.id, name: s.name.trim() || 'Untitled section' }));
    const fields = { name: trimmed, color, ...(icon.trim() ? { icon: icon.trim() } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) };
    try {
      if (project) {
        const kept = new Set(cleanSections.map((s) => s.id));
        for (const s of project.sections) if (!kept.has(s.id)) await deleteTaskSection(project.id, s.id);
        await updateTaskProject(project.id, { ...fields, icon: fields.icon, notes: fields.notes, sections: cleanSections });
        onSaved?.(project.id);
      } else {
        const fromTemplate = SECTION_TEMPLATES[template].sections.map((n) => ({ id: crypto.randomUUID(), name: n }));
        const created = await createTaskProject({ ...fields, sections: fromTemplate });
        onSaved?.(created.id);
      }
      open = false;
    } catch (err) {
      error = `Could not save: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  async function setArchived(archived: boolean) {
    if (!project) return;
    await updateTaskProject(project.id, { archived });
    open = false;
  }

  async function remove() {
    if (!project) return;
    await deleteTaskProject(project.id);
    open = false;
    onDeleted?.();
  }

  const inputClass = 'w-full rounded-lg border bg-transparent p-2 text-text placeholder:text-text-muted border-border';
</script>

<div class="space-y-4">
  <h2 class="text-lg font-semibold text-text">{project ? 'Edit project' : 'New project'}</h2>

  <div class="grid grid-cols-[1fr_auto] gap-2">
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Name</span>
      <input type="text" bind:value={name} placeholder="e.g. Garage" class={inputClass} />
    </label>
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Icon</span>
      <input type="text" bind:value={icon} placeholder="&#x1F3E0;" class="{inputClass} w-16 text-center" />
    </label>
  </div>

  <div>
    <p class="mb-1.5 text-sm text-text-muted">Color</p>
    <div class="flex flex-wrap gap-2">
      {#each PROJECT_COLORS as c (c)}
        <button
          type="button"
          class="h-7 w-7 rounded-full"
          style="background: {c}; {color === c ? 'box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 4px ' + c + ';' : ''}"
          onclick={() => (color = c)}
          aria-label="Choose color {c}"
          aria-pressed={color === c}
        ></button>
      {/each}
    </div>
  </div>

  {#if project}
    <section aria-label="Sections" class="space-y-2">
      <p class="text-sm text-text-muted">Sections</p>
      {#if sections.length === 0}
        <p class="text-xs text-text-muted">No sections: tasks are one list.</p>
      {/if}
      <ul class="flex flex-col gap-1.5">
        {#each sections as s, i (s.id)}
          <li class="flex items-center gap-1.5">
            <input type="text" bind:value={s.name} class="{inputClass} text-sm" aria-label="Section name" />
            <button type="button" class="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 disabled:opacity-30" disabled={i === 0} onclick={() => moveSection(i, -1)} aria-label="Move {s.name} up"><ArrowUp size={16} aria-hidden="true" /></button>
            <button type="button" class="rounded-lg p-1.5 text-text-muted hover:bg-surface-2 disabled:opacity-30" disabled={i === sections.length - 1} onclick={() => moveSection(i, 1)} aria-label="Move {s.name} down"><ArrowDown size={16} aria-hidden="true" /></button>
            <button type="button" class="rounded-lg p-1.5 text-text-muted hover:bg-surface-2" onclick={() => (sections = sections.filter((x) => x.id !== s.id))} aria-label="Remove {s.name}"><X size={16} aria-hidden="true" /></button>
          </li>
        {/each}
      </ul>
      {#if project.sections.some((s) => !sections.some((x) => x.id === s.id) && countIn(s.id) > 0)}
        <p class="text-xs text-text-muted">Tasks in a removed section move to the top of the project when you save.</p>
      {/if}
      <form
        class="flex gap-2"
        onsubmit={(e) => {
          e.preventDefault();
          addSection();
        }}
      >
        <input type="text" bind:value={newSection} placeholder="Add a section" aria-label="New section" class="{inputClass} text-sm" />
        <Button type="submit" disabled={!newSection.trim()}>Add</Button>
      </form>
    </section>
  {:else}
    <label class="block text-sm">
      <span class="mb-1 block text-text-muted">Sections</span>
      <select bind:value={template} class={inputClass}>
        {#each SECTION_TEMPLATES as t, i (t.label)}
          <option value={i}>{t.label}</option>
        {/each}
      </select>
      <span class="mt-1 block text-xs text-text-muted">You can rename, reorder or add sections later.</span>
    </label>
  {/if}

  <label class="block text-sm">
    <span class="mb-1 block text-text-muted">Notes (optional)</span>
    <textarea rows="2" bind:value={notes} class={inputClass} placeholder="What this project is for"></textarea>
  </label>

  {#if error}
    <p class="text-sm text-danger">{error}</p>
  {/if}

  <div class="flex gap-2">
    <Button variant="primary" onclick={save}>Save</Button>
    <Button variant="ghost" onclick={() => (open = false)}>Cancel</Button>
  </div>

  {#if project}
    <div class="space-y-2 border-t border-border pt-3">
      <Button size="sm" onclick={() => setArchived(!project.archived)}>{project.archived ? 'Unarchive project' : 'Archive project'}</Button>
      {#if confirmDelete}
        <p class="text-sm text-text">
          Delete {project.name}{taskCount ? ` and its ${taskCount} task${taskCount === 1 ? '' : 's'}, with their subtasks` : ''}? This can't be undone.
        </p>
        <div class="flex gap-2">
          <Button variant="danger" onclick={remove}>Delete</Button>
          <Button variant="ghost" onclick={() => (confirmDelete = false)}>Keep it</Button>
        </div>
      {:else}
        <Button variant="danger" size="sm" onclick={() => (confirmDelete = true)}>Delete project</Button>
      {/if}
    </div>
  {/if}
</div>
