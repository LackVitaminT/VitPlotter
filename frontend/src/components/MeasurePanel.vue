<script setup>
const props = defineProps({
  // { dx, cursorFreq, rows:[{index,name,color,yA,yB,dy,min,max,mean,rms,dominantHz,count}] }
  results: { type: Object, default: () => ({ dx: null, cursorFreq: null, rows: [] }) },
  active: { type: Boolean, default: false },
  hasData: { type: Boolean, default: false },
})

const emit = defineEmits(['toggle'])

// Compact numeric format: blank for null, exponential for very large/small, else ~6 sig figs.
function fmt(v) {
  if (v == null || !Number.isFinite(v)) return '–'
  const abs = Math.abs(v)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return v.toExponential(3)
  return Number(v.toPrecision(6)).toString()
}
</script>

<template>
  <div class="panel">
    <div class="head">
      <span class="label">Measure</span>
      <button
        class="toggle"
        :class="{ on: active }"
        :disabled="!hasData"
        :title="active ? 'Disable cursors' : 'Enable cursors on the focused plot'"
        @click="emit('toggle')"
      >
        {{ active ? 'On' : 'Enable' }}
      </button>
    </div>

    <p v-if="!hasData" class="hint">Load data to measure.</p>
    <p v-else-if="!active" class="hint">
      Enable measurement, then drag cursors <b>A</b> and <b>B</b> on the focused plot.
    </p>

    <template v-else>
      <div class="summary">
        <div class="kv">
          <span>ΔX</span><strong>{{ fmt(results.dx) }}</strong>
        </div>
        <div class="kv">
          <span>1 / ΔX</span><strong>{{ fmt(results.cursorFreq) }} Hz</strong>
        </div>
      </div>

      <p v-if="!results.rows.length" class="hint">No visible curves in the selection.</p>
      <div v-else class="table-wrap">
        <table class="stats">
          <thead>
            <tr>
              <th class="curve">Curve</th>
              <th>y@A</th>
              <th>y@B</th>
              <th>ΔY</th>
              <th>Min</th>
              <th>Max</th>
              <th>Mean</th>
              <th>RMS</th>
              <th>Freq</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in results.rows" :key="r.index">
              <td class="curve" :title="r.name">
                <span class="swatch" :style="{ background: r.color }"></span>
                <span class="nm">{{ r.name }}</span>
              </td>
              <td>{{ fmt(r.yA) }}</td>
              <td>{{ fmt(r.yB) }}</td>
              <td>{{ fmt(r.dy) }}</td>
              <td>{{ fmt(r.min) }}</td>
              <td>{{ fmt(r.max) }}</td>
              <td>{{ fmt(r.mean) }}</td>
              <td>{{ fmt(r.rms) }}</td>
              <td>{{ fmt(r.dominantHz) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.toggle {
  background: var(--surface);
  color: var(--text-muted);
  border: none;
  border-radius: 7px;
  padding: 3px 11px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.toggle.on {
  background: var(--accent);
  color: var(--accent-contrast);
}
.toggle:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.hint {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.summary {
  display: flex;
  gap: 8px;
}
.kv {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 8px;
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.kv span {
  font-size: 10px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
}
.kv strong {
  font-size: 13px;
  color: var(--text);
  font-variant-numeric: tabular-nums;
}
.table-wrap {
  overflow-x: auto;
}
.stats {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.stats th {
  text-align: right;
  font-weight: 600;
  color: var(--text-dim);
  padding: 4px 6px;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.stats td {
  text-align: right;
  color: var(--text);
  padding: 4px 6px;
  white-space: nowrap;
}
.stats th.curve,
.stats td.curve {
  text-align: left;
  position: sticky;
  left: 0;
  background: var(--bg-elev);
}
.stats td.curve {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 120px;
}
.swatch {
  flex: 0 0 auto;
  width: 10px;
  height: 10px;
  border-radius: 3px;
}
.nm {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.stats tbody tr:hover td {
  background: var(--surface);
}
.stats tbody tr:hover td.curve {
  background: var(--surface);
}
</style>
