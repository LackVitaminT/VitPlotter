// Dual-cursor measurement: two vertical cursors (A, B) on the focused subplot give ΔX / ΔY, and
// the selection between them yields per-curve region statistics (min/max/mean/RMS) plus a
// frequency estimate (cursor spacing 1/ΔX and the FFT dominant peak of the region). Cursor
// positions are x DATA values on the shared x-domain, so they stay valid across focus changes.
import { ref } from 'vue'
import { estimateDt, statistics } from './dsp.js'
import { colorForName } from './palette.js'

// Linear interpolation of a series' value at x=`xq`, using the nearest finite samples that
// bracket it. Returns null if xq is outside the finite data or no bracket exists.
function interpAt(xs, ys, xq) {
  let prev = -1
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) continue
    if (xs[i] === xq) return ys[i]
    if (xs[i] < xq) {
      prev = i
    } else {
      if (prev < 0) return null // xq is before the first finite sample
      const t = (xq - xs[prev]) / (xs[i] - xs[prev])
      return ys[prev] + t * (ys[i] - ys[prev])
    }
  }
  return null // xq is after the last finite sample
}

export function useMeasure() {
  const active = ref(false)
  const ax = ref(null) // cursor A x (data value)
  const bx = ref(null) // cursor B x (data value)

  function setA(x) {
    if (Number.isFinite(x)) ax.value = x
  }
  function setB(x) {
    if (Number.isFinite(x)) bx.value = x
  }
  function reset() {
    active.value = false
    ax.value = null
    bx.value = null
  }
  // Place the cursors at 25% / 75% of a view window. `force` overwrites existing positions so the
  // cursors always land inside the current window when measurement is (re)enabled.
  function placeInView(view, force = false) {
    if (!view || !Number.isFinite(view[0]) || !Number.isFinite(view[1])) return
    const [lo, hi] = view
    if (force || ax.value == null) ax.value = lo + (hi - lo) * 0.25
    if (force || bx.value == null) bx.value = lo + (hi - lo) * 0.75
  }
  function initFromView(view) {
    placeInView(view, false)
  }
  function enable(view) {
    active.value = true
    placeInView(view, true) // follow the current window
  }
  function disable() {
    active.value = false
  }
  function toggle(view) {
    if (active.value) disable()
    else enable(view)
  }

  // Compute ΔX/ΔY + region stats for every visible series. `data` is { x:{values}, series:[{values}] }
  // (the active analyzed data), `visibleIndices` indexes into data.series / `names`.
  function computeResults(data, visibleIndices, names, overrides, themeVal) {
    const a = ax.value
    const b = bx.value
    if (!data || a == null || b == null) return { dx: null, cursorFreq: null, rows: [] }
    const xs = data.x?.values ?? []
    const lo = Math.min(a, b)
    const hi = Math.max(a, b)
    const dx = b - a
    const cursorFreq = dx !== 0 ? 1 / Math.abs(dx) : null

    const rows = []
    for (const i of visibleIndices) {
      const s = data.series?.[i]
      if (!s) continue
      const ys = s.values
      // Finite samples inside [lo, hi].
      const rx = []
      const ry = []
      for (let k = 0; k < xs.length; k++) {
        const xv = xs[k]
        if (!Number.isFinite(xv) || xv < lo || xv > hi) continue
        const yv = ys[k]
        if (!Number.isFinite(yv)) continue
        rx.push(xv)
        ry.push(yv)
      }
      if (!ry.length) continue
      const dt = estimateDt(rx)
      const fs = dt && dt > 0 ? 1 / dt : 0
      const st = statistics(ry, fs)
      const yA = interpAt(xs, ys, a)
      const yB = interpAt(xs, ys, b)
      rows.push({
        index: i,
        name: names[i] ?? `Series ${i + 1}`,
        color: colorForName(themeVal, i, names[i], overrides),
        yA,
        yB,
        dy: yA != null && yB != null ? yB - yA : null,
        min: st.min,
        max: st.max,
        mean: st.mean,
        rms: st.rms,
        dominantHz: st.dominantHz,
        count: st.count,
      })
    }
    return { dx, cursorFreq, rows }
  }

  return {
    active,
    ax,
    bx,
    setA,
    setB,
    reset,
    initFromView,
    placeInView,
    enable,
    disable,
    toggle,
    computeResults,
  }
}
