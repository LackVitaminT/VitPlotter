// Dashboard persistence: serialize the live workspace (data source, curve selection, colors,
// chart layout, UDP config) into a versioned snapshot and store it in localStorage — both an
// autosave slot (restored on next open) and named slots (Save As / Load / Delete). Also
// supports export/import to a JSON file. Pure helpers + storage I/O; the orchestration of
// applying a snapshot back onto the composables lives in App.vue (applyDashboard).

export const SCHEMA_VERSION = 1
const AUTO_KEY = 'vitplotter-dashboard-auto'
const NAMED_KEY = 'vitplotter-dashboards'

// Build a snapshot from the current workspace. `ctx` bundles the live composables/values:
//   { source, parsed, udp:{host,port,timestampField,maxPoints}, sp, analysis, colors,
//     names:[...full series names...], displayPoints, sidebarWidth, seriesRatio }
export function serialize(ctx) {
  const nameOf = (idx) => ctx.names[idx]
  const subplots = ctx.sp.subplots.value.map((s) => ({
    id: s.id,
    name: s.name || '',
    layout: { x: s.layout.x, y: s.layout.y, w: s.layout.w, h: s.layout.h, i: s.id },
    axes: { ...s.axes },
    // Visibility by NAME (robust to index shifts and ready to restore on a different series order).
    visibleNames: [...s.visible].map(nameOf).filter((n) => n != null),
  }))

  return {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    source: ctx.source,
    csv: ctx.source === 'csv' && ctx.parsed ? ctx.parsed : null,
    udp:
      ctx.source === 'udp'
        ? {
            host: ctx.udp.host,
            port: ctx.udp.port,
            timestampField: ctx.udp.timestampField || '',
            maxPoints: ctx.udp.maxPoints,
          }
        : null,
    display: {
      displayPoints: ctx.displayPoints,
      sidebarWidth: ctx.sidebarWidth,
      seriesRatio: ctx.seriesRatio,
    },
    layout: {
      layoutMode: ctx.sp.layoutMode.value,
      cols: ctx.sp.cols.value,
      rows: ctx.sp.rows.value,
      focusedId: ctx.sp.focusedId.value,
      maximizedId: ctx.sp.maximizedId.value,
      subplots,
    },
    analysis: {
      filters: ctx.analysis.filters.value.map((f) => ({ ...f })),
      analyses: ctx.analysis.analyses.value.map((a) => ({ ...a })),
    },
    colors: { ...ctx.colors.overrides },
  }
}

function isValidSnapshot(snap) {
  return !!snap && (snap.source === 'csv' || snap.source === 'udp') && !!snap.layout
}

// A copy of the snapshot without the (potentially huge) embedded CSV — used as a fallback when
// the full snapshot exceeds the localStorage quota. The layout/colors/config still restore.
function stripCsv(snap) {
  return {
    ...snap,
    csv: snap.csv ? { filename: snap.csv.filename, rows: snap.csv.rows, csvOmitted: true } : null,
  }
}

function isQuotaError(e) {
  return (
    e &&
    (e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014)
  )
}

// --- autosave slot -------------------------------------------------------- //

export function saveAutosave(snap) {
  try {
    localStorage.setItem(AUTO_KEY, JSON.stringify(snap))
    return { ok: true }
  } catch (e) {
    if (isQuotaError(e) && snap.csv) {
      try {
        localStorage.setItem(AUTO_KEY, JSON.stringify(stripCsv(snap)))
        return { ok: true, omittedCsv: true }
      } catch {
        // fall through
      }
    }
    return { ok: false, error: e?.message || 'Could not save dashboard' }
  }
}

export function loadAutosave() {
  try {
    const snap = JSON.parse(localStorage.getItem(AUTO_KEY) || 'null')
    return isValidSnapshot(snap) ? snap : null
  } catch {
    return null
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTO_KEY)
  } catch {
    // ignore
  }
}

// --- named slots ---------------------------------------------------------- //

function readNamed() {
  try {
    const obj = JSON.parse(localStorage.getItem(NAMED_KEY) || '{}')
    return obj && typeof obj === 'object' ? obj : {}
  } catch {
    return {}
  }
}

export function listNamed() {
  return Object.entries(readNamed())
    .map(([name, snap]) => ({ name, savedAt: snap?.savedAt || null, source: snap?.source || null }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function saveNamed(name, snap) {
  const key = String(name || '').trim()
  if (!key) return { ok: false, error: 'Name is required' }
  const all = readNamed()
  all[key] = snap
  try {
    localStorage.setItem(NAMED_KEY, JSON.stringify(all))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: isQuotaError(e) ? 'Too large for browser storage' : e?.message }
  }
}

export function loadNamed(name) {
  const snap = readNamed()[name]
  return isValidSnapshot(snap) ? snap : null
}

export function deleteNamed(name) {
  const all = readNamed()
  delete all[name]
  try {
    localStorage.setItem(NAMED_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

// --- export / import ------------------------------------------------------ //

export function exportToFile(snap, suggestedName = 'dashboard') {
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const safe = String(suggestedName).replace(/[^\w.-]+/g, '_') || 'dashboard'
  const a = document.createElement('a')
  a.href = url
  a.download = `vitplotter-${safe}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function importFromFile(file) {
  const text = await file.text()
  const snap = JSON.parse(text)
  if (!isValidSnapshot(snap)) throw new Error('Not a valid VitPlotter dashboard file')
  return snap
}
