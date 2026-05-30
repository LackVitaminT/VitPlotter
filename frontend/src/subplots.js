// Subplot model: a grid of independent plot frames sharing all global settings (axes, pause,
// x-window, history/display) but each with its own set of visible series indices.
// Layout items are { x, y, w, h, i } in a COL_NUM-column grid (see grid-engine.js / SubplotGrid.vue).
import { reactive, ref } from 'vue'

const COL_NUM = 12 // grid columns the layout engine works in
const STORE_KEY = 'vitplotter-subplots'

let seq = 0
function nextId() {
  seq += 1
  return `p${seq}`
}

// Adaptive grid: near-square arrangement for n subplots.
function gridDims(n) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.max(1, Math.ceil(n / cols))
  return { cols, rows }
}

export function useSubplots() {
  const subplots = ref([]) // [{ id, layout:{x,y,w,h,i}, visible:Set }]
  const focusedId = ref(null)
  const maximizedId = ref(null)
  const layoutMode = ref('adaptive') // 'adaptive' | 'manual'
  const cols = ref(2) // manual columns
  const rows = ref(2) // manual rows (informational; height-based)

  function persist() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({ layoutMode: layoutMode.value, cols: cols.value, rows: rows.value }),
      )
    } catch {
      // ignore quota / privacy-mode errors
    }
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}')
    if (saved.layoutMode === 'manual' || saved.layoutMode === 'adaptive')
      layoutMode.value = saved.layoutMode
    if (Number.isFinite(saved.cols)) cols.value = Math.max(1, Math.min(6, saved.cols))
    if (Number.isFinite(saved.rows)) rows.value = Math.max(1, Math.min(6, saved.rows))
  } catch {
    // ignore
  }

  // Re-tile every subplot to fill the grid. In adaptive mode use a near-square count; in manual
  // mode use the user's column count. Row count derives from however many rows are needed.
  function relayout() {
    const n = subplots.value.length
    if (n === 0) return
    const c = layoutMode.value === 'manual' ? Math.max(1, cols.value) : gridDims(n).cols
    const rowsNeeded = Math.ceil(n / c)
    const cellW = Math.max(1, Math.floor(COL_NUM / c))
    const cellH = Math.max(1, Math.floor(COL_NUM / rowsNeeded)) // square-ish in grid units
    subplots.value.forEach((sp, idx) => {
      const r = Math.floor(idx / c)
      const col = idx % c
      sp.layout = { x: col * cellW, y: r * cellH, w: cellW, h: cellH, i: sp.id }
    })
    if (layoutMode.value === 'adaptive') rows.value = rowsNeeded
  }

  function addSubplot(focusIt = true) {
    const id = nextId()
    subplots.value.push({
      id,
      layout: { x: 0, y: 0, w: 6, h: 6, i: id },
      visible: reactive(new Set()),
      // Per-subplot axis settings: Y mode/range and X format/resolution are independent per plot.
      axes: reactive({ yMode: 'auto', yMin: 0, yMax: 1, xFormat: 'number', xPrecision: 2 }),
    })
    relayout()
    if (focusIt) focusedId.value = id
    return id
  }

  function removeSubplot(id) {
    const i = subplots.value.findIndex((s) => s.id === id)
    if (i === -1) return
    subplots.value.splice(i, 1)
    if (maximizedId.value === id) maximizedId.value = null
    if (subplots.value.length === 0) {
      addSubplot(true) // always keep one empty focused plot
    } else {
      relayout()
      if (focusedId.value === id) focusedId.value = subplots.value[Math.max(0, i - 1)].id
    }
  }

  function find(id) {
    return subplots.value.find((s) => s.id === id) || null
  }

  function focus(id) {
    if (find(id)) focusedId.value = id
  }

  function toggleMaximize(id) {
    maximizedId.value = maximizedId.value === id ? null : id
    if (maximizedId.value) focusedId.value = id
  }

  // Series selection acts on a specific subplot (defaults to focused).
  function toggleSeries(idx, id = focusedId.value) {
    const sp = find(id)
    if (!sp) return
    const next = new Set(sp.visible)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    sp.visible = next
  }
  function setSeries(indices, value, id = focusedId.value) {
    const sp = find(id)
    if (!sp) return
    const next = new Set(sp.visible)
    for (const i of indices) {
      if (value) next.add(i)
      else next.delete(i)
    }
    sp.visible = next
  }
  function addSeries(indices, id) {
    setSeries(indices, true, id) // append (drop-to-plot)
  }
  // Update the focused (or given) subplot's axis settings. Patch is a partial of `axes`.
  function setAxes(patch, id = focusedId.value) {
    const sp = find(id)
    if (sp) Object.assign(sp.axes, patch)
  }
  function selectAll(allIndices, id = focusedId.value) {
    const sp = find(id)
    if (sp) sp.visible = new Set(allIndices)
  }
  function selectNone(id = focusedId.value) {
    const sp = find(id)
    if (sp) sp.visible = new Set()
  }

  // Keep visibility correct when the series list changes order/length (UDP adding channels, or
  // filter overlays being added/removed). Translate every subplot's visible indices through the
  // old→new name lists by NAME, so the right curves stay checked regardless of index shifts.
  function remapVisibleByName(oldNames, newNames) {
    if (!oldNames || !newNames) return
    const newIndexOf = new Map()
    newNames.forEach((name, i) => {
      if (!newIndexOf.has(name)) newIndexOf.set(name, i)
    })
    for (const sp of subplots.value) {
      const next = new Set()
      for (const idx of sp.visible) {
        const name = oldNames[idx]
        const ni = name != null ? newIndexOf.get(name) : undefined
        if (ni != null) next.add(ni)
      }
      sp.visible = next
    }
  }

  // Back to a single empty focused plot (used on reset / new data source).
  function clearAll() {
    subplots.value = []
    maximizedId.value = null
    addSubplot(true)
  }

  // Adopt the grid's updated layout (user drag/resize). Keep our items in sync.
  function applyLayout(items) {
    for (const it of items) {
      const sp = find(it.i)
      if (sp) sp.layout = { x: it.x, y: it.y, w: it.w, h: it.h, i: it.i }
    }
  }

  function setLayoutMode(mode) {
    layoutMode.value = mode === 'manual' ? 'manual' : 'adaptive'
    relayout()
    persist()
  }
  function setCols(n) {
    cols.value = Math.max(1, Math.min(6, Math.floor(n) || 1))
    if (layoutMode.value === 'manual') relayout()
    persist()
  }
  function setRows(n) {
    rows.value = Math.max(1, Math.min(6, Math.floor(n) || 1))
    persist()
  }

  // Start with one empty, focused subplot.
  addSubplot(true)

  return {
    subplots,
    focusedId,
    maximizedId,
    layoutMode,
    cols,
    rows,
    colNum: COL_NUM,
    addSubplot,
    removeSubplot,
    focus,
    toggleMaximize,
    toggleSeries,
    setSeries,
    addSeries,
    setAxes,
    selectAll,
    selectNone,
    remapVisibleByName,
    clearAll,
    applyLayout,
    relayout,
    setLayoutMode,
    setCols,
    setRows,
    find,
  }
}
