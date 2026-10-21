<script lang="ts">
  import { copyText } from '../utils/clipboard';

  let { getText, label = 'Copy' }: { getText: () => string; label?: string } = $props();

  let status = $state<'idle' | 'copied' | 'failed'>('idle');
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function copy() {
    status = (await copyText(getText())) ? 'copied' : 'failed';
    clearTimeout(timer);
    timer = setTimeout(() => (status = 'idle'), 1500);
  }

  $effect(() => () => clearTimeout(timer));
</script>

<button
  type="button"
  class="shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium"
  style="border-color: var(--color-border); color: {status === 'copied' ? 'var(--color-brand)' : 'var(--color-text-muted)'};"
  onclick={copy}
>{status === 'copied' ? 'Copied' : status === 'failed' ? 'Copy failed' : label}</button>
