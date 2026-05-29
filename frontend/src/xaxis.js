// X-axis timestamp formatting. The X value is a plain number (seconds for streams, or the
// CSV first column). The user picks how it is rendered on the axis and at what resolution.

export const X_FORMATS = [
  { value: 'number', label: 'Number' }, // raw value
  { value: 'elapsed', label: 'Elapsed (m:ss)' }, // value is seconds → duration
  { value: 'time', label: 'Clock (HH:MM:SS)' }, // value is Unix epoch seconds → local time
  { value: 'datetime', label: 'Date & time' }, // value is Unix epoch seconds → local date+time
]

// Resolution = number of fractional digits to show.
export const X_PRECISIONS = [
  { value: 0, label: '0' },
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3 (ms)' },
  { value: 6, label: '6 (µs)' },
]

function pad2(n) {
  return String(n).padStart(2, '0')
}

function dateParts(v) {
  const d = new Date(v * 1000)
  if (isNaN(d.getTime())) return null
  return {
    ymd: `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`,
    hms: `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`,
  }
}

// Fractional part as ".xxx" (or '' when precision is 0).
function frac(v, p) {
  if (p <= 0) return ''
  const a = Math.abs(v)
  return (a - Math.floor(a)).toFixed(p).slice(1)
}

export function formatTimestamp(v, format = 'number', precision = 2) {
  if (!Number.isFinite(v)) return ''
  const p = Math.max(0, Math.min(6, precision | 0))

  if (format === 'number') return v.toFixed(p)

  if (format === 'elapsed') {
    const neg = v < 0
    const a = Math.abs(v)
    const whole = Math.floor(a)
    const h = Math.floor(whole / 3600)
    const m = Math.floor((whole % 3600) / 60)
    const s = whole % 60
    const base = h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`
    return (neg ? '-' : '') + base + frac(a, p)
  }

  // Clock / date-time: interpret the value as Unix epoch seconds.
  const parts = dateParts(v)
  if (!parts) return v.toFixed(p)
  if (format === 'time') return parts.hms + frac(v, p)
  if (format === 'datetime') {
    return `${parts.ymd} ${parts.hms}${frac(v, p)}`
  }
  return v.toFixed(p)
}

export function xAxisLabelSpace(format = 'number') {
  if (format === 'datetime') return 110
  if (format === 'time') return 82
  return 62
}

export function formatAxisTimestamp(v, format = 'number', precision = 2) {
  if (!Number.isFinite(v)) return ''
  const p = Math.max(0, Math.min(6, precision | 0))

  if (format === 'datetime') {
    const parts = dateParts(v)
    if (!parts) return v.toFixed(p)
    return `${parts.ymd}\n${parts.hms}${frac(v, p)}`
  }

  if (format === 'time') {
    const parts = dateParts(v)
    if (!parts) return v.toFixed(p)
    return parts.hms + frac(v, p)
  }

  return formatTimestamp(v, format, p)
}
