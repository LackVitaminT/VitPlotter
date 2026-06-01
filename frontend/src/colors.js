// Per-series color overrides, keyed by series NAME (so a custom color sticks to the right curve
// regardless of index shifts, and can be saved/restored in a dashboard). An absent name falls
// back to the theme palette (see palette.js colorForName). Names include base channels and
// analysis-derived curves alike.
import { reactive } from 'vue'

export function useColors() {
  const overrides = reactive({}) // name -> '#rrggbb'

  function setColor(name, hex) {
    if (name == null || !hex) return
    overrides[name] = hex
  }
  function clearColor(name) {
    delete overrides[name]
  }
  // Restore: replace the whole map (used when loading a dashboard).
  function replaceAll(map) {
    for (const k of Object.keys(overrides)) delete overrides[k]
    if (map) Object.assign(overrides, map)
  }
  function reset() {
    replaceAll(null)
  }

  return { overrides, setColor, clearColor, replaceAll, reset }
}
