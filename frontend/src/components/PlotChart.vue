<script setup>
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import uPlot from 'uplot'
import { PALETTES, colorFor } from '../palette.js'
import { theme } from '../theme.js'
import { formatAxisTimestamp, formatTimestamp, xAxisLabelSpace } from '../xaxis.js'

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
  // X-positions where a paused span was skipped; rendered as hover markers.
  gaps: { type: Array, default: null },
  // Default number of latest samples to show (the trailing window width). 0 = show all.
  displayPoints: { type: Number, default: 0 },
})

// view-change: the visible x-window changed (drives the focus-bound time bar).
// follow-change: this plot's live-follow state flipped (drives its header play/pause button).
const emit = defineEmits(['view-change', 'follow-change'])

const HOVER_PROX = 16
const MENU_WIDTH = 190
const MENU_HEIGHT = 170
const JPG_QUALITY = 0.92

// Trailing-window state. `following` = the view's right edge is at the latest sample,
// so the window tracks new data; `viewWidth` is the current time span shown (null → derive
// from displayPoints). Scrub/zoom away from the right edge turns following off.
let following = true
let viewWidth = null

// Update follow-state and notify the parent (drives the per-subplot play/pause button) only when
// it actually flips, so wheel/scrub/play/pause all stay in sync without a prop→watch loop.
function setFollowing(v) {
  if (v === following) return
  following = v
  emit('follow-change', v)
}

function lastX() {
  const xs = plot && plot.data && plot.data[0]
  if (!xs) return null
  for (let i = xs.length - 1; i >= 0; i--) {
    if (Number.isFinite(xs[i])) return xs[i]
  }
  return null
}

function finiteXValues() {
  const xs = plot && plot.data && plot.data[0]
  if (!xs || xs.length === 0) return []
  return xs.filter((v) => Number.isFinite(v))
}

// Default trailing range = the last `displayPoints` finite X samples.
function defaultTrailingBounds() {
  const xs = finiteXValues()
  if (xs.length < 2) return null
  const n = xs.length
  const dp = Math.max(1, Math.floor(Number(props.displayPoints)) || n)
  const start = dp >= n ? 0 : n - dp
  let min = xs[start]
  let max = xs[n - 1]
  if (min === max) {
    min -= 1
    max += 1
  }
  return [min, max]
}

// Pin the view to a trailing window ending at the latest sample.
function applyTrailing() {
  if (!plot) return false
  const hi = lastX()
  if (hi == null) return false
  if (viewWidth != null && Number.isFinite(viewWidth) && viewWidth > 0) {
    plot.setScale('x', { min: hi - viewWidth, max: hi })
    return true
  }

  const bounds = defaultTrailingBounds()
  if (!bounds) return false
  plot.setScale('x', { min: bounds[0], max: bounds[1] })
  return true
}

// Pixel positions of paused-gap markers, recomputed after every draw.
const markers = ref([])

function updateMarkers(u = plot) {
  if (!u || !hostEl.value || !props.gaps || !props.gaps.length) {
    if (markers.value.length) markers.value = []
    return
  }
  const hostRect = hostEl.value.getBoundingClientRect()
  const overRect = u.over.getBoundingClientRect()
  const left0 = overRect.left - hostRect.left
  const top = overRect.top - hostRect.top
  const out = []
  for (const gx of props.gaps) {
    const px = u.valToPos(gx, 'x')
    if (!Number.isFinite(px) || px < -1 || px > overRect.width + 1) continue
    out.push({ left: left0 + px, top, height: overRect.height })
  }
  markers.value = out
}

const hoverTip = ref(null)
const screenshotFormat = ref('png') // png | jpg
// Screenshot background: 'opaque' paints the current theme background behind the chart;
// 'transparent' keeps the alpha channel (PNG only — JPG has no alpha, so it's always opaque).
const screenshotBg = ref('opaque')
const effectiveBg = computed(() =>
  screenshotFormat.value === 'jpg' ? 'opaque' : screenshotBg.value,
)
const screenshotStatus = ref('')
const screenshotBusy = ref(false)
const contextMenu = ref({ open: false, left: 0, top: 0 })

const hostEl = ref(null)
let plot = null
let resizeObserver = null
let detachPlotInteractions = null

// Series names/indices for the legend. Updated only on (re)build, so the legend doesn't
// churn on every live data frame — only when the set of series changes.
const seriesMeta = ref([])
// The custom legend shows ONLY the currently-drawn (visible) series and wraps to fit.
const legendItems = computed(() =>
  seriesMeta.value
    .filter((m) => props.visible.has(m.index))
    .map((m) => ({ name: m.name, index: m.index, color: colorFor(theme.value, m.index) })),
)

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function formatYValue(value) {
  if (!Number.isFinite(value)) return ''
  const abs = Math.abs(value)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return value.toExponential(4)
  return Number(value.toPrecision(7)).toString()
}

function updateHoverTip(u = plot) {
  if (
    !u ||
    !hostEl.value ||
    u.cursor.idx == null ||
    u.cursor.left == null ||
    u.cursor.top == null
  ) {
    hoverTip.value = null
    return
  }

  const cursorLeft = u.cursor.left
  const cursorTop = u.cursor.top
  if (
    cursorLeft < 0 ||
    cursorTop < 0 ||
    cursorLeft > u.over.clientWidth ||
    cursorTop > u.over.clientHeight
  ) {
    hoverTip.value = null
    return
  }

  let best = null
  for (let si = 1; si < u.data.length; si++) {
    const visibleIndex = si - 1
    if (!props.visible.has(visibleIndex)) continue
    const idx = u.cursor.idxs?.[si] ?? u.cursor.idx
    const x = u.data[0]?.[idx]
    const y = u.data[si]?.[idx]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue

    const xPx = u.valToPos(x, 'x')
    const yPx = u.valToPos(y, 'y')
    if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) continue
    const distance = Math.hypot(xPx - cursorLeft, yPx - cursorTop)
    if (distance > HOVER_PROX) continue
    if (!best || distance < best.distance) {
      best = { visibleIndex, x, y, xPx, yPx, distance }
    }
  }

  if (!best) {
    hoverTip.value = null
    return
  }

  const hostRect = hostEl.value.getBoundingClientRect()
  const overRect = u.over.getBoundingClientRect()
  const pointLeft = overRect.left - hostRect.left + best.xPx
  const pointTop = overRect.top - hostRect.top + best.yPx
  const flip = pointLeft > hostRect.width - 220
  hoverTip.value = {
    left: clamp(pointLeft + (flip ? -12 : 12), 8, Math.max(8, hostRect.width - 8)),
    top: clamp(pointTop - 10, 26, Math.max(26, hostRect.height - 8)),
    flip,
    color: colorFor(theme.value, best.visibleIndex),
    series: props.parsed.series[best.visibleIndex]?.name || `Series ${best.visibleIndex + 1}`,
    x: formatTimestamp(best.x, props.xFormat, props.xPrecision),
    y: formatYValue(best.y),
  }
}

function closeContextMenu() {
  if (contextMenu.value.open) contextMenu.value = { ...contextMenu.value, open: false }
}

function onWindowKeydown(e) {
  if (e.key === 'Escape') closeContextMenu()
}

function openContextMenu(e) {
  if (!plot || !hostEl.value) return
  e.preventDefault()
  const hostRect = hostEl.value.getBoundingClientRect()
  const left = clamp(e.clientX - hostRect.left, 8, Math.max(8, hostRect.width - MENU_WIDTH - 8))
  const top = clamp(e.clientY - hostRect.top, 8, Math.max(8, hostRect.height - MENU_HEIGHT - 8))
  screenshotStatus.value = ''
  contextMenu.value = { open: true, left, top }
}

function plotCanvas() {
  return hostEl.value?.querySelector('canvas') ?? null
}

function resolvedBackground() {
  // Nearest themed background behind the chart: the plot frame, then the chart area, then body.
  const nodes = [
    hostEl.value,
    hostEl.value?.closest('.frame'),
    hostEl.value?.closest('.chart-area'),
    document.body,
  ]
  for (const node of nodes) {
    if (!node) continue
    const color = getComputedStyle(node).backgroundColor
    if (
      color &&
      color !== 'transparent' &&
      !color.endsWith(', 0)') &&
      color !== 'rgba(0, 0, 0, 0)'
    ) {
      return color
    }
  }
  return '#ffffff'
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('Could not create screenshot'))
      },
      type,
      quality,
    )
  })
}

function readThemeVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

// Compose the export canvas: the chart, then a footer with the (visible) legend and the capture
// timestamp — all sized to the chart's device-pixel ratio and painted in the current theme colors.
function buildScreenshotCanvas(source, opaque) {
  const dpr = Math.max(1, source.clientWidth ? source.width / source.clientWidth : 1)
  const pad = Math.round(10 * dpr)
  const fontPx = Math.round(12 * dpr)
  const lineH = Math.round(18 * dpr)
  const chip = Math.round(10 * dpr)
  const colGap = Math.round(16 * dpr)
  const chipGap = Math.round(6 * dpr)
  const width = source.width
  const font = `${fontPx}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`

  // Lay the legend items out into rows that fit the chart width.
  const probe = document.createElement('canvas').getContext('2d')
  probe.font = font
  const maxW = Math.max(1, width - pad * 2)
  const rows = [[]]
  let rowW = 0
  for (const it of legendItems.value) {
    const w = chip + chipGap + probe.measureText(it.name).width
    const extra = (rows[rows.length - 1].length ? colGap : 0) + w
    if (rowW + extra > maxW && rows[rows.length - 1].length) {
      rows.push([])
      rowW = 0
    }
    rows[rows.length - 1].push({ name: it.name, color: it.color, w })
    rowW += (rows[rows.length - 1].length > 1 ? colGap : 0) + w
  }
  const legendH = legendItems.value.length ? rows.length * lineH : 0
  const footerH = pad + legendH + lineH + pad // legend rows + one timestamp line

  const out = document.createElement('canvas')
  out.width = width
  out.height = source.height + footerH
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('Could not create screenshot')
  if (opaque) {
    ctx.fillStyle = resolvedBackground()
    ctx.fillRect(0, 0, out.width, out.height)
  }
  ctx.drawImage(source, 0, 0)

  // Separator under the chart.
  const lw = Math.max(1, Math.round(dpr))
  ctx.strokeStyle = readThemeVar('--border', 'rgba(128, 128, 128, 0.25)')
  ctx.lineWidth = lw
  ctx.beginPath()
  ctx.moveTo(pad, source.height + lw / 2)
  ctx.lineTo(width - pad, source.height + lw / 2)
  ctx.stroke()

  ctx.font = font
  ctx.textBaseline = 'middle'
  const textColor = readThemeVar('--text', '#333')
  let y = source.height + pad + lineH / 2
  for (const row of rows) {
    let x = pad
    ctx.textAlign = 'left'
    for (const it of row) {
      ctx.fillStyle = it.color
      ctx.fillRect(x, Math.round(y - chip / 2), chip, chip)
      ctx.fillStyle = textColor
      ctx.fillText(it.name, x + chip + chipGap, y)
      x += it.w + colGap
    }
    y += lineH
  }

  // Capture timestamp, right-aligned on its own line below the legend.
  ctx.fillStyle = readThemeVar('--text-muted', '#888')
  ctx.textAlign = 'right'
  ctx.fillText(new Date().toLocaleString(), width - pad, source.height + pad + legendH + lineH / 2)
  ctx.textAlign = 'left'

  return out
}

async function makeScreenshotBlob(format = screenshotFormat.value) {
  const source = plotCanvas()
  if (!source) throw new Error('Plot canvas is not ready')

  const type = format === 'jpg' ? 'image/jpeg' : 'image/png'
  // JPG can't be transparent, so it's always opaque.
  const opaque = format === 'jpg' || screenshotBg.value === 'opaque'
  const out = buildScreenshotCanvas(source, opaque)
  return canvasToBlob(out, type, format === 'jpg' ? JPG_QUALITY : undefined)
}

async function writeClipboardBlob(blob) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard is not supported here')
  }
  if (typeof ClipboardItem.supports === 'function' && !ClipboardItem.supports(blob.type)) {
    throw new Error('Clipboard does not support this image format')
  }
  await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
}

async function copyScreenshot() {
  if (screenshotBusy.value) return
  screenshotBusy.value = true
  screenshotStatus.value = ''
  try {
    let blob = await makeScreenshotBlob(screenshotFormat.value)
    try {
      await writeClipboardBlob(blob)
    } catch (err) {
      if (screenshotFormat.value === 'png') throw err
      blob = await makeScreenshotBlob('png')
      await writeClipboardBlob(blob)
    }
    screenshotStatus.value = 'Copied'
  } catch (err) {
    screenshotStatus.value = err.message || 'Copy failed'
  } finally {
    screenshotBusy.value = false
  }
}

async function downloadScreenshot() {
  if (screenshotBusy.value) return
  screenshotBusy.value = true
  screenshotStatus.value = ''
  try {
    const format = screenshotFormat.value
    const blob = await makeScreenshotBlob(format)
    const url = URL.createObjectURL(blob)
    const stamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
    const a = document.createElement('a')
    a.href = url
    a.download = `vitplotter-plot-${stamp}.${format}`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    screenshotStatus.value = 'Downloaded'
  } catch (err) {
    screenshotStatus.value = err.message || 'Download failed'
  } finally {
    screenshotBusy.value = false
  }
}

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
    size: () => (props.xFormat === 'datetime' ? 56 : 42),
    lineGap: 1.2,
    space: () => xAxisLabelSpace(props.xFormat),
    values: (u, splits) =>
      splits.map((v) => formatAxisTimestamp(v, props.xFormat, props.xPrecision)),
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
      x: {
        time: false,
        range: (u, dataMin, dataMax) => {
          const lo = Number.isFinite(dataMin) ? dataMin : 0
          const hi = Number.isFinite(dataMax) ? dataMax : 1
          return lo < hi ? [lo, hi] : [lo - 1, hi + 1]
        },
      },
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
    cursor: {
      focus: { prox: HOVER_PROX },
      // Disable uPlot's built-in cursor points — we render our own hover tooltip
      // (updateHoverTip). The native points are round divs colored by series stroke and
      // leave stray colored dots near the chart/control edges, so turn them off.
      points: { show: false },
    },
    legend: { show: false }, // we render our own compact, visible-only legend below
    hooks: {
      // Report x-window changes (trailing follow, wheel zoom, scrub) so the time bar follows.
      setScale: [
        (u, key) => {
          if (key !== 'x') return
          const s = u.scales.x
          if (Number.isFinite(s.min) && Number.isFinite(s.max)) {
            emit('view-change', [s.min, s.max])
          }
        },
      ],
      // Reposition paused-gap markers after every draw (zoom/scrub/data/resize).
      draw: [(u) => updateMarkers(u)],
      setCursor: [(u) => updateHoverTip(u)],
    },
  }
}

function buildData() {
  return [props.parsed.x.values, ...props.parsed.series.map((s) => s.values)]
}

function numericBounds(values) {
  let min = Infinity
  let max = -Infinity

  for (const value of values ?? []) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  if (min === max) return [min - 1, max + 1]
  return [min, max]
}

function xDataBounds() {
  return numericBounds(props.parsed.x.values)
}

function resetZoom() {
  if (!plot) return
  const bounds = xDataBounds()

  plot.batch(() => {
    if (bounds) plot.setScale('x', { min: bounds[0], max: bounds[1] })
    else plot.setScale('x', { min: null, max: null })
    plot.setScale('y', { min: null, max: null })
  })
}

function clampRangeToBounds(min, max, bounds) {
  const [boundMin, boundMax] = bounds
  const boundSpan = boundMax - boundMin
  const span = max - min

  if (!Number.isFinite(span) || span >= boundSpan) return bounds

  if (min < boundMin) {
    max += boundMin - min
    min = boundMin
  }
  if (max > boundMax) {
    min -= max - boundMax
    max = boundMax
  }

  return [Math.max(boundMin, min), Math.min(boundMax, max)]
}

function onPlotWheel(e) {
  if (!plot) return
  closeContextMenu()

  const bounds = xDataBounds()
  const xScale = plot.scales.x
  if (!bounds || !Number.isFinite(xScale.min) || !Number.isFinite(xScale.max)) return

  e.preventDefault()

  const currentMin = xScale.min
  const currentMax = xScale.max
  const currentSpan = currentMax - currentMin
  const [boundMin, boundMax] = bounds
  const boundSpan = boundMax - boundMin
  if (currentSpan <= 0 || boundSpan <= 0) return

  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? plot.over.clientHeight : 1
  const factor = Math.min(4, Math.max(0.25, Math.exp((e.deltaY * unit) / 300)))
  const rect = plot.over.getBoundingClientRect()
  const pos = Math.min(Math.max(e.clientX - rect.left, 0), rect.width)
  // While live-following, keep the right edge pinned to the latest sample (anchor right);
  // otherwise zoom around the cursor.
  const followNow = following && props.live
  const anchor = followNow
    ? currentMax
    : Math.min(Math.max(plot.posToVal(pos, 'x'), boundMin), boundMax)
  const anchorRatio = (anchor - currentMin) / currentSpan
  const nextSpan = currentSpan * factor

  let nextMin = anchor - nextSpan * anchorRatio
  let nextMax = anchor + nextSpan * (1 - anchorRatio)
  const clamped = clampRangeToBounds(nextMin, nextMax, bounds)
  nextMin = clamped[0]
  nextMax = clamped[1]

  if (nextMax - nextMin <= 1e-12) return
  viewWidth = nextMax - nextMin
  setFollowing(nextMax >= boundMax - viewWidth * 0.01)
  plot.setScale('x', { min: nextMin, max: nextMax })
}

// Wheel-zoom + double-click-reset are always available (CSV, live, or paused).
function syncInteractions() {
  detachPlotInteractions?.()
  if (!plot) return

  const over = plot.over
  const onDoubleClick = () => resetView()
  const onMouseLeave = () => {
    hoverTip.value = null
  }
  over.addEventListener('wheel', onPlotWheel, { passive: false })
  over.addEventListener('dblclick', onDoubleClick)
  over.addEventListener('contextmenu', openContextMenu)
  over.addEventListener('mouseleave', onMouseLeave)

  detachPlotInteractions = () => {
    over.removeEventListener('wheel', onPlotWheel)
    over.removeEventListener('dblclick', onDoubleClick)
    over.removeEventListener('contextmenu', openContextMenu)
    over.removeEventListener('mouseleave', onMouseLeave)
    detachPlotInteractions = null
  }
}

// Imperative view control for the time bar (scrub). Sets following based on the right edge.
function setXView(min, max) {
  if (!plot || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return
  viewWidth = max - min
  const hi = lastX()
  setFollowing(hi != null && max >= hi - viewWidth * 0.01)
  plot.setScale('x', { min, max })
}

// Double-click / play → resume following the latest with the default display window.
function resetView() {
  setFollowing(true)
  viewWidth = null
  if (!applyTrailing()) resetZoom()
}

// Per-subplot playback control (header button). Play = resume live-follow; pause = freeze the
// current window in place (data keeps arriving into the shared buffer but this view holds).
function play() {
  resetView()
}
function pause() {
  if (plot) {
    const s = plot.scales.x
    if (Number.isFinite(s.min) && Number.isFinite(s.max)) viewWidth = s.max - s.min
  }
  setFollowing(false)
}

// Re-fit the plot to its current container size (used after layout changes the box, e.g.
// maximize/restore, where the ResizeObserver may not have fired yet).
function refresh() {
  if (!plot || !hostEl.value) return
  const w = hostEl.value.clientWidth
  const h = hostEl.value.clientHeight
  if (w > 0 && h > 0) plot.setSize({ width: w, height: h })
}
defineExpose({ setXView, resetView, refresh, play, pause })

function render() {
  if (plot) {
    detachPlotInteractions?.()
    plot.destroy()
    plot = null
  }
  hoverTip.value = null
  closeContextMenu()
  if (!hostEl.value) return
  seriesMeta.value = props.parsed.series.map((s, i) => ({ name: s.name, index: i }))
  const width = hostEl.value.clientWidth || 800
  const height = hostEl.value.clientHeight || 480
  plot = new uPlot(buildOptions(width, height), buildData(), hostEl.value)
  syncInteractions()
  if (following) applyTrailing()
}

// Toggling visibility doesn't need a rebuild.
function applyVisibility() {
  if (!plot) return
  props.parsed.series.forEach((_, i) => {
    plot.setSeries(i + 1, { show: props.visible.has(i) })
  })
  updateHoverTip()
}

onMounted(() => {
  render()
  emit('follow-change', following) // seed the parent's per-subplot play/pause state
  resizeObserver = new ResizeObserver(() => {
    if (plot && hostEl.value) {
      plot.setSize({ width: hostEl.value.clientWidth, height: hostEl.value.clientHeight })
    }
  })
  resizeObserver.observe(hostEl.value)
  window.addEventListener('click', closeContextMenu)
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('scroll', closeContextMenu, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('click', closeContextMenu)
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('scroll', closeContextMenu, true)
  resizeObserver?.disconnect()
  detachPlotInteractions?.()
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

// New data: in live mode, append via setData WITHOUT resetting the scale, then re-pin the
// trailing window when following (so the view shows the latest displayPoints, not the whole
// buffer). When not following, the scale is left alone so the user can inspect history.
watch(
  () => props.parsed,
  (now, old) => {
    if (props.live && plot && sameShape(now, old)) {
      plot.batch(() => {
        plot.setData(buildData(), false)
        if (following) applyTrailing()
      })
    } else {
      // A fresh dataset (first data / reconnect) resumes following the latest.
      if (!old || (old.series?.length ?? 0) === 0) {
        setFollowing(true)
        viewWidth = null
      }
      render()
    }
  },
)

// Theme change → rebuild to repaint axes/series colors.
watch(theme, render)

// Live changes toggle manual zoom/scrub interactions (no rebuild needed).
watch(() => props.live, syncInteractions)

// Gap list changed → recompute markers.
watch(
  () => props.gaps,
  () => updateMarkers(),
  { deep: true },
)

// Display-window size changed → if following, recompute the trailing width.
watch(
  () => props.displayPoints,
  () => {
    if (following) {
      viewWidth = null
      applyTrailing()
    }
  },
)

// Visibility change → incremental update.
watch(() => props.visible, applyVisibility, { deep: true })

// Y-axis range / X-axis format changes → re-evaluate via a redraw (no rebuild; the axis
// range and values closures read props live).
watch(
  () => [props.yMode, props.yMin, props.yMax, props.xFormat, props.xPrecision],
  () => {
    if (!plot) return
    plot.redraw()
    updateHoverTip()
  },
)
</script>

<template>
  <div class="plot">
    <div ref="hostEl" class="canvas-host">
      <div
        v-for="(m, i) in markers"
        :key="i"
        class="gap-marker"
        :style="{ left: m.left + 'px', top: m.top + 'px', height: m.height + 'px' }"
      >
        <span class="gap-tip">Paused data</span>
      </div>
      <div
        v-if="hoverTip"
        class="hover-tip"
        :class="{ flip: hoverTip.flip }"
        :style="{ left: hoverTip.left + 'px', top: hoverTip.top + 'px' }"
      >
        <div class="hover-title">
          <span class="hover-chip" :style="{ background: hoverTip.color }"></span>
          <span>{{ hoverTip.series }}</span>
        </div>
        <div class="hover-values">
          <span>X</span>
          <strong>{{ hoverTip.x }}</strong>
          <span>Y</span>
          <strong>{{ hoverTip.y }}</strong>
        </div>
      </div>
      <div
        v-if="contextMenu.open"
        class="plot-menu"
        :style="{ left: contextMenu.left + 'px', top: contextMenu.top + 'px' }"
        @click.stop
        @contextmenu.prevent.stop
      >
        <div class="format-switch" role="group" aria-label="Screenshot format">
          <button
            type="button"
            :class="{ active: screenshotFormat === 'png' }"
            @click="screenshotFormat = 'png'"
          >
            PNG
          </button>
          <button
            type="button"
            :class="{ active: screenshotFormat === 'jpg' }"
            @click="screenshotFormat = 'jpg'"
          >
            JPG
          </button>
        </div>
        <div class="format-switch bg-row" role="group" aria-label="Screenshot background">
          <button
            type="button"
            :class="{ active: effectiveBg === 'transparent' }"
            :disabled="screenshotFormat === 'jpg'"
            title="Keep a transparent background (PNG only)"
            @click="screenshotBg = 'transparent'"
          >
            Transparent
          </button>
          <button
            type="button"
            :class="{ active: effectiveBg === 'opaque' }"
            title="Paint the current theme background"
            @click="screenshotBg = 'opaque'"
          >
            Opaque
          </button>
        </div>
        <div class="menu-actions">
          <button type="button" :disabled="screenshotBusy" @click="copyScreenshot">Copy</button>
          <button type="button" :disabled="screenshotBusy" @click="downloadScreenshot">
            Download
          </button>
        </div>
        <div v-if="screenshotStatus" class="menu-status">{{ screenshotStatus }}</div>
      </div>
    </div>
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
/* Thin hover marker where a paused span was skipped. */
.gap-marker {
  position: absolute;
  width: 7px;
  transform: translateX(-50%);
  border-left: 2px dashed var(--text-dim);
  cursor: help;
  z-index: 2;
}
.gap-marker:hover {
  border-left-color: var(--accent);
}
.gap-tip {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  background: var(--bg-elev);
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 2px 7px;
  font-size: 11px;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.gap-marker:hover .gap-tip {
  opacity: 1;
}
.hover-tip {
  position: absolute;
  z-index: 5;
  transform: translateY(-100%);
  pointer-events: none;
  max-width: min(240px, calc(100% - 16px));
  background: color-mix(in srgb, var(--bg-elev) 94%, transparent);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 7px;
  box-shadow: var(--shadow);
  padding: 7px 9px;
  font-size: 11px;
}
.hover-tip.flip {
  transform: translate(-100%, -100%);
}
.hover-title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  font-weight: 700;
  white-space: nowrap;
}
.hover-title span:last-child {
  overflow: hidden;
  text-overflow: ellipsis;
}
.hover-chip {
  flex: 0 0 auto;
  width: 9px;
  height: 9px;
  border-radius: 3px;
}
.hover-values {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  gap: 1px 8px;
  margin-top: 4px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
.hover-values strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-muted);
  font-weight: 650;
}
.plot-menu {
  position: absolute;
  z-index: 6;
  width: 190px;
  padding: 8px;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: var(--shadow);
}
.format-switch,
.menu-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.bg-row,
.menu-actions {
  margin-top: 7px;
}
.plot-menu button {
  min-width: 0;
  height: 28px;
  background: var(--bg-inset);
  color: var(--text-muted);
  border: 1px solid var(--border);
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.plot-menu button:hover:not(:disabled),
.plot-menu button.active {
  background: var(--accent);
  color: var(--accent-contrast);
  border-color: var(--accent);
}
.plot-menu button:disabled {
  opacity: 0.55;
  cursor: wait;
}
/* The Transparent toggle is disabled (not busy) when JPG is selected. */
.format-switch button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.menu-status {
  margin-top: 7px;
  color: var(--text-dim);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
