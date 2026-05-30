// Live UDP stream client: starts a backend listener, opens a WebSocket, and maintains a
// sliding buffer shaped like the CSV result ({ x, series }) so it can feed PlotChart directly.
import { reactive, ref, shallowRef, triggerRef, watch } from 'vue'

const DEFAULT_MAX_POINTS = 5000 // history buffer cap (oldest points drop off)

export function useUdpStream() {
  const status = ref('idle') // idle | connecting | connected | error
  const error = ref('')
  const stats = reactive({ packets: 0, series: 0, host: null, port: null })

  // Max history (points). User-configurable; lowering it shrinks the buffer immediately.
  const maxPoints = ref(DEFAULT_MAX_POINTS)
  // When paused, reception is frozen: incoming samples are dropped so the buffer (and thus the
  // displayed history) stays put for scrubbing. Resuming continues live (a gap is expected).
  const paused = ref(false)
  // Stable list of series names — reassigned only when a NEW name appears (not every frame),
  // so the sidebar tree doesn't re-render on every incoming point.
  const seriesNames = ref([])
  // X-positions (display coords) where a pause was skipped, so the chart can mark them.
  const gaps = ref([])

  // chartData is a shallowRef: we replace it on rAF to drive the chart.
  const chartData = shallowRef({ x: { name: 'time', values: [] }, series: [] })

  let ws = null
  let seriesIndex = new Map() // name -> column index
  let xValues = []
  let columns = [] // array of arrays, one per series (aligned with xValues)
  let pending = [] // points received since the last frame flush
  let rafId = null
  // Paused-gap collapsing: incoming timestamps have the total paused duration subtracted so the
  // plotted x stays continuous (no blank span). A null sample is inserted at each resume join to
  // break the connecting line, and the join x is recorded for the "Paused data" marker.
  let pausedAccum = 0 // raw seconds removed so far
  let lastRawT = null // last raw timestamp appended
  let lastStep = null // last normal raw delta (used to size the collapsed join step)
  let joinPending = false // next point is the first after a resume

  function ensureSeries(name) {
    if (seriesIndex.has(name)) return seriesIndex.get(name)
    const idx = columns.length
    seriesIndex.set(name, idx)
    // Back-fill the new column with nulls so it aligns with existing x samples.
    columns.push(new Array(xValues.length).fill(null))
    return idx
  }

  // Forward gap this many times the nominal step counts as a discontinuity (e.g. source paused).
  const GAP_FACTOR = 8

  // Collapse a discontinuity at rawT: advance display-x by one nominal step past the last
  // sample, correct `pausedAccum` so subsequent `x = rawT - pausedAccum` stays monotonic, and
  // push a null row to break the connecting line. Records the join x for the gap marker.
  function recordJoin(rawT) {
    const step = lastStep && lastStep > 0 ? lastStep : 0.001
    const prevDisplayLast = xValues.length ? xValues[xValues.length - 1] : rawT - step
    // We want the next real sample's display-x to sit one step past prevDisplayLast:
    //   nextDisplayX = prevDisplayLast + step = rawT - pausedAccum
    pausedAccum = rawT - step - prevDisplayLast
    const breakX = prevDisplayLast + step / 2
    xValues.push(breakX)
    for (const col of columns) col.push(null)
    gaps.value = [...gaps.value, breakX]
  }

  // Returns true if a new series column was created.
  function appendPoint(point) {
    const rawT = point.t
    let added = false

    if (lastRawT != null) {
      const d = rawT - lastRawT
      // A join is: an explicit pause→resume, a backward/flat jump (source restart, clock reset,
      // out-of-order), or a large forward gap (source stopped then resumed).
      const backward = d <= 0
      const largeForward = lastStep && lastStep > 0 && d > GAP_FACTOR * lastStep
      if (joinPending || backward || largeForward) {
        recordJoin(rawT)
      } else if (d > 0) {
        lastStep = d
      }
    }
    joinPending = false

    xValues.push(rawT - pausedAccum)
    const seen = new Set()
    for (const [name, value] of Object.entries(point.values)) {
      if (!seriesIndex.has(name)) added = true
      const idx = ensureSeries(name)
      columns[idx].push(value)
      seen.add(idx)
    }
    for (let i = 0; i < columns.length; i++) {
      if (!seen.has(i)) columns[i].push(null) // series absent from this message
    }
    lastRawT = rawT
    return added
  }

  function trimToMax() {
    const max = Math.max(1, Math.floor(maxPoints.value) || DEFAULT_MAX_POINTS)
    if (xValues.length > max) {
      const drop = xValues.length - max
      xValues.splice(0, drop)
      for (const col of columns) col.splice(0, drop)
      // Drop gap markers that scrolled out of the buffer.
      const minX = xValues[0]
      if (gaps.value.length && gaps.value.some((g) => g < minX)) {
        gaps.value = gaps.value.filter((g) => g >= minX)
      }
    }
  }

  function publish() {
    chartData.value = {
      x: { name: 'time', values: xValues },
      series: [...seriesIndex.keys()].map((name, i) => ({ name, values: columns[i] })),
    }
    triggerRef(chartData)
    stats.series = columns.length
  }

  function flush() {
    rafId = null
    if (pending.length === 0) return
    let added = false
    for (const p of pending) {
      if (appendPoint(p)) added = true
    }
    pending = []
    trimToMax()
    if (added) seriesNames.value = [...seriesIndex.keys()] // stable list updates only on change
    publish()
  }

  function scheduleFlush() {
    if (rafId == null) rafId = requestAnimationFrame(flush)
  }

  // Lowering the cap should shrink the visible window right away, even if no data is arriving.
  watch(maxPoints, () => {
    trimToMax()
    publish()
  })

  // On resume, the next incoming point is the join where the paused span is skipped.
  watch(paused, (now, was) => {
    if (was && !now) joinPending = true
  })

  function resetBuffers() {
    seriesIndex = new Map()
    xValues = []
    columns = []
    pending = []
    seriesNames.value = []
    gaps.value = []
    pausedAccum = 0
    lastRawT = null
    lastStep = null
    joinPending = false
    chartData.value = { x: { name: 'time', values: [] }, series: [] }
  }

  async function start(host, port, timestampField) {
    error.value = ''
    status.value = 'connecting'
    resetBuffers()
    try {
      const resp = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host,
          port: Number(port),
          timestamp_field: timestampField || null,
        }),
      })
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}))
        throw new Error(body.detail || `Failed to start listener (HTTP ${resp.status})`)
      }
      const st = await resp.json()
      stats.host = st.host
      stats.port = st.port
    } catch (e) {
      status.value = 'error'
      error.value = e.message || 'Failed to start listener'
      return
    }
    openSocket()
  }

  function openSocket() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/api/stream/ws`)
    ws.onopen = () => {
      status.value = 'connected'
    }
    ws.onmessage = (ev) => {
      if (paused.value) return // reception frozen; drop incoming so the buffer stays put
      const msg = JSON.parse(ev.data)
      if (msg.type === 'point') {
        stats.packets++
        pending.push(msg)
        scheduleFlush()
      }
    }
    ws.onerror = () => {
      if (status.value !== 'idle') {
        error.value = 'WebSocket error'
        status.value = 'error'
      }
    }
    ws.onclose = () => {
      if (status.value === 'connected') status.value = 'idle'
    }
  }

  async function stop() {
    status.value = 'idle'
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
    if (ws) {
      ws.onclose = null
      ws.close()
      ws = null
    }
    try {
      await fetch('/api/stream/stop', { method: 'POST' })
    } catch {
      // backend may already be gone; ignore
    }
  }

  return { status, error, stats, maxPoints, paused, seriesNames, gaps, chartData, start, stop }
}
