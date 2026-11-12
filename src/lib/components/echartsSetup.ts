// The parts of ECharts the app's charts use, registered once. Imported only
// through EChart.svelte's dynamic import, so ECharts loads the first time a
// chart is drawn (ARCHITECTURE.md 3.68), and only these parts are bundled.
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';

echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, MarkLineComponent, SVGRenderer]);

export { echarts };
