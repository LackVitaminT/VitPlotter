<script setup>
import { ref } from 'vue'
import PlotChart from './PlotChart.vue'
import SpectrogramChart from './SpectrogramChart.vue'

defineProps({
  // spectrumResults from useAnalysis(): [{ id, kind, title, data?|spectro?|stats?|empty }]
  results: { type: Array, required: true },
})
const emit = defineEmits(['remove'])

const collapsed = ref(false)
// FFT/PSD cards reuse PlotChart, which needs a visible-index Set; their data has a single series.
const oneVisible = new Set([0])

function fmt(v, d = 4) {
  if (v == null || !Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs !== 0 && (abs >= 1e6 || abs < 1e-4)) return v.toExponential(2)
  return Number(v.toPrecision(d)).toString()
}
</script>

<template>
  <div class="dock" :class="{ collapsed }">
    <div class="dock-head" @click="collapsed = !collapsed">
      <span class="chev">{{ collapsed ? '▸' : '▾' }}</span>
      <span class="title">Analysis</span>
      <span class="count">{{ results.length }}</span>
    </div>

    <div v-show="!collapsed" class="cards">
      <div v-for="r in results" :key="r.id" class="card" :class="{ stats: r.kind === 'stats' }">
        <div class="card-head">
          <span class="card-title" :title="r.title">{{ r.title }}</span>
          <button class="x" title="Remove" @click="emit('remove', r.id)">×</button>
        </div>

        <div class="card-body">
          <div v-if="r.empty" class="placeholder">Waiting for enough samples…</div>

          <PlotChart
            v-else-if="r.kind === 'fft' || r.kind === 'psd'"
            :parsed="r.data"
            :visible="oneVisible"
            :live="false"
            xFormat="number"
            :xPrecision="1"
          />

          <SpectrogramChart v-else-if="r.kind === 'spectrogram'" :spectro="r.spectro" />

          <div v-else-if="r.kind === 'stats'" class="stat-grid">
            <span>RMS</span><strong>{{ fmt(r.stats?.rms) }}</strong> <span>Mean</span
            ><strong>{{ fmt(r.stats?.mean) }}</strong> <span>Std</span
            ><strong>{{ fmt(r.stats?.std) }}</strong> <span>Min</span
            ><strong>{{ fmt(r.stats?.min) }}</strong> <span>Max</span
            ><strong>{{ fmt(r.stats?.max) }}</strong> <span>Pk-Pk</span
            ><strong>{{ fmt(r.stats?.peakToPeak) }}</strong> <span>Dom. freq</span
            ><strong>{{ fmt(r.stats?.dominantHz, 4) }} Hz</strong> <span>Samples</span
            ><strong>{{ r.stats?.count ?? '—' }}</strong>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dock {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--bg-elev);
  overflow: hidden;
}
.dock-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  cursor: pointer;
  user-select: none;
}
.chev {
  color: var(--text-dim);
  font-size: 10px;
}
.title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.count {
  font-size: 12px;
  color: var(--text-dim);
}
.cards {
  display: flex;
  gap: 10px;
  padding: 0 12px 12px;
  overflow-x: auto;
}
.card {
  flex: 0 0 auto;
  width: 340px;
  height: 220px;
  display: flex;
  flex-direction: column;
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}
.card.stats {
  width: 230px;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--border);
}
.card-title {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.x {
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  border-radius: 5px;
}
.x:hover {
  background: var(--surface-hover);
  color: var(--danger);
}
.card-body {
  flex: 1;
  min-height: 0;
  padding: 6px;
  position: relative;
}
.placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-dim);
  font-size: 12px;
}
.stat-grid {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 6px 12px;
  align-content: start;
  padding: 6px 8px;
  font-size: 13px;
}
.stat-grid span {
  color: var(--text-muted);
}
.stat-grid strong {
  color: var(--text);
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
