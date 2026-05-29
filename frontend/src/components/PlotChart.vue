<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import uPlot from 'uplot'
import { PALETTES, colorFor } from '../palette.js'
import { theme } from '../theme.js'
import { formatTimestamp } from '../xaxis.js'

const props = defineProps({
  // Backend result: { x: {name, values}, series: [{name, values}] }
  parsed: { type: Object, required: true },
  // Set of visible series indices
  visible: { type: Object, required: true },
  // Live mode: update via setData (fast, follows latest) instead of rebuilding on every change.
  live: { type: Boolean, default: false },
  // Y axis: 'auto' floats with the data, 'fixed' pins to [yMin, yMax].
  yMode: { type: String, default: 'auto' },
  yMin: { type: Number, default: 0 },
  yMax: { type: Number, default: 1 },
  // X axis (bottom timestamp) display: format style + resolution (fractional digits).
  xFormat: { type: String, default: 'number' },
  xPrecision: { type: Number, default: 2 },
})

const hostEl = ref(null)
let plot = null
let resizeObserver = null

// Series names/indices for the legend. Updated only on (re)build, so the legend doesn't
// churn on every live data frame — only when the set of series changes.
const seriesMeta = ref([])
// The custom legend shows ONLY the currently-drawn (visible) series and wraps to fit.
const legendItems = computed(() =>
  seriesMeta.value
    .filter((m) => props.visible.has(m.index))
    .map((m) => ({ name: m.name, index: m.index, color: colorFor(theme.value, m.index) })),
)

function buildOptions(width, height) {
  const palette = PALETTES[theme.value] || PALETTES.dark
  const axisOpts = {
    stroke: palette.axis,
    grid: { stroke: palette.grid, width: 1 },
    ticks: { stroke: palette.grid, width: 1 },
    font: '12px sans-serif',
  }
  // X-axis tick labels: formatter reads props live so changing format/resolution only
  // needs a redraw, not a rebuild.
  const xAxisOpts = {
    ...axisOpts,
    values: (u, splits) => splits.map((v) => formatTimestamp(v, props.xFormat, props.xPrecision)),
  }

  const series = [
    { label: props.parsed.x.name }, // x series
    ...props.parsed.series.map((s, i) => ({
      label: s.name,
      show: props.visible.has(i),
      stroke: palette.series[i % palette.series.length],
      width: 1.5,
      points: { show: false },
    })),
  ]

  return {
    width,
    height,
    series,
    axes: [xAxisOpts, axisOpts],
    scales: {
      x: { time: false },
      // Range fn reads props live, so toggling auto/fixed only needs a redraw (no rebuild),
      // and the pin survives the live setData path.
      y: {
        range: (u, dataMin, dataMax) => {
          if (props.yMode === 'fixed' && props.yMin < props.yMax) {
            return [props.yMin, props.yMax]
          }
          // Auto: guard against empty data (null/NaN min-max) so we never return NaN.
          const lo = Number.isFinite(dataMin) ? dataMin : 0
          const hi = Number.isFinite(dataMax) ? dataMax : 1
          return uPlot.rangeNum(lo, hi, 0.1, true)
        },
      },
    },
    cursor: { focus: { prox: 16 } },
    legend: { show: false }, // we render our own compact, visible-only legend below
  }
}

function buildData() {
  return [props.parsed.x.values, ...props.parsed.series.map((s) => s.values)]
}

function render() {
  if (plot) {
    plot.destroy()
    plot = null
  }
  if (!hostEl.value) return
  seriesMeta.value = props.parsed.series.map((s, i) => ({ name: s.name, index: i }))
  const width = hostEl.value.clientWidth || 800
  const height = hostEl.value.clientHeight || 480
  plot = new uPlot(buildOptions(width, height), buildData(), hostEl.value)
}

// Toggling visibility doesn't need a rebuild.
function applyVisibility() {
  if (!plot) return
  props.parsed.series.forEach((_, i) => {
    plot.setSeries(i + 1, { show: props.visible.has(i) })
  })
}

onMounted(() => {
  render()
  resizeObserver = new ResizeObserver(() => {
    if (plot && hostEl.value) {
      plot.setSize({ width: hostEl.value.clientWidth, height: hostEl.value.clientHeight })
    }
  })
  resizeObserver.observe(hostEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  plot?.destroy()
  plot = null
})

function sameShape(a, b) {
  return (
    a &&
    b &&
    a.series.length === b.series.length &&
    a.series.every((s, i) => s.name === b.series[i].name)
  )
}

// New data: in live mode, push via setData when the series set is unchanged (fast, and the
// default x autoscale makes the view follow the latest samples); otherwise rebuild.
watch(
  () => props.parsed,
  (now, old) => {
    if (props.live && plot && sameShape(now, old)) {
      plot.setData(buildData())
    } else {
      render()
    }
  },
)

// Theme change → rebuild to repaint axes/series colors.
watch(theme, render)

// Visibility change → incremental update.
watch(() => props.visible, applyVisibility, { deep: true })

// Y-axis range / X-axis format changes → re-evaluate via a redraw (no rebuild; the axis
// range and values closures read props live).
watch(
  () => [props.yMode, props.yMin, props.yMax, props.xFormat, props.xPrecision],
  () => plot && plot.redraw(),
)
</script>

<template>
  <div class="plot">
    <div ref="hostEl" class="canvas-host"></div>
    <div v-if="legendItems.length" class="legend">
      <span v-for="it in legendItems" :key="it.index" class="item" :title="it.name">
        <span class="chip" :style="{ background: it.color }"></span>
        <span class="lbl">{{ it.name }}</span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.plot {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.canvas-host {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}
/* Compact, adaptive legend: wraps to fit the width, capped height with scroll so a large
   series set never dominates the layout. */
.legend {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: center;
  gap: 4px 14px;
  max-height: 84px;
  overflow-y: auto;
  padding-top: 10px;
}
.item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 240px;
  font-size: 12px;
  color: var(--text-muted);
}
.chip {
  width: 11px;
  height: 11px;
  border-radius: 3px;
  flex: 0 0 auto;
}
.lbl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
