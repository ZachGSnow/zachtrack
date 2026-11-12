<script lang="ts">
  // The round checkbox in front of a task or subtask: an empty ring while
  // open, filled with a tick once done.
  let {
    done,
    name,
    onclick,
    size = 'md',
  }: {
    done: boolean;
    name: string;
    onclick: () => void;
    size?: 'md' | 'sm';
  } = $props();

  const dims = $derived(size === 'sm' ? 'h-5 w-5 text-[0.7rem]' : 'h-6 w-6 text-xs');
</script>

<button
  type="button"
  class="flex shrink-0 items-center justify-center rounded-full border-2 font-bold transition-colors {dims} {done
    ? 'border-brand bg-brand text-brand-fg'
    : 'border-text-muted text-transparent hover:border-brand hover:text-brand'}"
  {onclick}
  role="checkbox"
  aria-checked={done}
  aria-label={done ? `Reopen ${name}` : `Complete ${name}`}
>&#10003;</button>
