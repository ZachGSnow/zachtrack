<script lang="ts">
  import GripVertical from '@lucide/svelte/icons/grip-vertical';
  import { updateTaskProject, type Task, type TaskProject } from '../db';
  import { describeDue, type SectionGroup } from '../utils/tasks';
  import { describeQuickAdd, parseQuickAdd } from '../utils/quickAdd';
  import { moveTo } from '../utils/reorder';
  import { sortable, type DropEvent } from '../actions/sortable';
  import { taskUi } from '../stores/taskUi.svelte';
  import TaskCard from './TaskCard.svelte';

  // A project as a board (3.76), Asana's and Todoist's other view of the same
  // sections: each section a column of cards, tasks without a section in a
  // first column. Cards drag within and between columns, columns drag by the
  // dots in their header (writing the project's section order), and each
  // column has an add box at its foot, with "+ Add a section" after the last.
  // On a laptop the columns sit side by side; on a phone one fills most of the
  // screen, the board swipes sideways a column at a time, and the column names
  // along the top jump to each.
  let {
    project,
    groups,
    tasks,
    today,
    showDone,
    keyOf,
    onDrop,
    onKeyMove,
    onAdd,
  }: {
    project: TaskProject;
    groups: SectionGroup[];
    tasks: readonly Task[];
    today: string;
    showDone: boolean;
    keyOf: (g: SectionGroup) => string;
    /** A card dropped in a column (the same handler as the list's sections). */
    onDrop: (e: DropEvent) => void;
    onKeyMove: (g: SectionGroup, id: string, direction: -1 | 1) => void;
    /** A task typed in a column's add box. */
    onAdd: (g: SectionGroup, text: string) => Promise<void>;
  } = $props();

  let scroller = $state<HTMLElement>();
  let drafts = $state<Record<string, string>>({});
  let newSection = $state('');
  /** The column at the left of the board, for the names along the top on a phone. */
  let current = $state(0);

  const nameOf = (g: SectionGroup) => g.section?.name ?? 'No section';

  /** What a typed date in an add box will set, shown under it. */
  function preview(text: string | undefined): string {
    return text?.trim() ? describeQuickAdd(parseQuickAdd(text, today), (d, t) => describeDue(d, t, today).text) : '';
  }

  async function submit(g: SectionGroup) {
    const k = keyOf(g);
    const text = (drafts[k] ?? '').trim();
    if (!text) return;
    // Cleared first, so typing the next one straight away starts empty.
    drafts = { ...drafts, [k]: '' };
    await onAdd(g, text);
  }

  /** A column dropped at `index` among the sections: the project's section order. */
  async function dropColumn(e: DropEvent) {
    const order = moveTo(
      project.sections.map((s) => s.id),
      e.id,
      e.index,
    );
    await updateTaskProject(project.id, { sections: order.map((id) => project.sections.find((s) => s.id === id)!) });
  }

  /** Arrow Left / Right on a column's handle: one place. */
  function keyColumn(id: string, direction: -1 | 1) {
    const at = project.sections.findIndex((s) => s.id === id);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= project.sections.length) return;
    void dropColumn({ id, ids: [id], from: 'columns', to: 'columns', index: to });
  }

  async function addSection() {
    const name = newSection.trim();
    if (!name) return;
    newSection = '';
    await updateTaskProject(project.id, { sections: [...project.sections, { id: crypto.randomUUID(), name }] });
  }

  const columns = () => (scroller ? [...scroller.querySelectorAll<HTMLElement>(':scope > [data-column]')] : []);

  function onScroll() {
    if (!scroller) return;
    const left = scroller.getBoundingClientRect().left + parseFloat(getComputedStyle(scroller).paddingLeft || '0');
    let best = 0;
    let bestDistance = Infinity;
    columns().forEach((c, i) => {
      const d = Math.abs(c.getBoundingClientRect().left - left);
      if (d < bestDistance) {
        best = i;
        bestDistance = d;
      }
    });
    current = best;
  }

  function show(i: number) {
    columns()[i]?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' });
  }
</script>

{#if groups.length > 1}
  <!-- On a phone, where one column shows at a time: every column's name, to jump to it. -->
  <nav aria-label="Columns" class="-mx-5 flex gap-1.5 overflow-x-auto px-5 pb-1 lg:hidden">
    {#each groups as g, i (keyOf(g))}
      <button
        type="button"
        class="shrink-0 rounded-full border px-3 py-1 text-xs font-medium {current === i ? 'border-brand text-brand' : 'border-border text-text-muted'}"
        aria-current={current === i ? 'true' : undefined}
        onclick={() => show(i)}
      >{nameOf(g)} <span class="opacity-70">{g.open.length}</span></button>
    {/each}
  </nav>
{/if}

<div
  bind:this={scroller}
  onscroll={onScroll}
  role="region"
  aria-label="Board"
  class="-mx-5 flex snap-x snap-mandatory scroll-px-5 items-start gap-3 overflow-x-auto px-5 pb-4 lg:snap-none"
  use:sortable={{ group: `columns:${project.id}`, zone: 'columns', axis: 'x', onDrop: dropColumn, onKeyMove: keyColumn, scroller: () => scroller }}
>
  {#each groups as g (keyOf(g))}
    {@const name = nameOf(g)}
    <section data-column data-sort-id={g.section?.id} class="flex w-[85%] shrink-0 snap-start flex-col gap-2 rounded-xl bg-surface-2 p-2 lg:w-72" aria-label={name}>
      <header class="flex items-center gap-1.5 px-1 pt-1">
        {#if g.section}
          <button
            type="button"
            data-drag-handle
            class="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center rounded text-text-muted/60 hover:text-text-muted focus:text-text"
            style="touch-action: none;"
            aria-label="Drag the {name} column to move it, or use the arrow keys"
          ><GripVertical size={14} aria-hidden="true" /></button>
        {/if}
        <h2 class="truncate font-heading text-sm font-semibold text-text">{name}</h2>
        <span class="text-xs text-text-muted">{g.open.length}</span>
      </header>
      <!-- Always there, even empty, so a card can be dropped into an empty column. -->
      <ul
        class="flex min-h-12 flex-col gap-2"
        aria-label="Tasks in {name}"
        use:sortable={{
          group: `tasks:${project.id}`,
          zone: keyOf(g),
          onDrop,
          onKeyMove: (id, d) => onKeyMove(g, id, d),
          free: true,
          reach: Infinity,
          scroller: () => scroller,
          mouseAnywhere: true,
          selection: () => taskUi.selected,
        }}
      >
        {#each g.open as t (t.id)}
          <TaskCard task={t} {tasks} {today} draggable />
        {/each}
      </ul>
      {#if showDone && g.done.length > 0}
        <ul class="flex flex-col gap-2" aria-label="Completed in {name}">
          {#each g.done as t (t.id)}
            <TaskCard task={t} {tasks} {today} />
          {/each}
        </ul>
      {/if}
      <form
        onsubmit={(e) => {
          e.preventDefault();
          void submit(g);
        }}
      >
        <input
          type="text"
          bind:value={drafts[keyOf(g)]}
          placeholder="+ Add a task"
          aria-label="Add a task to {name}"
          class="w-full rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-border focus:bg-surface"
        />
        {#if preview(drafts[keyOf(g)])}
          <p class="px-2 text-xs text-brand">{preview(drafts[keyOf(g)])}</p>
        {/if}
      </form>
    </section>
  {/each}

  <form
    class="w-[85%] shrink-0 snap-start lg:w-72"
    onsubmit={(e) => {
      e.preventDefault();
      void addSection();
    }}
  >
    <input
      type="text"
      bind:value={newSection}
      placeholder="+ Add a section"
      aria-label="Add a section"
      class="w-full rounded-xl border border-dashed border-border bg-transparent px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-solid"
    />
  </form>
</div>
