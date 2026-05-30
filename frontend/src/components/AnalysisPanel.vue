<script setup>
import { reactive, ref } from 'vue'
import { WINDOW_TYPES } from '../dsp.js'
import { ANALYSIS_KINDS, FILTER_TYPES, analysisLabel, filterLabel } from '../analysis.js'
import { colorFor } from '../palette.js'
import { theme } from '../theme.js'
import { setDragData } from '../dnd.js'

const props = defineProps({
  filters: { type: Array, required: true },
  analyses: { type: Array, required: true },
  sourceNames: { type: Array, required: true },
  // Number of base (non-derived) series — filter overlay #k lives at series index baseCount + k.
  baseCount: { type: Number, default: 0 },
  // Focused subplot's visible-index Set (drives the filter row checkboxes).
  visible: { type: Object, default: () => new Set() },
})

const emit = defineEmits([
  'toggle',
  'add-filter',
  'update-filter',
  'remove-filter',
  'add-analysis',
  'update-analysis',
  'remove-analysis',
])

// The series index of the filter at array position `idx` (matches App's analyzedData ordering).
const filterIndex = (idx) => props.baseCount + idx

function onFilterDragStart(e, idx, label) {
  setDragData(e, [filterIndex(idx)], label)
  e.currentTarget.classList.add('dragging')
}
function onFilterDragEnd(e) {
  e.currentTarget.classList.remove('dragging')
}

// Which item rows have their param editor expanded.
const expanded = reactive(new Set())
function toggleExpand(id) {
  if (expanded.has(id)) expanded.delete(id)
  else expanded.add(id)
}

// Inline "add" editors.
const addFilter = reactive({ open: false, source: '', type: 'lowpass' })
const addAnalysis = reactive({ open: false, source: '', kind: 'fft' })

function openAddFilter() {
  addFilter.open = true
  addFilter.source = props.sourceNames[0] || ''
}
function openAddAnalysis() {
  addAnalysis.open = true
  addAnalysis.source = props.sourceNames[0] || ''
}
function confirmAddFilter() {
  if (addFilter.source) emit('add-filter', addFilter.source, addFilter.type)
  addFilter.open = false
}
function confirmAddAnalysis() {
  if (addAnalysis.source) emit('add-analysis', addAnalysis.source, addAnalysis.kind)
  addAnalysis.open = false
}

function setFilterParam(f, key, value) {
  emit('update-filter', f.id, { params: { ...f.params, [key]: value } })
}
function setAnalysisParam(a, key, value) {
  emit('update-analysis', a.id, { params: { ...a.params, [key]: value } })
}
const num = (e) => Number(e.target.value)
</script>

<template>
  <div class="panel">
    <!-- Filters ----------------------------------------------------------- -->
    <div class="section">
      <div class="head">
        <span class="label">Filters</span>
        <button
          class="add"
          :disabled="!sourceNames.length"
          title="Add filter"
          @click="openAddFilter"
        >
          + Add
        </button>
      </div>

      <div v-if="addFilter.open" class="editor">
        <select v-model="addFilter.source" class="sel">
          <option v-for="n in sourceNames" :key="n" :value="n">{{ n }}</option>
        </select>
        <select v-model="addFilter.type" class="sel">
          <option v-for="t in FILTER_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
        <div class="editor-actions">
          <button class="ghost" @click="addFilter.open = false">Cancel</button>
          <button class="primary" @click="confirmAddFilter">Add</button>
        </div>
      </div>

      <ul class="list">
        <li v-for="(f, idx) in filters" :key="f.id" class="item">
          <div
            class="item-head"
            draggable="true"
            title="Drag onto a plot, or check to show in the focused plot"
            @dragstart="onFilterDragStart($event, idx, filterLabel(f))"
            @dragend="onFilterDragEnd"
          >
            <button class="chev" @click="toggleExpand(f.id)">
              {{ expanded.has(f.id) ? '▾' : '▸' }}
            </button>
            <input
              type="checkbox"
              :checked="visible.has(filterIndex(idx))"
              @click.stop
              @change="emit('toggle', filterIndex(idx))"
            />
            <span class="swatch" :style="{ background: colorFor(theme, filterIndex(idx)) }"></span>
            <span class="name" :title="filterLabel(f)">{{ filterLabel(f) }}</span>
            <button class="x" title="Remove" @click.stop="emit('remove-filter', f.id)">×</button>
          </div>
          <div v-if="expanded.has(f.id)" class="params">
            <template v-if="f.type === 'lowpass' || f.type === 'highpass'">
              <label>Cutoff (Hz)</label>
              <input
                class="num"
                type="number"
                min="0"
                step="0.1"
                :value="f.params.cutoff"
                @input="setFilterParam(f, 'cutoff', num($event))"
              />
              <label>Order</label>
              <select
                class="sel sm"
                :value="f.params.order"
                @change="setFilterParam(f, 'order', num($event))"
              >
                <option :value="2">2</option>
                <option :value="4">4</option>
                <option :value="6">6</option>
                <option :value="8">8</option>
              </select>
            </template>
            <template v-else-if="f.type === 'bandpass' || f.type === 'bandstop'">
              <label>Low (Hz)</label>
              <input
                class="num"
                type="number"
                min="0"
                step="0.1"
                :value="f.params.low"
                @input="setFilterParam(f, 'low', num($event))"
              />
              <label>High (Hz)</label>
              <input
                class="num"
                type="number"
                min="0"
                step="0.1"
                :value="f.params.high"
                @input="setFilterParam(f, 'high', num($event))"
              />
            </template>
            <template v-else-if="f.type === 'movingavg' || f.type === 'median'">
              <label>Window (samples)</label>
              <input
                class="num"
                type="number"
                min="1"
                step="1"
                :value="f.params.win"
                @input="setFilterParam(f, 'win', num($event))"
              />
            </template>
            <span v-else class="hint">No parameters.</span>
          </div>
        </li>
      </ul>
      <p v-if="!filters.length && !addFilter.open" class="empty">No filters.</p>
    </div>

    <!-- Analyses ---------------------------------------------------------- -->
    <div class="section">
      <div class="head">
        <span class="label">Analyses</span>
        <button
          class="add"
          :disabled="!sourceNames.length"
          title="Add analysis"
          @click="openAddAnalysis"
        >
          + Add
        </button>
      </div>

      <div v-if="addAnalysis.open" class="editor">
        <select v-model="addAnalysis.source" class="sel">
          <option v-for="n in sourceNames" :key="n" :value="n">{{ n }}</option>
        </select>
        <select v-model="addAnalysis.kind" class="sel">
          <option v-for="k in ANALYSIS_KINDS" :key="k.value" :value="k.value">{{ k.label }}</option>
        </select>
        <div class="editor-actions">
          <button class="ghost" @click="addAnalysis.open = false">Cancel</button>
          <button class="primary" @click="confirmAddAnalysis">Add</button>
        </div>
      </div>

      <ul class="list">
        <li v-for="a in analyses" :key="a.id" class="item">
          <div class="item-head">
            <button class="chev" @click="toggleExpand(a.id)">
              {{ expanded.has(a.id) ? '▾' : '▸' }}
            </button>
            <span class="name" :title="analysisLabel(a)">{{ analysisLabel(a) }}</span>
            <button class="x" title="Remove" @click="emit('remove-analysis', a.id)">×</button>
          </div>
          <div v-if="expanded.has(a.id)" class="params">
            <template v-if="a.kind !== 'stats'">
              <label>Window</label>
              <select
                class="sel sm"
                :value="a.params.window"
                @change="setAnalysisParam(a, 'window', $event.target.value)"
              >
                <option v-for="w in WINDOW_TYPES" :key="w" :value="w">{{ w }}</option>
              </select>
            </template>
            <template v-if="a.kind === 'psd' || a.kind === 'spectrogram'">
              <label>Segment</label>
              <input
                class="num"
                type="number"
                min="16"
                step="16"
                :value="a.params.segLen"
                @input="setAnalysisParam(a, 'segLen', num($event))"
              />
            </template>
            <label>Samples</label>
            <input
              class="num"
              type="number"
              min="16"
              step="64"
              :value="a.params.windowSamples"
              @input="setAnalysisParam(a, 'windowSamples', num($event))"
            />
          </div>
        </li>
      </ul>
      <p v-if="!analyses.length && !addAnalysis.open" class="empty">No analyses.</p>
    </div>
  </div>
</template>

<style scoped>
.panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.section {
  display: flex;
  flex-direction: column;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.add {
  background: var(--surface);
  color: var(--text-muted);
  border: none;
  border-radius: 7px;
  padding: 3px 9px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.add:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text);
}
.add:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  margin-bottom: 8px;
  background: var(--bg-inset);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.editor-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.editor-actions button {
  border: none;
  border-radius: 7px;
  padding: 5px 0;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.ghost {
  background: var(--surface);
  color: var(--text-muted);
}
.primary {
  background: var(--accent);
  color: var(--accent-contrast);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  border-radius: 8px;
}
.item-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px;
  border-radius: 8px;
}
.item-head[draggable='true'] {
  cursor: grab;
}
.item-head[draggable='true']:active {
  cursor: grabbing;
}
.item-head:hover {
  background: var(--surface);
}
.item-head.dragging {
  opacity: 0.5;
}
.swatch {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  border-radius: 3px;
}
.item-head input[type='checkbox'] {
  flex: 0 0 auto;
  accent-color: var(--accent);
}
.chev {
  flex: 0 0 auto;
  width: 14px;
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 10px;
  cursor: pointer;
  padding: 0;
}
.name {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  color: var(--text);
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
.params {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 6px 8px;
  padding: 6px 4px 10px 18px;
}
.params label {
  font-size: 11px;
  color: var(--text-muted);
}
.num,
.sel {
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 5px 7px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.num {
  width: 78px;
  justify-self: end;
}
.sel.sm {
  justify-self: end;
}
.hint,
.empty {
  font-size: 11px;
  color: var(--text-dim);
  margin: 0;
  padding: 2px 4px;
}
.empty {
  padding-left: 4px;
}
</style>
