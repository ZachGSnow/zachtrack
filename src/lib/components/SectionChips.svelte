<script lang="ts">
  import type { Task, TaskProject } from '../db';
  import { taskUi } from '../stores/taskUi.svelte';

  // A task's sections as a row of buttons, the one it is in marked: one tap
  // moves it to the end of another (3.77). In a task's sheet and its quick menu.
  let {
    task,
    project,
    allowNone = false,
    onpicked,
  }: {
    task: Task;
    project: TaskProject;
    /** Also offer "No section". */
    allowNone?: boolean;
    /** After a move, e.g. to close the menu. */
    onpicked?: () => void;
  } = $props();

  const currentId = $derived(task.sectionId && project.sections.some((s) => s.id === task.sectionId) ? task.sectionId : null);

  function pick(id: string | null) {
    if (id !== currentId) void taskUi.moveToSection(task, project.sections.find((s) => s.id === id) ?? null);
    onpicked?.();
  }

  const chip = (on: boolean) =>
    `rounded-full border px-3 py-1.5 text-sm transition-colors ${on ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-border text-text-muted hover:text-text'}`;
</script>

<div class="flex flex-wrap gap-1.5" role="group" aria-label="Section">
  {#each project.sections as s (s.id)}
    <button type="button" class={chip(currentId === s.id)} aria-pressed={currentId === s.id} onclick={() => pick(s.id)}>{s.name}</button>
  {/each}
  {#if allowNone}
    <button type="button" class={chip(currentId === null)} aria-pressed={currentId === null} onclick={() => pick(null)}>No section</button>
  {/if}
</div>
