// Hand-maintained changelog, newest release first. Lives in the frontend so the in-app
// viewer works offline. Bump this alongside vitplotter/_version.py on each release.
//
// Entry shape: { version, date (YYYY-MM-DD), changes: [{ type, text }] }
// `type` is one of CHANGE_TYPES below; it drives the colored badge in the viewer.

export const CHANGELOG = [
  {
    version: '0.1.0a1',
    date: '2026-05-30',
    changes: [
      {
        type: 'added',
        text: 'Analysis panel with built-in filters — Butterworth low/high/band/stop, moving average, differentiate, and integrate — drawn as overlay curves.',
      },
      {
        type: 'added',
        text: 'Spectral analysis dock: FFT magnitude, Welch PSD, spectrogram, and live signal statistics.',
      },
      {
        type: 'added',
        text: 'Per-subplot axes — independent Y mode (auto/fixed) and range, plus X format and resolution.',
      },
      {
        type: 'added',
        text: 'Fuzzy series search; the All / None buttons act on the matched set while filtering.',
      },
      {
        type: 'added',
        text: 'Resizable Series / Analysis sidebar split, defaulting to a 6:4 ratio.',
      },
      {
        type: 'added',
        text: 'Per-subplot "clear series" button, and filter curves are now selectable and draggable from the Filters panel.',
      },
      {
        type: 'changed',
        text: 'Screenshots follow the active theme and embed the legend and capture time, with a transparent / opaque background choice.',
      },
      {
        type: 'fixed',
        text: 'Added an app favicon, resolving the /favicon.ico 404 on load.',
      },
    ],
  },
]

// type → badge label + theme color variable. Order also defines legend/sort intent.
export const CHANGE_TYPES = {
  added: { label: 'Added', color: 'var(--ok, #40a02b)' },
  changed: { label: 'Changed', color: 'var(--accent)' },
  fixed: { label: 'Fixed', color: 'var(--warn, #df8e1d)' },
  removed: { label: 'Removed', color: 'var(--danger)' },
}

export function changeStyle(type) {
  return CHANGE_TYPES[type] ?? { label: type, color: 'var(--text-muted)' }
}
