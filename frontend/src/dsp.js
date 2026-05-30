// Pure-JS digital signal processing primitives (no Vue, no deps). Used by analysis.js for
// filters (Butterworth/moving-average/diff/integrate) and spectral analysis (FFT magnitude,
// Welch PSD, spectrogram, statistics). All transforms are real-input; callers feed contiguous
// non-null segments so gaps/pauses never corrupt a result.

// ---- helpers -------------------------------------------------------------- //

export function nextPow2(n) {
  let p = 1
  while (p < n) p *= 2
  return p
}

// In-place iterative radix-2 Cooley-Tukey FFT. re/im are equal-length arrays whose length is a
// power of two. Transforms in place.
export function fft(re, im) {
  const n = re.length
  if (n <= 1) return
  // bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wpr = Math.cos(ang)
    const wpi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wr = 1
      let wi = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = i + k + len / 2
        const tr = wr * re[b] - wi * im[b]
        const ti = wr * im[b] + wi * re[b]
        re[b] = re[a] - tr
        im[b] = im[a] - ti
        re[a] += tr
        im[a] += ti
        const nwr = wr * wpr - wi * wpi
        wi = wr * wpi + wi * wpr
        wr = nwr
      }
    }
  }
}

// ---- windows -------------------------------------------------------------- //

export const WINDOW_TYPES = ['rectangular', 'hann', 'hamming', 'blackman']

// Returns a Float64Array of length n for the given window type.
export function window(n, type = 'hann') {
  const w = new Float64Array(n)
  if (n === 1) {
    w[0] = 1
    return w
  }
  for (let i = 0; i < n; i++) {
    const r = i / (n - 1)
    switch (type) {
      case 'hann':
        w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * r)
        break
      case 'hamming':
        w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * r)
        break
      case 'blackman':
        w[i] = 0.42 - 0.5 * Math.cos(2 * Math.PI * r) + 0.08 * Math.cos(4 * Math.PI * r)
        break
      case 'rectangular':
      default:
        w[i] = 1
    }
  }
  return w
}

function sum(arr) {
  let s = 0
  for (let i = 0; i < arr.length; i++) s += arr[i]
  return s
}

// ---- spectra -------------------------------------------------------------- //

// One-sided amplitude spectrum of a real signal. Returns { freqs, mags } where mags are in the
// same units as the input (a pure sine of amplitude A peaks near A). N is zero-padded to a power
// of two for the FFT, but the window normalization uses the original sample count.
export function magnitudeSpectrum(samples, fs, { window: winType = 'hann' } = {}) {
  const n = samples.length
  if (n < 2 || !(fs > 0)) return { freqs: [], mags: [] }
  const w = window(n, winType)
  const nfft = nextPow2(n)
  const re = new Float64Array(nfft)
  const im = new Float64Array(nfft)
  for (let i = 0; i < n; i++) re[i] = samples[i] * w[i]
  fft(re, im)
  const cg = sum(w) // coherent gain
  const half = nfft / 2
  const freqs = new Array(half + 1)
  const mags = new Array(half + 1)
  for (let k = 0; k <= half; k++) {
    const mag = Math.hypot(re[k], im[k])
    const scale = k === 0 || k === half ? 1 / cg : 2 / cg
    mags[k] = mag * scale
    freqs[k] = (k * fs) / nfft
  }
  return { freqs, mags }
}

// Welch power spectral density (V^2/Hz). Segments of segLen with `overlap` fraction, windowed,
// periodograms averaged. segLen is clamped to a power of two <= signal length.
export function welchPSD(
  samples,
  fs,
  { window: winType = 'hann', segLen = 256, overlap = 0.5 } = {},
) {
  const n = samples.length
  if (n < 4 || !(fs > 0)) return { freqs: [], psd: [] }
  let L = nextPow2(Math.min(segLen, n))
  if (L > n) L = L >> 1
  if (L < 2) return { freqs: [], psd: [] }
  const w = window(L, winType)
  const winPow = sum(w.map((v) => v * v)) // window power for normalization
  const hop = Math.max(1, Math.floor(L * (1 - overlap)))
  const half = L / 2
  const psd = new Float64Array(half + 1)
  let frames = 0
  for (let start = 0; start + L <= n; start += hop) {
    const re = new Float64Array(L)
    const im = new Float64Array(L)
    for (let i = 0; i < L; i++) re[i] = samples[start + i] * w[i]
    fft(re, im)
    for (let k = 0; k <= half; k++) {
      const p = (re[k] * re[k] + im[k] * im[k]) / (fs * winPow)
      psd[k] += k === 0 || k === half ? p : 2 * p
    }
    frames++
  }
  if (frames === 0) return { freqs: [], psd: [] }
  const freqs = new Array(half + 1)
  const out = new Array(half + 1)
  for (let k = 0; k <= half; k++) {
    out[k] = psd[k] / frames
    freqs[k] = (k * fs) / L
  }
  return { freqs, psd: out }
}

// Short-time Fourier transform → magnitude matrix in dB. Returns { times, freqs, mags } where
// mags is an array of Float32Array (one column per frame, length = nbins).
export function spectrogram(samples, fs, { window: winType = 'hann', segLen = 256, hop } = {}) {
  const n = samples.length
  let L = nextPow2(Math.min(segLen, n))
  if (L > n) L = L >> 1
  if (L < 2 || !(fs > 0)) return { times: [], freqs: [], mags: [] }
  const step = Math.max(1, Math.floor(hop ?? L / 2))
  const w = window(L, winType)
  const cg = sum(w)
  const half = L / 2
  const freqs = new Array(half + 1)
  for (let k = 0; k <= half; k++) freqs[k] = (k * fs) / L
  const times = []
  const mags = []
  for (let start = 0; start + L <= n; start += step) {
    const re = new Float64Array(L)
    const im = new Float64Array(L)
    for (let i = 0; i < L; i++) re[i] = samples[start + i] * w[i]
    fft(re, im)
    const col = new Float32Array(half + 1)
    for (let k = 0; k <= half; k++) {
      const amp = (Math.hypot(re[k], im[k]) * (k === 0 || k === half ? 1 : 2)) / cg
      col[k] = 20 * Math.log10(amp + 1e-12) // dB
    }
    mags.push(col)
    times.push((start + L / 2) / fs)
  }
  return { times, freqs, mags }
}

// ---- filters: Butterworth via cascaded RBJ biquads ------------------------ //
// A biquad is { b0, b1, b2, a1, a2 } with a0 normalized to 1.

function rbjBiquad(type, fs, f0, Q) {
  const w0 = (2 * Math.PI * f0) / fs
  const cw = Math.cos(w0)
  const sw = Math.sin(w0)
  const alpha = sw / (2 * Q)
  let b0, b1, b2
  const a0 = 1 + alpha
  const a1 = -2 * cw
  const a2 = 1 - alpha
  switch (type) {
    case 'highpass':
      b0 = (1 + cw) / 2
      b1 = -(1 + cw)
      b2 = (1 + cw) / 2
      break
    case 'bandpass': // constant 0 dB peak gain
      b0 = alpha
      b1 = 0
      b2 = -alpha
      break
    case 'bandstop': // notch
      b0 = 1
      b1 = -2 * cw
      b2 = 1
      break
    case 'lowpass':
    default:
      b0 = (1 - cw) / 2
      b1 = 1 - cw
      b2 = (1 - cw) / 2
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 }
}

// Butterworth low/high-pass as a cascade of N/2 biquads with the standard pole Q factors.
// `order` is clamped to an even value in [2, 8]. Band-pass/stop are a single 2nd-order RBJ
// section parameterized by the [low, high] band (Q = f0 / bandwidth).
export function designFilter(type, fs, params = {}) {
  const nyq = fs / 2
  if (type === 'bandpass' || type === 'bandstop') {
    let lo = Math.max(1e-6, Math.min(params.low ?? 0.1, nyq * 0.999))
    let hi = Math.max(lo * 1.0001, Math.min(params.high ?? nyq * 0.5, nyq * 0.999))
    const f0 = Math.sqrt(lo * hi)
    const bw = Math.max(1e-6, hi - lo)
    return [rbjBiquad(type, fs, f0, f0 / bw)]
  }
  const fc = Math.max(1e-6, Math.min(params.cutoff ?? nyq * 0.25, nyq * 0.999))
  let order = Math.round(params.order ?? 2)
  order = Math.max(2, Math.min(8, order % 2 === 0 ? order : order + 1))
  const sections = order / 2
  const sos = []
  for (let k = 0; k < sections; k++) {
    const theta = ((2 * k + 1) * Math.PI) / (2 * order)
    const Q = 1 / (2 * Math.cos(theta))
    sos.push(rbjBiquad(type, fs, fc, Q))
  }
  return sos
}

// Apply a biquad cascade causally (Direct Form II transposed). State resets at the start of each
// call, so feeding one contiguous segment at a time prevents ringing across gaps.
export function applyBiquads(samples, sos) {
  const out = new Float64Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i]
  for (const s of sos) {
    let z1 = 0
    let z2 = 0
    for (let i = 0; i < out.length; i++) {
      const x = out[i]
      const y = s.b0 * x + z1
      z1 = s.b1 * x - s.a1 * y + z2
      z2 = s.b2 * x - s.a2 * y
      out[i] = y
    }
  }
  return out
}

// ---- filters: simple time-domain ------------------------------------------ //

// Centered boxcar moving average; window shrinks at the edges. `win` is in samples (odd is best).
export function movingAverage(samples, win) {
  const n = samples.length
  const half = Math.max(0, Math.floor(win / 2))
  const out = new Float64Array(n)
  // running sum
  let acc = 0
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) {
    acc += samples[i]
    prefix[i + 1] = acc
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n - 1, i + half)
    out[i] = (prefix[b + 1] - prefix[a]) / (b - a + 1)
  }
  return out
}

// Median filter (robust smoothing / spike removal). `win` in samples.
export function medianFilter(samples, win) {
  const n = samples.length
  const half = Math.max(0, Math.floor(win / 2))
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half)
    const b = Math.min(n - 1, i + half)
    const slice = []
    for (let j = a; j <= b; j++) slice.push(samples[j])
    slice.sort((x, y) => x - y)
    out[i] = slice[(slice.length - 1) >> 1]
  }
  return out
}

// Numerical derivative dy/dx via central differences (forward/backward at the ends).
export function differentiate(samples, x) {
  const n = samples.length
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    if (i === 0 && n > 1) out[i] = (samples[1] - samples[0]) / (x[1] - x[0] || 1)
    else if (i === n - 1 && n > 1) out[i] = (samples[i] - samples[i - 1]) / (x[i] - x[i - 1] || 1)
    else if (n > 2) out[i] = (samples[i + 1] - samples[i - 1]) / (x[i + 1] - x[i - 1] || 1)
  }
  return out
}

// Cumulative trapezoidal integral, starting at 0 for each segment.
export function integrate(samples, x) {
  const n = samples.length
  const out = new Float64Array(n)
  let acc = 0
  for (let i = 1; i < n; i++) {
    acc += ((samples[i] + samples[i - 1]) / 2) * (x[i] - x[i - 1])
    out[i] = acc
  }
  return out
}

// ---- gap handling --------------------------------------------------------- //

// Contiguous runs where both x and y are finite numbers. Returns [{ start, end }] (end exclusive).
export function segments(x, y) {
  const runs = []
  let start = -1
  const n = y.length
  for (let i = 0; i < n; i++) {
    const ok = Number.isFinite(y[i]) && Number.isFinite(x[i])
    if (ok && start < 0) start = i
    if (!ok && start >= 0) {
      runs.push({ start, end: i })
      start = -1
    }
  }
  if (start >= 0) runs.push({ start, end: n })
  return runs
}

// Build a full-length array of `len`, filled with null, then write each run's values back at its
// original positions. Preserves the source's nulls so a derived curve breaks at the same gaps.
export function reassemble(len, runs) {
  const out = new Array(len).fill(null)
  for (const { range, values } of runs) {
    for (let i = 0; i < values.length; i++) out[range.start + i] = values[i]
  }
  return out
}

// Longest contiguous non-null run of y (with matching x). Used by spectral analyses so a window
// never straddles a pause/discontinuity.
export function latestSegment(x, y, maxLen = Infinity) {
  const runs = segments(x, y)
  if (!runs.length) return null
  const last = runs[runs.length - 1]
  let { start, end } = last
  if (end - start > maxLen) start = end - maxLen
  const xs = []
  const ys = []
  for (let i = start; i < end; i++) {
    xs.push(x[i])
    ys.push(y[i])
  }
  return { x: xs, y: ys }
}

// Median positive delta between consecutive x values (robust sample-rate estimate).
export function estimateDt(x) {
  const diffs = []
  for (let i = 1; i < x.length; i++) {
    const d = x[i] - x[i - 1]
    if (Number.isFinite(d) && d > 0) diffs.push(d)
  }
  if (!diffs.length) return null
  diffs.sort((a, b) => a - b)
  return diffs[diffs.length >> 1]
}

// ---- statistics ----------------------------------------------------------- //

export function statistics(samples, fs) {
  const n = samples.length
  if (!n) return null
  let mean = 0
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < n; i++) {
    mean += samples[i]
    if (samples[i] < min) min = samples[i]
    if (samples[i] > max) max = samples[i]
  }
  mean /= n
  let sq = 0
  let varAcc = 0
  for (let i = 0; i < n; i++) {
    sq += samples[i] * samples[i]
    varAcc += (samples[i] - mean) ** 2
  }
  const rms = Math.sqrt(sq / n)
  const std = Math.sqrt(varAcc / n)
  let dominantHz = null
  if (fs > 0 && n >= 4) {
    const { freqs, mags } = magnitudeSpectrum(samples, fs)
    let best = -1
    let bestK = 0
    for (let k = 1; k < mags.length; k++) {
      if (mags[k] > best) {
        best = mags[k]
        bestK = k
      }
    }
    dominantHz = freqs[bestK] ?? null
  }
  return { count: n, mean, min, max, peakToPeak: max - min, rms, std, dominantHz }
}
