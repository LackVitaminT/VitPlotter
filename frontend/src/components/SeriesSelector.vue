<script setup>
import { computed, reactive, watchEffect } from 'vue'
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

// Split a series name into hierarchy segments. Both '.' and '/' are treated as separators
// (e.g. "imu.ax" and "vehicle/speed/x" both nest); empty segments (leading '/') are dropped.
function splitName(name) {
  const parts = String(name).split(/[./]+/).filter(Boolean)
  return parts.length ? parts : [String(name)]
}

// Build a tree from the series names. A node is a group when it has children, else a leaf.
const tree = computed(() => {
  const root = { children: new Map() }
  props.series.forEach((s, index) => {
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
  const walk = (node, depth) => {
    for (const child of node.children.values()) {
      if (child.children.size > 0) {
        const leafIndices = subtreeLeaves(child, [])
        out.push({ kind: 'group', path: child.path, label: child.label, depth, leafIndices })
        // A node that is both a value and a parent: show its own value as the first leaf.
        if (!collapsed.has(child.path)) {
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
    <div class="actions">
      <button @click="emit('all')">All</button>
      <button @click="emit('none')">None</button>
    </div>
    <ul class="tree">
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
          <span class="chevron">{{ collapsed.has(row.path) ? '▸' : '▾' }}</span>
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
