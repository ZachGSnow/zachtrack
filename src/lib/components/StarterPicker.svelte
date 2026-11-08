<script lang="ts">
  import { STARTER_TRACKABLES } from '../db';
  import { starterStore } from '../stores/starter.svelte';
  import Button from './ui/Button.svelte';

  // A fresh install: pick which starter trackables to begin with, or none.
  let chosen = $state<string[]>(STARTER_TRACKABLES.map((t) => t.name));

  function toggle(name: string) {
    chosen = chosen.includes(name) ? chosen.filter((n) => n !== name) : [...chosen, name];
  }
</script>

<section class="rounded-2xl border border-border bg-surface p-4" aria-labelledby="starter-heading">
  <h2 id="starter-heading" class="text-lg font-semibold text-text">What do you want to track?</h2>
  <p class="mt-1 text-sm text-text-muted">A starting set to pick from. Everything stays editable, and "+ New" adds your own or a template.</p>
  <ul class="mt-3 divide-y divide-border">
    {#each STARTER_TRACKABLES as t (t.name)}
      <li>
        <label class="flex cursor-pointer items-start gap-3 py-2">
          <input type="checkbox" class="mt-1 h-4 w-4 accent-brand" checked={chosen.includes(t.name)} onchange={() => toggle(t.name)} />
          <span class="text-xl leading-6" aria-hidden="true">{t.icon}</span>
          <span class="min-w-0">
            <span class="block text-sm font-medium text-text">{t.name}</span>
            <span class="block text-xs text-text-muted">{t.blurb}</span>
          </span>
        </label>
      </li>
    {/each}
  </ul>
  <div class="mt-4 flex items-center gap-4">
    <Button variant="primary" disabled={chosen.length === 0 || starterStore.busy} onclick={() => starterStore.add(chosen)}>
      Add {chosen.length} {chosen.length === 1 ? 'trackable' : 'trackables'}
    </Button>
    <button class="text-sm text-text-muted" onclick={() => starterStore.decline()}>Start empty</button>
  </div>
</section>
