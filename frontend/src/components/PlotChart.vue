<script setup>
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import uPlot from 'uplot'
import { PALETTES } from '../palette.js'
import { theme } from '../theme.js'

const props = defineProps({
  // Backend result: { x: {name, values}, series: [{name, values}] }
  parsed: { type: Object, required: true },
  // Set of visible series indices
  visible: { type: Object, required: true },
})

const wrapEl = ref(null)
let plot = null
let resizeObserver = null

function buildOptions(width, height) {
  const palette = PALETTES[theme.value] || PALETTES.dark
  const axisOpts = {
    stroke: palette.axis,
    grid: { stroke: palette.grid, width: 1 },
    ticks: { stroke: palette.grid, width: 1 },
    font: '12px sans-serif',
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
    axes: [axisOpts, axisOpts],
    scales: { x: { time: false } },
    cursor: { focus: { prox: 16 } },
    legend: { live: true },
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
  if (!wrapEl.value) return
  const width = wrapEl.value.clientWidth || 800
  const height = wrapEl.value.clientHeight || 480
  plot = new uPlot(buildOptions(width, height), buildData(), wrapEl.value)
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
    if (plot && wrapEl.value) {
      plot.setSize({
        width: wrapEl.value.clientWidth,
        height: wrapEl.value.clientHeight,
      })
    }
  })
  resizeObserver.observe(wrapEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  plot?.destroy()
  plot = null
})

// New data → full rebuild.
watch(() => props.parsed, render)

// Theme change → rebuild to repaint axes/series colors.
watch(theme, render)

// Visibility change → incremental update.
watch(() => props.visible, applyVisibility, { deep: true })
</script>

<template>
  <div ref="wrapEl" class="plot"></div>
</template>

<style scoped>
.plot {
  width: 100%;
  height: 100%;
  min-height: 0;
}
</style>
