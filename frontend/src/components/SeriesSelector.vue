<script setup>
import { colorFor } from '../palette.js'
import { theme } from '../theme.js'

defineProps({
  // [{ name: 'signal_a' }, ...]
  series: { type: Array, required: true },
  // Set of visible series indices
  visible: { type: Object, required: true },
})

const emit = defineEmits(['toggle', 'all', 'none'])
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
    <ul class="list">
      <li v-for="(s, i) in series" :key="i">
        <label>
          <input
            type="checkbox"
            :checked="visible.has(i)"
            @change="emit('toggle', i)"
          />
          <span class="swatch" :style="{ background: colorFor(theme, i) }"></span>
          <span class="name" :title="s.name">{{ s.name }}</span>
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
  transition: background 0.15s ease, color 0.15s ease;
}
.actions button:hover {
  background: var(--surface-hover);
  color: var(--text);
}
.list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}
.list li label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 6px;
  border-radius: 8px;
  cursor: pointer;
}
.list li label:hover {
  background: var(--surface);
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
}
</style>
