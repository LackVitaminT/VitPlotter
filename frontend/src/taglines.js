export const WELCOME_TAGLINES = [
  'A minimal, web-based plotting tool inspired by PlotJuggler.',
  'Drop in data, pick your signals, and watch the story unfold.',
  'Fast plots for CSV files and live UDP streams.',
  'A quiet place to inspect noisy signals.',
  'Turn raw numbers into something you can actually reason about.',
  'Plot, compare, and debug time-series data in the browser.',
  'Bring your data. VitPlotter will keep the view clear.',
  'For the moments when a table is no longer enough.',
]

export function randomWelcomeTagline(previous = '') {
  if (WELCOME_TAGLINES.length <= 1) return WELCOME_TAGLINES[0] ?? ''

  let next = previous
  while (next === previous) {
    next = WELCOME_TAGLINES[Math.floor(Math.random() * WELCOME_TAGLINES.length)]
  }
  return next
}
