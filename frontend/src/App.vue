<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import FileDropZone from './components/FileDropZone.vue'
import StreamConnect from './components/StreamConnect.vue'
import SeriesSelector from './components/SeriesSelector.vue'
import PlotChart from './components/PlotChart.vue'
import PlotControls from './components/PlotControls.vue'
import Typewriter from './components/Typewriter.vue'
import { uploadCsv } from './api.js'
import { useUdpStream } from './stream.js'
import { theme, toggleTheme } from './theme.js'
import { getDragData, hasDragData } from './dnd.js'
import { randomWelcomeTagline } from './taglines.js'

// Update this to your repository URL.
const GITHUB_URL = 'https://github.com/LackVitaminT/VitPlotter'

const welcomeTab = ref('csv') // csv | udp (which connector the welcome screen shows)
const welcomeTagline = ref(randomWelcomeTagline())
const source = ref(null) // null | 'csv' | 'udp' (what currently drives the workspace)

const parsed = ref(null) // CSV result
const visible = ref(new Set()) // visible series indices; replaced on change for reactivity
const loading = ref(false)
const error = ref('')

const stream = useUdpStream()

// Y-axis control (applies to both CSV and live).
const yMode = ref('auto') // 'auto' | 'fixed'
const yMin = ref(0)
const yMax = ref(1)

// X-axis (bottom timestamp) display.
const xMode = ref('auto') // 'auto' | 'fixed'
const xMin = ref(0)
const xMax = ref(1)
const xFormat = ref('number') // number | elapsed | time | datetime
const xPrecision = ref(2) // fractional digits / resolution
const xRangeInitialized = ref(false)
const xRangeTouched = ref(false)

// Per-frame data feeding the chart.
const activeData = computed(() => (source.value === 'udp' ? stream.chartData.value : parsed.value))
const hasData = computed(() => source.value !== null)

watch(hasData, (hasCurrentData, hadData) => {
  if (!hasCurrentData && hadData) {
    welcomeTagline.value = randomWelcomeTagline(welcomeTagline.value)
  }
})

function xBounds(data) {
  const values = data?.x?.values ?? []
  let min = Infinity
  let max = -Infinity

  for (const value of values) {
    if (!Number.isFinite(value)) continue
    min = Math.min(min, value)
    max = Math.max(max, value)
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null
  if (min === max) return [min - 1, max + 1]
  return [min, max]
}

function maybeSeedXRange(data = activeData.value) {
  if (xMode.value !== 'fixed' || xRangeInitialized.value || xRangeTouched.value) return
  const range = xBounds(data)
  if (!range) return
  xMin.value = range[0]
  xMax.value = range[1]
  xRangeInitialized.value = true
}

watch(activeData, maybeSeedXRange)

watch(xMode, (mode) => {
  if (mode === 'fixed') maybeSeedXRange()
})

// Stable series list for the sidebar tree — does NOT change every animation frame, so the
// tree only re-renders when the set of names changes.
const seriesForSelector = computed(() => {
  if (source.value === 'udp') return stream.seriesNames.value.map((name) => ({ name }))
  return parsed.value?.series ?? []
})

// --- CSV ------------------------------------------------------------------ //
async function handleFile(file) {
  loading.value = true
  error.value = ''
  xRangeInitialized.value = false
  try {
    const data = await uploadCsv(file)
    parsed.value = data
    visible.value = new Set() // default: nothing selected
    source.value = 'csv'
  } catch (e) {
    error.value = e.message || 'Failed to parse file'
    parsed.value = null
  } finally {
    loading.value = false
  }
}

// --- UDP ------------------------------------------------------------------ //
async function handleConnect({ host, port, timestampField }) {
  xRangeInitialized.value = false
  await stream.start(host, port, timestampField)
  if (stream.status.value === 'connected' || stream.status.value === 'connecting') {
    visible.value = new Set() // default: nothing selected (new series appear unchecked)
    source.value = 'udp'
  }
}

// --- series selection ----------------------------------------------------- //
function toggle(i) {
  const next = new Set(visible.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  visible.value = next
}
function toggleGroup({ indices, value }) {
  const next = new Set(visible.value)
  for (const i of indices) {
    if (value) next.add(i)
    else next.delete(i)
  }
  visible.value = next
}
function selectAll() {
  visible.value = new Set(seriesForSelector.value.map((_, i) => i))
}
function selectNone() {
  visible.value = new Set()
}

// --- drag series onto the chart ------------------------------------------- //
const dragOver = ref(false)

function onChartDragOver(e) {
  if (!hasDragData(e)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}
function onChartDragLeave(e) {
  // Only clear when the pointer actually leaves the wrap (not when entering a child).
  if (!e.currentTarget.contains(e.relatedTarget)) dragOver.value = false
}
function onChartDrop(e) {
  e.preventDefault()
  dragOver.value = false
  const indices = getDragData(e)
  if (indices && indices.length) toggleGroup({ indices, value: true }) // append
}

// --- resizable sidebar ---------------------------------------------------- //
const SIDEBAR_DEFAULT = 248
const SIDEBAR_MIN = 180
const SIDEBAR_MAX = 560
const STORE_KEY = 'vitplotter-sidebar-width'

function clampWidth(w) {
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)))
}
const sidebarWidth = ref(clampWidth(Number(localStorage.getItem(STORE_KEY)) || SIDEBAR_DEFAULT))

let dragState = null
function onSplitterDown(e) {
  dragState = { startX: e.clientX, startWidth: sidebarWidth.value }
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'col-resize'
  window.addEventListener('mousemove', onSplitterMove)
  window.addEventListener('mouseup', onSplitterUp)
}
function onSplitterMove(e) {
  if (!dragState) return
  sidebarWidth.value = clampWidth(dragState.startWidth + (e.clientX - dragState.startX))
}
function onSplitterUp() {
  dragState = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  localStorage.setItem(STORE_KEY, String(sidebarWidth.value))
  window.removeEventListener('mousemove', onSplitterMove)
  window.removeEventListener('mouseup', onSplitterUp)
}
function resetSidebar() {
  sidebarWidth.value = SIDEBAR_DEFAULT
  localStorage.setItem(STORE_KEY, String(SIDEBAR_DEFAULT))
}
onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onSplitterMove)
  window.removeEventListener('mouseup', onSplitterUp)
})

function reset() {
  if (source.value === 'udp') stream.stop()
  source.value = null
  parsed.value = null
  visible.value = new Set()
  error.value = ''
  xRangeInitialized.value = false
}

function setXMin(value) {
  xRangeTouched.value = true
  xMin.value = value
}

function setXMax(value) {
  xRangeTouched.value = true
  xMax.value = value
}
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <button class="brand" type="button" aria-label="Back to welcome screen" @click="reset">
        <span class="brand-mark" aria-hidden="true">
          <svg viewBox="0 0 36 36" fill="none">
            <path class="brand-grid" d="M10 7v22M7 26h23" />
            <path class="brand-wave" d="M8 14.5l6 6.5 5.5-12 8.5 16" />
            <circle class="brand-node" cx="8" cy="14.5" r="2.2" />
            <circle class="brand-node" cx="19.5" cy="9" r="2.2" />
            <circle class="brand-node" cx="28" cy="25" r="2.2" />
          </svg>
        </span>
        <span class="name">VitPlotter</span>
      </button>

      <div class="spacer"></div>

      <span v-if="source === 'csv' && parsed" class="meta">
        {{ parsed.filename }} · {{ parsed.rows }} rows · {{ parsed.series.length }} series
      </span>
      <span v-else-if="source === 'udp'" class="meta">
        <span class="live-dot" :class="stream.status.value"></span>
        {{ stream.stats.host }}:{{ stream.stats.port }} · {{ stream.stats.series }} series ·
        {{ stream.stats.packets }} packets
      </span>

      <button
        class="icon-btn"
        :title="theme === 'dark' ? 'Light mode' : 'Dark mode'"
        @click="toggleTheme"
      >
        <!-- sun (shown in dark mode) / moon (shown in light mode) -->
        <svg
          v-if="theme === 'dark'"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19"
          />
        </svg>
        <svg
          v-else
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>

      <a class="icon-btn" :href="GITHUB_URL" target="_blank" rel="noopener" title="View on GitHub">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 1.5a10.5 10.5 0 0 0-3.32 20.47c.52.1.71-.23.71-.5v-1.76c-2.89.63-3.5-1.39-3.5-1.39-.47-1.2-1.16-1.52-1.16-1.52-.95-.65.07-.64.07-.64 1.05.08 1.6 1.08 1.6 1.08.93 1.6 2.44 1.14 3.04.87.09-.68.36-1.14.66-1.4-2.31-.26-4.74-1.16-4.74-5.14 0-1.13.4-2.06 1.07-2.79-.11-.26-.46-1.31.1-2.73 0 0 .87-.28 2.85 1.07a9.9 9.9 0 0 1 5.2 0c1.98-1.35 2.85-1.07 2.85-1.07.56 1.42.21 2.47.1 2.73.67.73 1.07 1.66 1.07 2.79 0 3.99-2.43 4.87-4.75 5.13.37.32.7.95.7 1.92v2.85c0 .27.19.61.72.5A10.5 10.5 0 0 0 12 1.5z"
          />
        </svg>
      </a>
    </header>

    <!-- Empty state: choose a data source -->
    <main v-if="!hasData" class="welcome">
      <div class="welcome-box">
        <h1 class="hero"><Typewriter text="Plot your data." /></h1>
        <p class="sub">{{ welcomeTagline }}</p>

        <div class="tabs">
          <button :class="{ active: welcomeTab === 'csv' }" @click="welcomeTab = 'csv'">
            CSV file
          </button>
          <button :class="{ active: welcomeTab === 'udp' }" @click="welcomeTab = 'udp'">
            UDP stream
          </button>
        </div>

        <FileDropZone v-if="welcomeTab === 'csv'" :loading="loading" @file="handleFile" />
        <StreamConnect
          v-else
          :connecting="stream.status.value === 'connecting'"
          :error="stream.error.value"
          @connect="handleConnect"
        />

        <p v-if="welcomeTab === 'csv' && error" class="error">{{ error }}</p>
      </div>
    </main>

    <!-- Loaded: series sidebar + chart -->
    <main v-else class="workspace">
      <aside class="sidebar" :style="{ flex: `0 0 ${sidebarWidth}px`, width: sidebarWidth + 'px' }">
        <SeriesSelector
          :series="seriesForSelector"
          :visible="visible"
          @toggle="toggle"
          @toggleGroup="toggleGroup"
          @all="selectAll"
          @none="selectNone"
        />
      </aside>
      <div
        class="splitter"
        title="Drag to resize · double-click to reset"
        @mousedown="onSplitterDown"
        @dblclick="resetSidebar"
      ></div>
      <section class="chart-area">
        <PlotControls
          v-model:yMode="yMode"
          v-model:yMin="yMin"
          v-model:yMax="yMax"
          v-model:xMode="xMode"
          :xMin="xMin"
          :xMax="xMax"
          v-model:xFormat="xFormat"
          v-model:xPrecision="xPrecision"
          :live="source === 'udp'"
          :maxPoints="stream.maxPoints.value"
          @update:xMin="setXMin"
          @update:xMax="setXMax"
          @update:maxPoints="stream.maxPoints.value = $event"
        />
        <div
          class="chart-wrap"
          :class="{ 'drag-over': dragOver }"
          @dragover="onChartDragOver"
          @dragenter="onChartDragOver"
          @dragleave="onChartDragLeave"
          @drop="onChartDrop"
        >
          <PlotChart
            :parsed="activeData"
            :visible="visible"
            :live="source === 'udp'"
            :yMode="yMode"
            :yMin="yMin"
            :yMax="yMax"
            :xMode="xMode"
            :xMin="xMin"
            :xMax="xMax"
            :xFormat="xFormat"
            :xPrecision="xPrecision"
          />
          <p v-if="source === 'udp' && activeData.series.length === 0" class="waiting">
            Waiting for data on {{ stream.stats.host }}:{{ stream.stats.port }}…
          </p>
          <div v-if="dragOver" class="drop-hint">Drop to plot</div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  cursor: pointer;
}
.brand-mark {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 8px;
  background: linear-gradient(
      145deg,
      color-mix(in srgb, var(--accent) 24%, transparent),
      transparent 55%
    ),
    var(--bg-inset);
  box-shadow: inset 0 1px 0 color-mix(in srgb, #ffffff 18%, transparent);
}
.brand-mark svg {
  width: 26px;
  height: 26px;
}
.brand-grid {
  stroke: var(--text-dim);
  stroke-width: 1.4;
  stroke-linecap: round;
  opacity: 0.7;
}
.brand-wave {
  stroke: var(--accent);
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.brand-node {
  fill: #04a5e5;
  stroke: var(--bg-inset);
  stroke-width: 1.4;
}
.name {
  font-family: monospace;
  font-size: 22px;
  font-weight: 900;
  letter-spacing: 0;
  line-height: 1;
  color: transparent;
  background: linear-gradient(92deg, var(--text) 8%, var(--accent) 54%, #04a5e5 96%);
  -webkit-background-clip: text;
  background-clip: text;
  text-shadow: 0 8px 22px color-mix(in srgb, var(--accent) 22%, transparent);
}
.spacer {
  flex: 1;
}
.meta {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
  margin-right: 4px;
}
.live-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--text-dim);
}
.live-dot.connected {
  background: #40c057;
}
.live-dot.connecting {
  background: var(--accent);
}
.live-dot.error {
  background: var(--danger);
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.icon-btn:hover {
  background: var(--surface);
  color: var(--text);
}
.icon-btn svg {
  width: 18px;
  height: 18px;
}

.welcome {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.welcome-box {
  width: 100%;
  max-width: 560px;
  text-align: center;
}
.hero {
  margin: 0 0 8px;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.sub {
  margin: 0 0 24px;
  color: var(--text-muted);
  font-size: 15px;
}
.tabs {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 18px;
  padding: 4px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 11px;
}
.tabs button {
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 8px;
  padding: 7px 18px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.tabs button.active {
  background: var(--accent);
  color: var(--accent-contrast);
}
.error {
  margin-top: 16px;
  color: var(--danger);
}

.workspace {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  padding: 18px 16px;
  background: var(--bg-elev);
  overflow: hidden;
}
.splitter {
  flex: 0 0 6px;
  cursor: col-resize;
  background: var(--border);
  position: relative;
}
.splitter::after {
  /* widen the hit area without taking layout space */
  content: '';
  position: absolute;
  inset: 0 -3px;
}
.splitter:hover,
.splitter:active {
  background: var(--accent);
}
.chart-area {
  flex: 1;
  min-width: 0;
  padding: 20px;
  display: flex;
  flex-direction: column;
}
.chart-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
  border-radius: 10px;
  transition: outline-color 0.15s ease;
  outline: 2px dashed transparent;
  outline-offset: -2px;
}
.chart-wrap.drag-over {
  outline-color: var(--accent);
}
.waiting {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--text-dim);
  font-size: 14px;
}
.drop-hint {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--accent);
  color: var(--accent-contrast);
  padding: 5px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  pointer-events: none;
}
</style>
