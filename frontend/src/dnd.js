// Shared drag-and-drop payload helpers so the drag source (series tree) and the drop target
// (chart area) agree on the format. The payload is a list of series indices to plot.
export const DND_MIME = 'application/x-vitplotter-series'

export function setDragData(e, indices, label = '') {
  const payload = JSON.stringify({ indices })
  e.dataTransfer.setData(DND_MIME, payload)
  // Plain-text fallback (some environments only expose text/plain).
  e.dataTransfer.setData('text/plain', label || payload)
  e.dataTransfer.effectAllowed = 'copy'
}

export function getDragData(e) {
  let raw = e.dataTransfer.getData(DND_MIME)
  if (!raw) {
    const text = e.dataTransfer.getData('text/plain')
    if (text && text.startsWith('{')) raw = text
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed.indices)) return parsed.indices
  } catch {
    // not our payload
  }
  return null
}

export function hasDragData(e) {
  return Array.from(e.dataTransfer?.types || []).includes(DND_MIME)
}
