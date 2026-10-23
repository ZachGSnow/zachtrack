<script lang="ts">
  import * as echarts from 'echarts/core';
  import { BarChart, LineChart } from 'echarts/charts';
  import {
    GridComponent,
    LegendComponent,
    TooltipComponent,
    MarkLineComponent,
  } from 'echarts/components';
  import { SVGRenderer } from 'echarts/renderers';
  import type { EChartsOption } from 'echarts';

  echarts.use([
    BarChart,
    LineChart,
    GridComponent,
    LegendComponent,
    TooltipComponent,
    MarkLineComponent,
    SVGRenderer,
  ]);

  let { option, height = '260px', width = '100%' }: { option: EChartsOption; height?: string; width?: string } = $props();

  let el: HTMLDivElement | undefined = $state();
  let chartInstance: echarts.ECharts | null = null;

  // Creates/tears down the chart instance whenever the container element changes
  // (effectively once, on mount/unmount).
  $effect(() => {
    if (!el) return;
    chartInstance = echarts.init(el, null, { renderer: 'svg' });
    // Follow the container, not just the window: on a wide layout a chart's
    // column can change size without the window resizing.
    const observer = new ResizeObserver(() => chartInstance?.resize());
    observer.observe(el);
    return () => {
      observer.disconnect();
      chartInstance?.dispose();
      chartInstance = null;
    };
  });

  // Pushes new options whenever the data changes, independent of the chart's lifecycle.
  $effect(() => {
    chartInstance?.setOption(option, true);
  });
</script>

<div bind:this={el} style="width: {width}; height: {height};"></div>
