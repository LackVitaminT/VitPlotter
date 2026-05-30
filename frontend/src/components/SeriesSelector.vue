<script setup>
import { computed, reactive, ref, watchEffect } from 'vue'
import { colorFor } from '../palette.js'
import { theme } from '../theme.js'
import { setDragData } from '../dnd.js'

const props = defineProps({
  // Stable list: [{ name: 'imu.ax' }, ...]; index = series/column index.
  series: { type: Array, required: true },
  // Set of visible series indices.
  visible: { type: Object, required: true },
})

const emit = defineEmits(['toggle', 'toggleGroup', 'all', 'none'])

// Local directive: bind the checkbox's `indeterminate` DOM property.
const vIndeterminate = {
  mounted: (el, b) => (el.indeterminate = b.value),
  updated: (el, b) => (el.indeterminate = b.value),
}

const collapsed = reactive(new Set()) // group paths that are collapsed
const query = ref('') // fuzzy search filter

// Subsequence fuzzy match: every char of the query appears in order in the text (case-insensitive).
function fuzzyMatch(q, text) {
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

// Indices of series matching the current query (null = no filter, show everything).
const matched = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return null
  const set = new Set()
  props.series.forEach((s, i) => {
    if (fuzzyMatch(q, String(s.name))) set.add(i)
  })
  return set
})
const searching = computed(() => matched.value != null)

// What All / None act on: the search matches while filtering, otherwise every series.
const shownIndices = computed(() =>
  matched.value ? [...matched.value] : props.series.map((_, i) => i),
)

// Split a series name into hierarchy segments. Both '.' and '/' are treated as separators
// (e.g. "imu.ax" and "vehicle/speed/x" both nest); empty segments (leading '/') are dropped.
function splitName(name) {
  const parts = String(name).split(/[./]+/).filter(Boolean)
  return parts.length ? parts : [String(name)]
}

// Build a tree from the series names. A node is a group when it has children, else a leaf.
// While searching, only matching series are inserted, so the tree narrows to the results.
const tree = computed(() => {
  const root = { children: new Map() }
  props.series.forEach((s, index) => {
    if (matched.value && !matched.value.has(index)) return
    const parts = splitName(s.name)
    let node = root
    let path = ''
    parts.forEach((seg, depth) => {
      path = path ? `${path}/${seg}` : seg
      if (!node.children.has(seg)) {
        node.children.set(seg, { label: seg, path, children: new Map(), leafIndex: null })
      }
      node = node.children.get(seg)
      if (depth === parts.length - 1) node.leafIndex = index
    })
  })
  return root
})

// Collapse groups by default: when a group path is first seen, add it to `collapsed`.
// `known` ensures user expand/collapse choices persist and only NEW groups start collapsed.
const known = new Set()
function collectGroups(node, acc) {
  for (const child of node.children.values()) {
    if (child.children.size > 0) {
      acc.push(child.path)
      collectGroups(child, acc)
    }
  }
  return acc
}
watchEffect(() => {
  for (const path of collectGroups(tree.value, [])) {
    if (!known.has(path)) {
      known.add(path)
      collapsed.add(path)
    }
  }
})

function subtreeLeaves(node, acc) {
  if (node.leafIndex != null && node.children.size === 0) acc.push(node.leafIndex)
  else {
    if (node.leafIndex != null) acc.push(node.leafIndex)
    for (const child of node.children.values()) subtreeLeaves(child, acc)
  }
  return acc
}

// Flatten the tree into ordered rows, honoring the collapsed set.
const rows = computed(() => {
  const out = []
  const expand = searching.value // force every group open while filtering
  const walk = (node, depth) => {
    for (const child of node.children.values()) {
      if (child.children.size > 0) {
        const leafIndices = subtreeLeaves(child, [])
        const open = expand || !collapsed.has(child.path)
        out.push({ kind: 'group', path: child.path, label: child.label, depth, leafIndices, open })
        // A node that is both a value and a parent: show its own value as the first leaf.
        if (open) {
          if (child.leafIndex != null) {
            out.push({
              kind: 'leaf',
              path: child.path,
              label: child.label,
              depth: depth + 1,
              index: child.leafIndex,
            })
          }
          walk(child, depth + 1)
        }
      } else {
        out.push({
          kind: 'leaf',
          path: child.path,
          label: child.label,
          depth,
          index: child.leafIndex,
        })
      }
    }
  }
  walk(tree.value, 0)
  return out
})

function groupState(leafIndices) {
  let on = 0
  for (const i of leafIndices) if (props.visible.has(i)) on++
  if (on === 0) return 'none'
  return on === leafIndices.length ? 'all' : 'some'
}

function onGroupCheckbox(row) {
  const value = groupState(row.leafIndices) !== 'all' // not all → turn all on, else turn off
  emit('toggleGroup', { indices: row.leafIndices, value })
}

function toggleCollapse(path) {
  if (collapsed.has(path)) collapsed.delete(path)
  else collapsed.add(path)
}

function onDragStart(e, indices, label) {
  setDragData(e, indices, label)
  e.currentTarget.classList.add('dragging')
}
function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging')
}
</script>

<template>
  <div class="selector">
    <div class="head">
      <span class="label">Series</span>
      <span class="count">{{ visible.size }}/{{ series.length }}</span>
    </div>
    <div class="search">
      <svg
        class="search-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" stroke-linecap="round" />
      </svg>
      <input v-model="query" class="search-input" type="text" placeholder="Search series…" />
      <button v-if="query" class="search-clear" title="Clear" @click="query = ''">×</button>
    </div>
    <div class="actions">
      <button
        :title="searching ? 'Select all matching series' : 'Select all series'"
        @click="emit('all', shownIndices)"
      >
        All
      </button>
      <button
        :title="searching ? 'Clear matching series' : 'Clear all series'"
        @click="emit('none', shownIndices)"
      >
        None
      </button>
    </div>
    <ul class="tree">
      <li v-if="searching && !rows.length" class="no-results">No matching series</li>
      <li v-for="row in rows" :key="row.kind + ':' + row.path">
        <!-- Group row -->
        <div
          v-if="row.kind === 'group'"
          class="row group"
          :style="{ paddingLeft: row.depth * 14 + 4 + 'px' }"
          draggable="true"
          @click="toggleCollapse(row.path)"
          @dragstart="onDragStart($event, row.leafIndices, row.label)"
          @dragend="onDragEnd"
        >
          <span class="chevron">{{ row.open ? '▾' : '▸' }}</span>
          <input
            type="checkbox"
            :checked="groupState(row.leafIndices) === 'all'"
            v-indeterminate="groupState(row.leafIndices) === 'some'"
            @click.stop
            @change="onGroupCheckbox(row)"
          />
          <span class="name group-name" :title="row.path">{{ row.label }}</span>
        </div>

        <!-- Leaf row -->
        <label
          v-else
          class="row leaf"
          :style="{ paddingLeft: row.depth * 14 + 4 + 'px' }"
          draggable="true"
          @dragstart="onDragStart($event, [row.index], row.label)"
          @dragend="onDragEnd"
        >
          <input
            type="checkbox"
            :checked="visible.has(row.index)"
            @change="emit('toggle', row.index)"
          />
          <span class="swatch" :style="{ background: colorFor(theme, row.index) }"></span>
          <span class="name" :title="row.path">{{ row.label }}</span>
        </label>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.selector {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.label {
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
.search {
  position: relative;
  display: flex;
  align-items: center;
  margin-top: 10px;
}
.search-icon {
  position: absolute;
  left: 9px;
  width: 13px;
  height: 13px;
  color: var(--text-dim);
  pointer-events: none;
}
.search-input {
  flex: 1;
  min-width: 0;
  background: var(--bg-inset);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 26px 6px 28px;
  font-size: 12px;
  font-family: inherit;
  outline: none;
}
.search-input:focus {
  border-color: var(--accent);
}
.search-input::placeholder {
  color: var(--text-dim);
}
.search-clear {
  position: absolute;
  right: 6px;
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
  border-radius: 5px;
}
.search-clear:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.no-results {
  padding: 8px 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.actions {
  display: flex;
  gap: 6px;
  margin: 10px 0;
}
.actions button {
  flex: 1;
  background: var(--surface);
  color: var(--text-muted);
  border: none;
  border-radius: 8px;
  padding: 5px 0;
  cursor: pointer;
  font-size: 12px;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.actions button:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 6px;
  padding-bottom: 6px;
  padding-right: 6px;
  border-radius: 8px;
  cursor: pointer;
}
.row:hover {
  background: var(--surface);
}
.row.dragging {
  opacity: 0.5;
}
.chevron {
  width: 12px;
  flex: 0 0 auto;
  color: var(--text-dim);
  font-size: 10px;
  text-align: center;
}
.group-name {
  font-weight: 600;
  color: var(--text-muted);
}
.swatch {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  flex: 0 0 auto;
}
.name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
input[type='checkbox'] {
  accent-color: var(--accent);
  flex: 0 0 auto;
}
</style>
