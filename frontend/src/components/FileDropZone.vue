<script setup>
import { ref } from 'vue'

const emit = defineEmits(['file'])
defineProps({
  loading: { type: Boolean, default: false },
})

const isDragging = ref(false)
const inputEl = ref(null)

function pick(fileList) {
  if (fileList && fileList.length > 0) {
    emit('file', fileList[0])
  }
}

function onDrop(e) {
  isDragging.value = false
  pick(e.dataTransfer.files)
}

function onChange(e) {
  pick(e.target.files)
  e.target.value = '' // allow re-selecting the same file
}
</script>

<template>
  <div
    class="dropzone"
    :class="{ dragging: isDragging, loading }"
    @click="inputEl?.click()"
    @dragover.prevent="isDragging = true"
    @dragenter.prevent="isDragging = true"
    @dragleave.prevent="isDragging = false"
    @drop.prevent="onDrop"
  >
    <input ref="inputEl" type="file" accept=".csv,text/csv" hidden @change="onChange" />
    <svg
      class="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M3 15l4-4 4 3 5-6 5 5" />
      <path d="M3 20h18" />
    </svg>
    <p v-if="loading" class="title">Parsing…</p>
    <template v-else>
      <p class="title">Drop a CSV file here</p>
      <p class="hint">or click to browse — the first column becomes the X axis</p>
    </template>
  </div>
</template>

<style scoped>
.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border: 1px dashed var(--text-dim);
  border-radius: 16px;
  background: var(--bg-elev);
  padding: 56px 32px;
  text-align: center;
  cursor: pointer;
  transition:
    border-color 0.18s ease,
    background 0.18s ease,
    transform 0.18s ease;
  user-select: none;
}
.dropzone:hover {
  border-color: var(--accent);
}
.dropzone.dragging {
  border-color: var(--accent);
  background: var(--surface);
  transform: scale(1.01);
}
.dropzone.loading {
  cursor: progress;
  opacity: 0.7;
}
.icon {
  width: 40px;
  height: 40px;
  color: var(--accent);
  margin-bottom: 6px;
}
.title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}
.hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 13px;
}
</style>
