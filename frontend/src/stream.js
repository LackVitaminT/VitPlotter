// Live UDP stream client: starts a backend listener, opens a WebSocket, and maintains a
// sliding buffer shaped like the CSV result ({ x, series }) so it can feed PlotChart directly.
import { reactive, ref, shallowRef, triggerRef, watch } from 'vue'

const DEFAULT_MAX_POINTS = 2000 // rolling window cap (oldest points drop off)

export function useUdpStream() {
  const status = ref('idle') // idle | connecting | connected | error
  const error = ref('')
  const stats = reactive({ packets: 0, series: 0, host: null, port: null })

  // Max history (points). User-configurable; lowering it shrinks the buffer immediately.
  const maxPoints = ref(DEFAULT_MAX_POINTS)
  // Stable list of series names — reassigned only when a NEW name appears (not every frame),
  // so the sidebar tree doesn't re-render on every incoming point.
  const seriesNames = ref([])

  // chartData is a shallowRef: we replace it on rAF to drive the chart.
  const chartData = shallowRef({ x: { name: 'time', values: [] }, series: [] })

  let ws = null
  let seriesIndex = new Map() // name -> column index
  let xValues = []
  let columns = [] // array of arrays, one per series (aligned with xValues)
  let pending = [] // points received since the last frame flush
  let rafId = null

  function ensureSeries(name) {
    if (seriesIndex.has(name)) return seriesIndex.get(name)
    const idx = columns.length
    seriesIndex.set(name, idx)
    // Back-fill the new column with nulls so it aligns with existing x samples.
    columns.push(new Array(xValues.length).fill(null))
    return idx
  }

  // Returns true if a new series column was created.
  function appendPoint(point) {
    let added = false
    xValues.push(point.t)
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
    return added
  }

  function trimToMax() {
    const max = Math.max(1, Math.floor(maxPoints.value) || DEFAULT_MAX_POINTS)
    if (xValues.length > max) {
      const drop = xValues.length - max
      xValues.splice(0, drop)
      for (const col of columns) col.splice(0, drop)
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

  function resetBuffers() {
    seriesIndex = new Map()
    xValues = []
    columns = []
    pending = []
    seriesNames.value = []
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

  return { status, error, stats, maxPoints, seriesNames, chartData, start, stop }
}
