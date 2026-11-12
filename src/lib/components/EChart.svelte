<script lang="ts">
  import type { EChartsOption } from 'echarts';
  import type { ECharts } from 'echarts/core';

  // A chart. ECharts (about 550 kB) is loaded the first time a chart is
  // actually drawn, not when a page that could show one opens: a trackable's
  // page opens on its table (3.11), and most visits never switch to the chart
  // (ARCHITECTURE.md 3.68).
  let { option, height = '260px', width = '100%' }: { option: EChartsOption; height?: string; width?: string } = $props();

  let el: HTMLDivElement | undefined = $state();
  let chartInstance = $state<ECharts | null>(null);

  // Creates/tears down the chart instance whenever the container element changes
  // (effectively once, on mount/unmount).
  $effect(() => {
    if (!el) return;
    const target = el;
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void loadEcharts().then((echarts) => {
      if (disposed) return;
      chartInstance = echarts.init(target, null, { renderer: 'svg' });
      // Follow the container, not just the window: on a wide layout a chart's
      // column can change size without the window resizing.
      observer = new ResizeObserver(() => chartInstance?.resize());
      observer.observe(target);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      chartInstance?.dispose();
      chartInstance = null;
    };
  });

  // Pushes new options whenever the data changes (or the chart arrives), independent of its lifecycle.
  $effect(() => {
    chartInstance?.setOption(option, true);
  });
</script>

<script lang="ts" module>
  let loading: Promise<typeof import('echarts/core')> | undefined;

  /** ECharts with the parts the app's charts use (echartsSetup.ts), loaded once. */
  function loadEcharts() {
    loading ??= import('./echartsSetup').then((m) => m.echarts);
    return loading;
  }
</script>

<div bind:this={el} style="width: {width}; height: {height};"></div>
