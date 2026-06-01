// Analysis layer: turns the active dataset ({x, series}) into (1) derived filter curves appended
// to the series list so they overlay in the main grid, and (2) spectral results (FFT/PSD/
// spectrogram/stats) rendered in the Analysis dock. Everything is gap-aware: filters run per
// contiguous non-null segment and re-insert nulls (so derived curves break at the same pauses),
// and spectral analyses only ever look at the latest contiguous run.
import { computed, ref, watch } from 'vue'
import {
  applyBiquads,
  designFilter,
  differentiate,
  estimateDt,
  integrate,
  latestSegment,
  magnitudeSpectrum,
  medianFilter,
  movingAverage,
  reassemble,
  segments,
  spectrogram,
  statistics,
  welchPSD,
} from './dsp.js'

let seq = 0
const nextId = () => `a${++seq}`

export const FILTER_TYPES = [
  { value: 'lowpass', label: 'Low-pass (Butterworth)' },
  { value: 'highpass', label: 'High-pass (Butterworth)' },
  { value: 'bandpass', label: 'Band-pass' },
  { value: 'bandstop', label: 'Band-stop (notch)' },
  { value: 'movingavg', label: 'Moving average' },
  { value: 'median', label: 'Median (smooth)' },
  { value: 'derivative', label: 'Differentiate (d/dt)' },
  { value: 'integral', label: 'Integrate (∫)' },
]

export const ANALYSIS_KINDS = [
  { value: 'fft', label: 'FFT magnitude' },
  { value: 'psd', label: 'Power spectral density' },
  { value: 'spectrogram', label: 'Spectrogram' },
  { value: 'stats', label: 'Statistics' },
]

function round(v, d = 3) {
  if (!Number.isFinite(v)) return v
  const p = 10 ** d
  return Math.round(v * p) / p
}

// Short human label for a filter, used as the derived series name (so it nests in the tree).
export function filterLabel(f) {
  const s = f.sourceName
  const p = f.params || {}
  switch (f.type) {
    case 'lowpass':
      return `${s} · LP ${round(p.cutoff)}Hz`
    case 'highpass':
      return `${s} · HP ${round(p.cutoff)}Hz`
    case 'bandpass':
      return `${s} · BP ${round(p.low)}-${round(p.high)}Hz`
    case 'bandstop':
      return `${s} · BS ${round(p.low)}-${round(p.high)}Hz`
    case 'movingavg':
      return `${s} · MA ${p.win}`
    case 'median':
      return `${s} · Med ${p.win}`
    case 'derivative':
      return `${s} · d/dt`
    case 'integral':
      return `${s} · ∫`
    default:
      return `${s} · ?`
  }
}

export function analysisLabel(a) {
  const k = ANALYSIS_KINDS.find((x) => x.value === a.kind)?.label || a.kind
  return `${a.sourceName} · ${k}`
}

// Default params for a freshly added filter/analysis of the given type.
export function defaultFilterParams(type) {
  switch (type) {
    case 'lowpass':
      return { cutoff: 5, order: 2 }
    case 'highpass':
      return { cutoff: 5, order: 2 }
    case 'bandpass':
    case 'bandstop':
      return { low: 1, high: 10 }
    case 'movingavg':
    case 'median':
      return { win: 11 }
    default:
      return {}
  }
}

export function defaultAnalysisParams(kind) {
  switch (kind) {
    case 'fft':
      return { window: 'hann', windowSamples: 2048 }
    case 'psd':
      return { window: 'hann', segLen: 256, windowSamples: 4096 }
    case 'spectrogram':
      return { window: 'hann', segLen: 128, windowSamples: 4096 }
    case 'stats':
      return { windowSamples: 2048 }
    default:
      return {}
  }
}

export function useAnalysis(activeData, live) {
  const filters = ref([]) // [{ id, sourceName, type, params }]
  const analyses = ref([]) // [{ id, sourceName, kind, params }]
  const spectrumResults = ref([])

  // Base (un-derived) series names — the choices offered as analysis/filter sources.
  const sourceNames = computed(() => (activeData.value?.series ?? []).map((s) => s.name))

  function findSeries(data, name) {
    return data?.series?.find((s) => s.name === name) || null
  }

  // Compute one filter's output as a full-length, gap-preserving values array. Always returns a
  // { name, values } (all-null if the source is gone) so derived series stay index-aligned with
  // the stable name list used by the selector and visibility remap.
  function computeFilter(f, data) {
    const name = filterLabel(f)
    const src = findSeries(data, f.sourceName)
    const x = data?.x?.values
    if (!src || !x) return { name, values: new Array(x?.length || 0).fill(null) }
    const y = src.values
    const dt = estimateDt(x)
    const fs = dt && dt > 0 ? 1 / dt : 1
    const runs = segments(x, y)
    const outRuns = []
    for (const range of runs) {
      const xs = x.slice(range.start, range.end)
      const ys = y.slice(range.start, range.end)
      let vals
      switch (f.type) {
        case 'lowpass':
        case 'highpass':
        case 'bandpass':
        case 'bandstop':
          vals = applyBiquads(ys, designFilter(f.type, fs, f.params))
          break
        case 'movingavg':
          vals = movingAverage(ys, Math.max(1, f.params.win | 0))
          break
        case 'median':
          vals = medianFilter(ys, Math.max(1, f.params.win | 0))
          break
        case 'derivative':
          vals = differentiate(ys, xs)
          break
        case 'integral':
          vals = integrate(ys, xs)
          break
        default:
          vals = ys
      }
      outRuns.push({ range, values: vals })
    }
    return { name, values: reassemble(y.length, outRuns) }
  }

  // Derived filter series (one per filter). Recomputes whenever the data or filter set changes.
  const derivedSeries = computed(() => {
    const data = activeData.value
    if (!data || !filters.value.length) return []
    return filters.value.map((f) => computeFilter(f, data))
  })

  // Stable list of derived series names (changes only when filters change, not every frame) — used
  // by the selector tree and the name-based visibility remap.
  const derivedNames = computed(() => filters.value.map(filterLabel))

  // What the grid + selector consume: base series followed by derived filter curves.
  const analyzedData = computed(() => {
    const data = activeData.value
    if (!data) return data
    const extra = derivedSeries.value
    if (!extra.length) return data
    return { x: data.x, series: [...data.series, ...extra] }
  })

  // ---- spectral analyses (throttled while live) --------------------------- //

  function computeAnalysis(a) {
    const data = activeData.value
    const src = findSeries(data, a.sourceName)
    const x = data?.x?.values
    const base = {
      id: a.id,
      kind: a.kind,
      sourceName: a.sourceName,
      title: analysisLabel(a),
      params: a.params,
    }
    if (!src || !x) return { ...base, empty: true }
    const maxLen = Math.max(8, a.params.windowSamples | 0 || 2048)
    const seg = latestSegment(x, src.values, maxLen)
    if (!seg || seg.y.length < 4) return { ...base, empty: true }
    const dt = estimateDt(seg.x)
    const fs = dt && dt > 0 ? 1 / dt : 1
    if (a.kind === 'fft') {
      const { freqs, mags } = magnitudeSpectrum(seg.y, fs, { window: a.params.window })
      return {
        ...base,
        fs,
        data: {
          x: { name: 'Frequency (Hz)', values: freqs },
          series: [{ name: 'Magnitude', values: mags }],
        },
      }
    }
    if (a.kind === 'psd') {
      const { freqs, psd } = welchPSD(seg.y, fs, {
        window: a.params.window,
        segLen: a.params.segLen,
      })
      return {
        ...base,
        fs,
        data: {
          x: { name: 'Frequency (Hz)', values: freqs },
          series: [{ name: 'PSD', values: psd }],
        },
      }
    }
    if (a.kind === 'spectrogram') {
      const sg = spectrogram(seg.y, fs, { window: a.params.window, segLen: a.params.segLen })
      return { ...base, fs, spectro: sg }
    }
    // stats
    return { ...base, fs, stats: statistics(seg.y, fs) }
  }

  function recompute() {
    spectrumResults.value = analyses.value.map(computeAnalysis)
  }

  // Throttle spectral recompute while streaming so several FFTs don't choke the UI.
  let lastRun = 0
  let timer = null
  const MIN_MS = 200
  function schedule() {
    if (!live?.value) {
      recompute()
      return
    }
    const now = Date.now()
    const since = now - lastRun
    if (since >= MIN_MS) {
      lastRun = now
      recompute()
    } else if (!timer) {
      timer = setTimeout(() => {
        timer = null
        lastRun = Date.now()
        recompute()
      }, MIN_MS - since)
    }
  }

  watch([activeData, analyses], schedule, { deep: true })

  // ---- CRUD --------------------------------------------------------------- //

  function addFilter(sourceName, type) {
    if (!sourceName) return
    filters.value = [
      ...filters.value,
      { id: nextId(), sourceName, type, params: defaultFilterParams(type) },
    ]
  }
  function updateFilter(id, patch) {
    filters.value = filters.value.map((f) => (f.id === id ? { ...f, ...patch } : f))
  }
  function removeFilter(id) {
    filters.value = filters.value.filter((f) => f.id !== id)
  }
  function addAnalysis(sourceName, kind) {
    if (!sourceName) return
    analyses.value = [
      ...analyses.value,
      { id: nextId(), sourceName, kind, params: defaultAnalysisParams(kind) },
    ]
    schedule()
  }
  function updateAnalysis(id, patch) {
    analyses.value = analyses.value.map((a) => (a.id === id ? { ...a, ...patch } : a))
    schedule()
  }
  function removeAnalysis(id) {
    analyses.value = analyses.value.filter((a) => a.id !== id)
    spectrumResults.value = spectrumResults.value.filter((r) => r.id !== id)
  }
  function clear() {
    filters.value = []
    analyses.value = []
    spectrumResults.value = []
  }
  // Restore filters/analyses from a saved dashboard. Bumps the id counter past restored ids so
  // newly added filters/analyses never collide. Spectral results recompute via the watch.
  function restore(snap) {
    filters.value = Array.isArray(snap?.filters) ? snap.filters.map((f) => ({ ...f })) : []
    analyses.value = Array.isArray(snap?.analyses) ? snap.analyses.map((a) => ({ ...a })) : []
    for (const item of [...filters.value, ...analyses.value]) {
      const n = parseInt(String(item.id).replace(/^a/, ''), 10)
      if (Number.isFinite(n) && n > seq) seq = n
    }
    schedule()
  }

  return {
    filters,
    analyses,
    spectrumResults,
    sourceNames,
    derivedSeries,
    derivedNames,
    analyzedData,
    addFilter,
    updateFilter,
    removeFilter,
    addAnalysis,
    updateAnalysis,
    removeAnalysis,
    clear,
    restore,
  }
}
