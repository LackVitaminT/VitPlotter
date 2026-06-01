<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import FileDropZone from './components/FileDropZone.vue'
import StreamConnect from './components/StreamConnect.vue'
import SeriesSelector from './components/SeriesSelector.vue'
import AnalysisPanel from './components/AnalysisPanel.vue'
import AnalysisDock from './components/AnalysisDock.vue'
import PlotControls from './components/PlotControls.vue'
import SubplotGrid from './components/SubplotGrid.vue'
import TimeBar from './components/TimeBar.vue'
import Typewriter from './components/Typewriter.vue'
import ChangelogModal from './components/ChangelogModal.vue'
import DashboardMenu from './components/DashboardMenu.vue'
import { uploadCsv } from './api.js'
import { useUdpStream } from './stream.js'
import { useSubplots } from './subplots.js'
import { useAnalysis } from './analysis.js'
import { useColors } from './colors.js'
import * as dashboard from './dashboard.js'
import { theme, toggleTheme } from './theme.js'
import { randomWelcomeTagline } from './taglines.js'

// Update this to your repository URL.
const GITHUB_URL = 'https://github.com/LackVitaminT/VitPlotter'
const AUTHOR = 'LackVitaminT'
const LICENSE = 'MIT'
// Baked at build time by run.py (VITE_APP_VERSION); 'dev' for a bare `npm run build`.
const APP_VERSION = import.meta.env.VITE_APP_VERSION || 'dev'
const showChangelog = ref(false)

const welcomeTab = ref('csv') // csv | udp (which connector the welcome screen shows)
const welcomeTagline = ref(randomWelcomeTagline())
const source = ref(null) // null | 'csv' | 'udp' (what currently drives the workspace)

const parsed = ref(null) // CSV result
const loading = ref(false)
const error = ref('')
// Last UDP connection params, kept so a dashboard can save/restore (and reconnect to) them.
const udpConfig = ref({ host: '0.0.0.0', port: 9870, timestampField: '' })

const stream = useUdpStream()
const sp = useSubplots() // subplots: grid of plot frames, each with its own visible-set
const colors = useColors() // per-series color overrides (name -> hex), shared by all subplots

// Source feeding the chart (base series only), before analysis derived curves are appended.
const baseData = computed(() => (source.value === 'udp' ? stream.chartData.value : parsed.value))
const isLive = computed(() => source.value === 'udp')
const analysis = useAnalysis(baseData, isLive) // filters (overlay curves) + spectral analyses

// The focused subplot's visible-set drives the sidebar selector.
const focusedVisible = computed(() => {
  const f = sp.find(sp.focusedId.value)
  return f ? f.visible : new Set()
})

// Axis settings are per-subplot (Y mode/range, X format/resolution). The top controls row and the
// bottom time bar reflect — and edit — the FOCUSED subplot. Switching focus shows that plot's axes.
const AXIS_DEFAULTS = { yMode: 'auto', yMin: 0, yMax: 1, xFormat: 'number', xPrecision: 2 }
const focusedAxes = computed(() => {
  const f = sp.find(sp.focusedId.value)
  return f ? f.axes : AXIS_DEFAULTS
})
function setFocusedAxis(patch) {
  sp.setAxes(patch)
}
const displayPoints = ref(500) // latest N samples shown live (history buffer is separate)

// Per-frame data feeding the chart: base series + analysis-derived filter overlay curves.
const activeData = computed(() => analysis.analyzedData.value ?? null)
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

// Stable series list for the sidebar tree — does NOT change every animation frame, so the tree
// only re-renders when the set of names changes. Base channels first, then analysis filter
// overlays (their labels are stable until the filter set/params change).
const baseNames = computed(() =>
  source.value === 'udp'
    ? stream.seriesNames.value
    : (parsed.value?.series ?? []).map((s) => s.name),
)
const seriesForSelector = computed(() =>
  [...baseNames.value, ...analysis.derivedNames.value].map((name) => ({ name })),
)

// Keep each subplot's visible-set pointing at the right curves as the series list changes order or
// length (UDP adding channels, or filter overlays being added/removed) — remap by name. Also drive
// dashboard restore: a restored subplot carries `wantNames` (the curves the saved dashboard had
// selected); when one of those names FIRST appears in the list, we check it. The first-appearance
// guard (seenNames) means later manual un-checks aren't overwritten when more UDP channels arrive.
let prevSeriesNames = []
let seenNames = new Set()

function reconcileVisible(names) {
  const nameIndex = new Map()
  names.forEach((n, i) => {
    if (!nameIndex.has(n)) nameIndex.set(n, i)
  })
  for (const sub of sp.subplots.value) {
    if (!sub.wantNames || !sub.wantNames.length) continue
    for (const name of sub.wantNames) {
      if (seenNames.has(name)) continue // only on a name's first appearance
      const idx = nameIndex.get(name)
      if (idx != null) sub.visible.add(idx)
    }
  }
}

watch(
  seriesForSelector,
  (cur) => {
    const names = cur.map((s) => s.name)
    sp.remapVisibleByName(prevSeriesNames, names)
    reconcileVisible(names)
    for (const n of names) seenNames.add(n)
    prevSeriesNames = names
  },
  { immediate: true },
)

// --- CSV ------------------------------------------------------------------ //
async function handleFile(file) {
  loading.value = true
  error.value = ''
  xView.value = null
  try {
    const data = await uploadCsv(file)
    parsed.value = data
    analysis.clear() // filters/analyses reference the previous source's series by name
    colors.reset() // color overrides are keyed by series name; drop the previous source's
    sp.clearAll() // fresh single empty focused plot
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
  paused.value = false
  xView.value = null
  await stream.start(host, port, timestampField)
  if (stream.status.value === 'connected' || stream.status.value === 'connecting') {
    udpConfig.value = { host, port, timestampField: timestampField || '' }
    analysis.clear()
    colors.reset()
    sp.clearAll() // fresh single empty focused plot (new series appear unchecked)
    source.value = 'udp'
  }
}

// --- series selection (acts on the focused subplot) ----------------------- //
function toggle(i) {
  sp.toggleSeries(i)
}
function toggleGroup({ indices, value }) {
  sp.setSeries(indices, value)
}
// All / None act on the indices the selector reports — the search matches while filtering,
// otherwise every series.
function selectAll(indices) {
  sp.setSeries(indices, true)
}
function selectNone(indices) {
  sp.setSeries(indices, false)
}

// --- subplot grid events -------------------------------------------------- //
function onSeriesDrop({ id, indices }) {
  sp.focus(id)
  sp.addSeries(indices, id) // append
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

// --- resizable Series / Analysis split (vertical, inside the sidebar) ------ //
const SERIES_RATIO_KEY = 'vitplotter-series-ratio'
const SERIES_RATIO_DEFAULT = 0.6 // Series : Analysis = 6 : 4
const SERIES_RATIO_MIN = 0.2
const SERIES_RATIO_MAX = 0.85

function clampRatio(r) {
  return Math.min(SERIES_RATIO_MAX, Math.max(SERIES_RATIO_MIN, r))
}
const sidebarEl = ref(null)
const storedRatio = Number(localStorage.getItem(SERIES_RATIO_KEY))
const seriesRatio = ref(
  Number.isFinite(storedRatio) && storedRatio > 0 ? clampRatio(storedRatio) : SERIES_RATIO_DEFAULT,
)

let paneDrag = null
function onPaneSplitterDown(e) {
  const host = sidebarEl.value
  if (!host) return
  paneDrag = { startY: e.clientY, startRatio: seriesRatio.value, height: host.clientHeight }
  document.body.style.userSelect = 'none'
  document.body.style.cursor = 'row-resize'
  window.addEventListener('mousemove', onPaneSplitterMove)
  window.addEventListener('mouseup', onPaneSplitterUp)
}
function onPaneSplitterMove(e) {
  if (!paneDrag || paneDrag.height <= 0) return
  seriesRatio.value = clampRatio(
    paneDrag.startRatio + (e.clientY - paneDrag.startY) / paneDrag.height,
  )
}
function onPaneSplitterUp() {
  paneDrag = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  localStorage.setItem(SERIES_RATIO_KEY, String(seriesRatio.value))
  window.removeEventListener('mousemove', onPaneSplitterMove)
  window.removeEventListener('mouseup', onPaneSplitterUp)
}
function resetPaneSplit() {
  seriesRatio.value = SERIES_RATIO_DEFAULT
  localStorage.setItem(SERIES_RATIO_KEY, String(SERIES_RATIO_DEFAULT))
}

onBeforeUnmount(() => {
  window.removeEventListener('mousemove', onSplitterMove)
  window.removeEventListener('mouseup', onSplitterUp)
  window.removeEventListener('mousemove', onPaneSplitterMove)
  window.removeEventListener('mouseup', onPaneSplitterUp)
})

// --- pause / time scrubber (drives every subplot) ------------------------- //
const gridRef = ref(null)
const paused = stream.paused // ref; reception is frozen while true
const xView = ref(null) // [min,max] visible chart window (shared by all subplots)
const bufExtent = computed(() => xBounds(activeData.value)) // full CSV / stream buffer bounds

function togglePause() {
  if (!bufExtent.value) return
  // Reception master: freeze/resume the shared buffer for ALL plots. Per-subplot playback is
  // independent — plots that were following simply resume on their own as new data flows in.
  paused.value = !paused.value
}

function onScrub(range) {
  xView.value = range
  gridRef.value?.setFocusedXView?.(range[0], range[1]) // scrub the focused subplot only
}

function resetDisplayView() {
  xView.value = null
  gridRef.value?.resetFocusedView?.() // reset the focused subplot's view
}

function reset() {
  if (source.value === 'udp') stream.stop()
  paused.value = false
  xView.value = null
  source.value = null
  parsed.value = null
  analysis.clear()
  colors.reset()
  sp.clearAll()
  seenNames = new Set()
  error.value = ''
  dashboard.clearAutosave() // back to the welcome screen → nothing to auto-restore
}

// --- dashboard save / restore -------------------------------------------- //
const dashStatus = ref('') // transient message shown in the dashboard menu
const savedList = ref(dashboard.listNamed())
function refreshSaved() {
  savedList.value = dashboard.listNamed()
}

// Bundle the live state the serializer reads from.
function dashboardCtx() {
  return {
    source: source.value,
    parsed: parsed.value,
    udp: {
      host: udpConfig.value.host,
      port: udpConfig.value.port,
      timestampField: udpConfig.value.timestampField,
      maxPoints: stream.maxPoints.value,
    },
    sp,
    analysis,
    colors,
    names: seriesForSelector.value.map((s) => s.name),
    displayPoints: displayPoints.value,
    sidebarWidth: sidebarWidth.value,
    seriesRatio: seriesRatio.value,
  }
}

// Apply a saved snapshot onto the live composables. Order matters (see plan): tear down → display
// dims → colors/analysis (so derived names exist) → data source → subplots → resolve visibility.
async function applyDashboard(snap) {
  if (!snap) return
  if (source.value === 'udp') await stream.stop()
  paused.value = false
  xView.value = null
  error.value = ''

  const d = snap.display || {}
  if (Number.isFinite(d.displayPoints)) displayPoints.value = d.displayPoints
  if (Number.isFinite(d.sidebarWidth)) sidebarWidth.value = clampWidth(d.sidebarWidth)
  if (Number.isFinite(d.seriesRatio)) seriesRatio.value = clampRatio(d.seriesRatio)

  colors.replaceAll(snap.colors || {})
  analysis.restore(snap.analysis || {})

  if (snap.source === 'csv') {
    // csvOmitted snapshots (saved past the storage quota without data) can't restore the plot.
    parsed.value = snap.csv && !snap.csv.csvOmitted ? snap.csv : null
    source.value = parsed.value ? 'csv' : null
  } else if (snap.source === 'udp' && snap.udp) {
    udpConfig.value = {
      host: snap.udp.host,
      port: snap.udp.port,
      timestampField: snap.udp.timestampField || '',
    }
    if (Number.isFinite(snap.udp.maxPoints)) stream.maxPoints.value = snap.udp.maxPoints
    await stream.start(snap.udp.host, snap.udp.port, snap.udp.timestampField || '')
    source.value =
      stream.status.value === 'connected' || stream.status.value === 'connecting' ? 'udp' : null
  }

  sp.restoreLayout(snap.layout)

  // Resolve wanted curves against the names available now (all for CSV; UDP fills in as it streams,
  // handled by the seriesForSelector watch). Reset seenNames so current names count as fresh.
  await nextTick()
  seenNames = new Set()
  const names = seriesForSelector.value.map((s) => s.name)
  reconcileVisible(names)
  for (const n of names) seenNames.add(n)
  prevSeriesNames = names
}

// Debounced autosave: coalesce rapid changes into one localStorage write.
let autosaveTimer = null
function scheduleAutosave() {
  if (source.value === null) return // nothing meaningful to save on the welcome screen
  if (autosaveTimer) clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null
    const res = dashboard.saveAutosave(dashboard.serialize(dashboardCtx()))
    if (res.omittedCsv) {
      dashStatus.value = 'Auto-saved layout only — CSV is too large for browser storage.'
    } else if (!res.ok) {
      dashStatus.value = res.error || 'Could not auto-save dashboard.'
    }
  }, 500)
}
// Shallow watch: identity-only sources (avoid deep-traversing the large CSV `parsed` object).
watch(
  [
    source,
    parsed,
    displayPoints,
    sidebarWidth,
    seriesRatio,
    sp.layoutMode,
    sp.cols,
    sp.rows,
    sp.focusedId,
    sp.maximizedId,
    stream.maxPoints,
  ],
  scheduleAutosave,
)
// Deep watch: structures whose internals change in place (selections, axes, filters, colors).
watch(
  [sp.subplots, analysis.filters, analysis.analyses, () => colors.overrides],
  scheduleAutosave,
  {
    deep: true,
  },
)

// --- dashboard menu actions ---------------------------------------------- //
function onDashSave() {
  const res = dashboard.saveAutosave(dashboard.serialize(dashboardCtx()))
  dashStatus.value = res.ok
    ? res.omittedCsv
      ? 'Saved layout only (CSV too large).'
      : 'Saved.'
    : res.error || 'Could not save.'
}
function onDashSaveAs(name) {
  const res = dashboard.saveNamed(name, dashboard.serialize(dashboardCtx()))
  refreshSaved()
  dashStatus.value = res.ok ? `Saved “${name}”.` : res.error || 'Could not save.'
}
async function onDashLoad(name) {
  const snap = dashboard.loadNamed(name)
  if (!snap) {
    dashStatus.value = 'Could not load dashboard.'
    return
  }
  try {
    await applyDashboard(snap)
    dashStatus.value = `Loaded “${name}”.`
  } catch (e) {
    dashStatus.value = e?.message || 'Could not load dashboard.'
  }
}
function onDashDelete(name) {
  dashboard.deleteNamed(name)
  refreshSaved()
  dashStatus.value = `Deleted “${name}”.`
}
function onDashExport() {
  dashboard.exportToFile(dashboard.serialize(dashboardCtx()), source.value || 'dashboard')
}
async function onDashImport(file) {
  try {
    const snap = await dashboard.importFromFile(file)
    await applyDashboard(snap)
    dashStatus.value = 'Imported dashboard.'
  } catch (e) {
    dashStatus.value = e?.message || 'Could not import file.'
  }
}

// Auto-restore the last session's dashboard on open.
onMounted(async () => {
  try {
    const snap = dashboard.loadAutosave()
    if (snap) await applyDashboard(snap)
  } catch {
    // corrupt/incompatible autosave → fall back to the welcome screen
  }
})
onBeforeUnmount(() => {
  if (autosaveTimer) clearTimeout(autosaveTimer)
})
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

      <DashboardMenu
        :names="savedList"
        :hasData="hasData"
        :status="dashStatus"
        @open="refreshSaved"
        @save="onDashSave"
        @save-as="onDashSaveAs"
        @load="onDashLoad"
        @delete="onDashDelete"
        @export="onDashExport"
        @import="onDashImport"
      />

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

      <footer class="welcome-foot">
        <div class="foot-links">
          <a class="gh-link" :href="GITHUB_URL" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path
                d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.49-1.11-1.49-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.27 2.75 1.05a9.36 9.36 0 0 1 2.5-.34c.85 0 1.71.12 2.5.34 1.91-1.32 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.48-.01 2.82 0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"
              />
            </svg>
            {{ AUTHOR }}
          </a>
          <span class="dot-sep" aria-hidden="true">·</span>
          <button class="link-btn" type="button" @click="showChangelog = true">Changelog</button>
        </div>
        <p class="watermark">VitPlotter v{{ APP_VERSION }} · {{ LICENSE }} License</p>
      </footer>
    </main>

    <!-- Loaded: series sidebar + chart -->
    <main v-else class="workspace">
      <aside
        ref="sidebarEl"
        class="sidebar"
        :style="{ flex: `0 0 ${sidebarWidth}px`, width: sidebarWidth + 'px' }"
      >
        <div class="series-pane" :style="{ flex: `${seriesRatio} 1 0` }">
          <SeriesSelector
            :series="seriesForSelector"
            :visible="focusedVisible"
            :colors="colors.overrides"
            @toggle="toggle"
            @toggleGroup="toggleGroup"
            @all="selectAll"
            @none="selectNone"
            @setColor="colors.setColor($event.name, $event.color)"
            @resetColor="colors.clearColor"
          />
        </div>
        <div
          class="pane-splitter"
          title="Drag to resize · double-click to reset to 6:4"
          @mousedown="onPaneSplitterDown"
          @dblclick="resetPaneSplit"
        ></div>
        <div class="analysis-pane" :style="{ flex: `${1 - seriesRatio} 1 0` }">
          <AnalysisPanel
            :filters="analysis.filters.value"
            :analyses="analysis.analyses.value"
            :sourceNames="baseNames"
            :baseCount="baseNames.length"
            :visible="focusedVisible"
            @toggle="toggle"
            @add-filter="analysis.addFilter"
            @update-filter="analysis.updateFilter"
            @remove-filter="analysis.removeFilter"
            @add-analysis="analysis.addAnalysis"
            @update-analysis="analysis.updateAnalysis"
            @remove-analysis="analysis.removeAnalysis"
          />
        </div>
      </aside>
      <div
        class="splitter"
        title="Drag to resize · double-click to reset"
        @mousedown="onSplitterDown"
        @dblclick="resetSidebar"
      ></div>
      <section class="chart-area">
        <div class="controls-row">
          <PlotControls
            :yMode="focusedAxes.yMode"
            :yMin="focusedAxes.yMin"
            :yMax="focusedAxes.yMax"
            :xFormat="focusedAxes.xFormat"
            :xPrecision="focusedAxes.xPrecision"
            v-model:displayPoints="displayPoints"
            :live="source === 'udp'"
            :maxPoints="stream.maxPoints.value"
            @update:yMode="setFocusedAxis({ yMode: $event })"
            @update:yMin="setFocusedAxis({ yMin: $event })"
            @update:yMax="setFocusedAxis({ yMax: $event })"
            @update:xFormat="setFocusedAxis({ xFormat: $event })"
            @update:xPrecision="setFocusedAxis({ xPrecision: $event })"
            @update:maxPoints="stream.maxPoints.value = $event"
            @reset-display="resetDisplayView"
          />
          <div class="layout-tools">
            <div class="segmented">
              <button
                :class="{ active: sp.layoutMode.value === 'adaptive' }"
                @click="sp.setLayoutMode('adaptive')"
              >
                Adaptive
              </button>
              <button
                :class="{ active: sp.layoutMode.value === 'manual' }"
                @click="sp.setLayoutMode('manual')"
              >
                Manual
              </button>
            </div>
            <template v-if="sp.layoutMode.value === 'manual'">
              <input
                class="grid-num"
                type="number"
                min="1"
                max="6"
                :value="sp.cols.value"
                @input="sp.setCols(Number($event.target.value))"
                aria-label="Columns"
                title="Columns"
              />
              <span class="times">×</span>
              <input
                class="grid-num"
                type="number"
                min="1"
                max="6"
                :value="sp.rows.value"
                @input="sp.setRows(Number($event.target.value))"
                aria-label="Rows"
                title="Rows"
              />
            </template>
            <button class="add-plot" title="Add subplot" @click="sp.addSubplot()">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span>Plot</span>
            </button>
          </div>
        </div>
        <div class="grid-wrap">
          <SubplotGrid
            ref="gridRef"
            :subplots="sp.subplots.value"
            :focusedId="sp.focusedId.value"
            :maximizedId="sp.maximizedId.value"
            :colNum="sp.colNum"
            :parsed="activeData"
            :live="source === 'udp'"
            :gaps="source === 'udp' ? stream.gaps.value : null"
            :displayPoints="displayPoints"
            :colors="colors.overrides"
            @focus="sp.focus($event)"
            @close="sp.removeSubplot($event)"
            @clear-series="sp.selectNone($event)"
            @toggle-maximize="sp.toggleMaximize($event)"
            @series-drop="onSeriesDrop"
            @layout-updated="sp.applyLayout($event)"
            @view-change="xView = $event"
          />
        </div>
        <AnalysisDock
          v-if="analysis.analyses.value.length"
          class="analysis-dock"
          :results="analysis.spectrumResults.value"
          @remove="analysis.removeAnalysis"
        />
        <div v-if="source === 'csv' || source === 'udp'" class="timebar-row">
          <button
            v-if="source === 'udp'"
            class="pause-btn"
            type="button"
            :disabled="!bufExtent"
            :title="
              paused
                ? 'Resume data reception (all plots)'
                : 'Pause data reception (all plots; per-plot play/pause is in each plot\'s header)'
            "
            @click="togglePause"
          >
            <svg v-if="paused" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
            <span>{{ paused ? 'Resume' : 'Pause' }}</span>
          </button>
          <TimeBar
            :extent="bufExtent"
            :view="xView ?? bufExtent"
            :disabled="!bufExtent"
            :xFormat="focusedAxes.xFormat"
            :xPrecision="focusedAxes.xPrecision"
            @update:view="onScrub"
          />
        </div>
      </section>
    </main>

    <ChangelogModal v-if="showChangelog" :version="APP_VERSION" @close="showChangelog = false" />
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
  position: relative;
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
.welcome-foot {
  position: absolute;
  bottom: 20px;
  left: 0;
  right: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.foot-links {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
}
.gh-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
  text-decoration: none;
  font-weight: 600;
  padding: 3px 6px;
  border-radius: 7px;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.gh-link:hover {
  color: var(--text);
  background: var(--bg-elev);
}
.gh-link svg {
  width: 16px;
  height: 16px;
}
.dot-sep {
  color: var(--text-dim);
}
.link-btn {
  background: transparent;
  border: none;
  color: var(--text-muted);
  font-size: 13px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 7px;
  transition:
    color 0.15s ease,
    background 0.15s ease;
}
.link-btn:hover {
  color: var(--accent);
  background: var(--bg-elev);
}
.watermark {
  margin: 0;
  font-size: 11px;
  color: var(--text-dim);
  letter-spacing: 0.02em;
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
  display: flex;
  flex-direction: column;
  min-height: 0;
}
/* Series tree and Analysis panel share the sidebar height via a draggable split (default 6:4);
   each scrolls independently. flex-grow comes from `seriesRatio` (inline style). */
.series-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.analysis-pane {
  min-height: 0;
  overflow-y: auto;
}
.pane-splitter {
  flex: 0 0 6px;
  margin: 6px 0;
  cursor: row-resize;
  background: var(--border);
  border-radius: 3px;
  position: relative;
}
.pane-splitter::after {
  /* widen the hit area without taking layout space */
  content: '';
  position: absolute;
  inset: -4px 0;
}
.pane-splitter:hover,
.pane-splitter:active {
  background: var(--accent);
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
.controls-row {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.layout-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 12px;
}
.layout-tools .segmented {
  display: inline-flex;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 3px;
}
.layout-tools .segmented button {
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.layout-tools .segmented button.active {
  background: var(--accent);
  color: var(--accent-contrast);
}
.grid-num {
  width: 48px;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.times {
  color: var(--text-dim);
}
.add-plot {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--accent);
  color: var(--accent-contrast);
  border: none;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.add-plot:hover {
  opacity: 0.9;
}
.add-plot svg {
  width: 14px;
  height: 14px;
}
.grid-wrap {
  flex: 1;
  min-height: 0;
  position: relative;
}
.analysis-dock {
  flex: 0 0 auto;
  margin-top: 12px;
}
.timebar-row {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-top: 12px;
}
.pause-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  height: 22px;
  padding: 0 12px;
  background: var(--accent);
  color: var(--accent-contrast);
  border: none;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
.pause-btn:hover {
  opacity: 0.9;
}
.pause-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.pause-btn svg {
  width: 13px;
  height: 13px;
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
