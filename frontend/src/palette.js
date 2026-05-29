// Series and axis colors per theme, used by the uPlot chart.
// These are passed to uPlot in JS, so they live here rather than in CSS.

// Catppuccin Mocha accents (dark mode).
const MOCHA = ['#89b4fa', '#a6e3a1', '#f38ba8', '#fab387', '#cba6f7', '#f9e2af', '#94e2d5', '#f5c2e7', '#89dceb', '#b4befe']

// Catppuccin Latte accents (light mode).
const LATTE = ['#1e66f5', '#40a02b', '#d20f39', '#fe640b', '#8839ef', '#df8e1d', '#179299', '#ea76cb', '#04a5e5', '#7287fd']

export const PALETTES = {
  dark: {
    series: MOCHA,
    axis: '#a6adc8', // subtext0
    grid: 'rgba(108, 112, 134, 0.22)', // overlay0
  },
  light: {
    series: LATTE,
    axis: '#6c6f85', // subtext0
    grid: 'rgba(156, 160, 176, 0.30)', // overlay0
  },
}

export function colorFor(theme, index) {
  const palette = PALETTES[theme] || PALETTES.dark
  return palette.series[index % palette.series.length]
}
