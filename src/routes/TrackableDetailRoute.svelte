<script lang="ts">
  import TrackableDetail from './TrackableDetail.svelte';

  // The router keeps the same page when only the id changes (one trackable's
  // page to another's): start the page afresh for each trackable, so its data,
  // tag filter and open sheets belong to the one on screen.
  let { params }: { params: { id: string } } = $props();
</script>

{#key params.id}
  <TrackableDetail {params} />
{/key}
