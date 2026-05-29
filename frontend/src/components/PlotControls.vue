<script setup>
import { X_FORMATS, X_PRECISIONS } from '../xaxis.js'

const props = defineProps({
  yMode: { type: String, default: 'auto' }, // 'auto' | 'fixed'
  yMin: { type: Number, default: 0 },
  yMax: { type: Number, default: 1 },
  xMode: { type: String, default: 'auto' },
  xMin: { type: Number, default: 0 },
  xMax: { type: Number, default: 1 },
  xFormat: { type: String, default: 'number' },
  xPrecision: { type: Number, default: 2 },
  live: { type: Boolean, default: false },
  maxPoints: { type: Number, default: 2000 },
})
const emit = defineEmits([
  'update:yMode',
  'update:yMin',
  'update:yMax',
  'update:xMode',
  'update:xMin',
  'update:xMax',
  'update:xFormat',
  'update:xPrecision',
  'update:maxPoints',
])
</script>

<template>
  <div class="controls">
    <div class="group">
      <span class="lbl">Y axis</span>
      <div class="segmented">
        <button :class="{ active: yMode === 'auto' }" @click="emit('update:yMode', 'auto')">
          Auto
        </button>
        <button :class="{ active: yMode === 'fixed' }" @click="emit('update:yMode', 'fixed')">
          Fixed
        </button>
      </div>
      <input
        class="num"
        type="number"
        :value="yMin"
        :disabled="yMode !== 'fixed'"
        @input="emit('update:yMin', Number($event.target.value))"
        aria-label="Y min"
      />
      <span class="dash">–</span>
      <input
        class="num"
        type="number"
        :value="yMax"
        :disabled="yMode !== 'fixed'"
        @input="emit('update:yMax', Number($event.target.value))"
        aria-label="Y max"
      />
    </div>

    <div class="group">
      <span class="lbl">X axis</span>
      <div class="segmented">
        <button :class="{ active: xMode === 'auto' }" @click="emit('update:xMode', 'auto')">
          Auto
        </button>
        <button :class="{ active: xMode === 'fixed' }" @click="emit('update:xMode', 'fixed')">
          Fixed
        </button>
      </div>
      <input
        class="num range"
        type="number"
        :value="xMin"
        :disabled="xMode !== 'fixed'"
        @input="emit('update:xMin', Number($event.target.value))"
        aria-label="X min"
      />
      <span class="dash">–</span>
      <input
        class="num range"
        type="number"
        :value="xMax"
        :disabled="xMode !== 'fixed'"
        @input="emit('update:xMax', Number($event.target.value))"
        aria-label="X max"
      />
      <select
        class="sel"
        :value="xFormat"
        @change="emit('update:xFormat', $event.target.value)"
        aria-label="X axis time format"
      >
        <option v-for="f in X_FORMATS" :key="f.value" :value="f.value">{{ f.label }}</option>
      </select>
      <select
        class="sel narrow"
        :value="xPrecision"
        @change="emit('update:xPrecision', Number($event.target.value))"
        aria-label="X axis resolution"
        title="Resolution (fractional digits)"
      >
        <option v-for="r in X_PRECISIONS" :key="r.value" :value="r.value">{{ r.label }}</option>
      </select>
    </div>

    <div v-if="live" class="group">
      <span class="lbl">History</span>
      <input
        class="num wide"
        type="number"
        min="1"
        :value="maxPoints"
        @input="emit('update:maxPoints', Number($event.target.value))"
        aria-label="Max history points"
      />
      <span class="unit">pts</span>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 18px;
  padding: 0 2px 12px;
}
.group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lbl {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.segmented {
  display: inline-flex;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 3px;
}
.segmented button {
  background: transparent;
  color: var(--text-muted);
  border: none;
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.segmented button.active {
  background: var(--accent);
  color: var(--accent-contrast);
}
.num {
  width: 72px;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
}
.num.wide {
  width: 84px;
}
.num.range {
  width: 120px;
}
.sel {
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}
.sel.narrow {
  width: 84px;
}
.sel:focus {
  border-color: var(--accent);
}
.num:focus {
  border-color: var(--accent);
}
.num:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.dash {
  color: var(--text-dim);
}
.unit {
  font-size: 12px;
  color: var(--text-dim);
}
</style>
