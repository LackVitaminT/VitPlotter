<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  // [{ name, savedAt, source }] — saved named dashboards.
  names: { type: Array, default: () => [] },
  // Whether a dashboard is currently loaded (enables Save / Save As / Export).
  hasData: { type: Boolean, default: false },
  // Transient status/error message shown at the bottom of the panel.
  status: { type: String, default: '' },
})

const emit = defineEmits(['open', 'save', 'save-as', 'load', 'delete', 'export', 'import'])

const open = ref(false)
const saveAsName = ref('')
const fileInput = ref(null)

function toggle() {
  open.value = !open.value
  if (open.value) emit('open') // let the parent refresh the saved list
}
function close() {
  open.value = false
  saveAsName.value = ''
}
function submitSaveAs() {
  const name = saveAsName.value.trim()
  if (!name) return
  emit('save-as', name)
  saveAsName.value = ''
}
function onImportPick(e) {
  const file = e.target.files?.[0]
  if (file) emit('import', file)
  e.target.value = '' // allow re-importing the same file
}

// Close on outside click (root has @click.stop) or Escape.
const onWindowClick = () => close()
const onKeydown = (e) => {
  if (e.key === 'Escape') close()
}
onMounted(() => {
  window.addEventListener('click', onWindowClick)
  window.addEventListener('keydown', onKeydown)
})
onBeforeUnmount(() => {
  window.removeEventListener('click', onWindowClick)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="dash-menu" @click.stop>
    <button class="icon-btn" title="Dashboards" @click="toggle">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    </button>

    <div v-if="open" class="panel" @click.stop>
      <div class="section">
        <button class="action primary" :disabled="!hasData" @click="emit('save')">
          Save dashboard
        </button>
        <div class="save-as">
          <input
            v-model="saveAsName"
            type="text"
            placeholder="Save as…"
            spellcheck="false"
            :disabled="!hasData"
            @keydown.enter.prevent="submitSaveAs"
          />
          <button class="action" :disabled="!hasData || !saveAsName.trim()" @click="submitSaveAs">
            Save
          </button>
        </div>
      </div>

      <div class="section list">
        <div class="head">Saved</div>
        <p v-if="!names.length" class="empty">No saved dashboards</p>
        <ul v-else>
          <li v-for="d in names" :key="d.name">
            <button class="name" :title="`Load “${d.name}”`" @click="emit('load', d.name)">
              <span class="dot" :class="d.source"></span>
              <span class="lbl">{{ d.name }}</span>
            </button>
            <button class="del" title="Delete" @click="emit('delete', d.name)">×</button>
          </li>
        </ul>
      </div>

      <div class="section row">
        <button class="action" :disabled="!hasData" @click="emit('export')">Export…</button>
        <button class="action" @click="fileInput?.click()">Import…</button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          hidden
          @change="onImportPick"
        />
      </div>

      <div v-if="status" class="status">{{ status }}</div>
    </div>
  </div>
</template>

<style scoped>
.dash-menu {
  position: relative;
  display: inline-flex;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease;
}
.icon-btn:hover {
  background: var(--surface);
  color: var(--text);
}
.icon-btn svg {
  width: 18px;
  height: 18px;
}
.panel {
  position: absolute;
  right: 0;
  top: 40px;
  z-index: 20;
  width: 260px;
  padding: 10px;
  background: var(--bg-elev);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow);
}
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section + .section {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.section.row {
  flex-direction: row;
}
.section.row .action {
  flex: 1;
}
.head {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
.action {
  height: 30px;
  padding: 0 10px;
  background: var(--bg-inset);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 7px;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}
.action:hover:not(:disabled) {
  border-color: var(--accent);
}
.action.primary {
  background: var(--accent);
  color: var(--accent-contrast);
  border-color: var(--accent);
}
.action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.save-as {
  display: flex;
  gap: 6px;
}
.save-as input {
  flex: 1;
  min-width: 0;
  background: var(--bg-inset);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 0 9px;
  height: 30px;
  font: inherit;
  font-size: 12px;
  outline: none;
}
.save-as input:focus {
  border-color: var(--accent);
}
.list ul {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 200px;
  overflow-y: auto;
}
.list li {
  display: flex;
  align-items: center;
  gap: 4px;
}
.list .name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 7px;
  background: transparent;
  border: none;
  color: var(--text);
  text-align: left;
  padding: 6px;
  border-radius: 6px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.list .name:hover {
  background: var(--surface);
}
.list .lbl {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dot {
  flex: 0 0 auto;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--text-dim);
}
.dot.csv {
  background: #40c057;
}
.dot.udp {
  background: var(--accent);
}
.del {
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  background: transparent;
  border: none;
  color: var(--text-dim);
  font-size: 16px;
  line-height: 1;
  border-radius: 6px;
  cursor: pointer;
}
.del:hover {
  background: var(--surface);
  color: var(--danger);
}
.empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.status {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  font-size: 11px;
  color: var(--text-dim);
}
</style>
