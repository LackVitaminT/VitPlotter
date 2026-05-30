<script setup>
import { onBeforeUnmount, onMounted } from 'vue'
import { CHANGELOG, changeStyle } from '../changelog.js'

defineProps({
  version: { type: String, default: 'dev' },
})
const emit = defineEmits(['close'])

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function badgeStyle(type) {
  const c = changeStyle(type).color
  return { color: c, borderColor: c }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal" role="dialog" aria-modal="true" aria-label="Changelog">
      <header class="head">
        <h2>Changelog</h2>
        <span class="ver-chip">v{{ version }}</span>
        <div class="spacer"></div>
        <button class="close" title="Close" @click="emit('close')">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="body">
        <ol class="timeline">
          <li v-for="rel in CHANGELOG" :key="rel.version" class="release">
            <div class="rail"><span class="dot"></span></div>
            <div class="content">
              <div class="rel-head">
                <span class="rel-ver">v{{ rel.version }}</span>
                <span class="rel-date">{{ rel.date }}</span>
              </div>
              <ul class="changes">
                <li v-for="(c, i) in rel.changes" :key="i" class="change">
                  <span class="badge" :style="badgeStyle(c.type)">{{
                    changeStyle(c.type).label
                  }}</span>
                  <span class="change-text">{{ c.text }}</span>
                </li>
              </ul>
            </div>
          </li>
        </ol>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 24px;
  background: color-mix(in srgb, var(--bg-inset) 70%, transparent);
  backdrop-filter: blur(3px);
}
.modal {
  display: flex;
  flex-direction: column;
  width: min(640px, 100%);
  max-height: min(80vh, 720px);
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 16px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px;
  border-bottom: 1px solid var(--border);
}
.head h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--text);
}
.spacer {
  flex: 1;
}
.ver-chip {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, transparent);
  border-radius: 999px;
  padding: 2px 10px;
}
.close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.close:hover {
  background: var(--surface);
  color: var(--text);
}
.close svg {
  width: 16px;
  height: 16px;
}
.body {
  overflow-y: auto;
  padding: 18px 22px 22px;
}
.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
}
.release {
  display: grid;
  grid-template-columns: 22px 1fr;
  gap: 12px;
}
.rail {
  position: relative;
  display: flex;
  justify-content: center;
}
.rail::before {
  content: '';
  position: absolute;
  top: 4px;
  bottom: -4px;
  width: 2px;
  background: var(--border);
}
.release:last-child .rail::before {
  display: none;
}
.dot {
  position: relative;
  z-index: 1;
  width: 11px;
  height: 11px;
  margin-top: 4px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent);
}
.content {
  padding-bottom: 22px;
}
.rel-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 10px;
}
.rel-ver {
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}
.rel-date {
  font-size: 12px;
  color: var(--text-dim);
}
.changes {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 9px;
}
.change {
  display: grid;
  grid-template-columns: 74px 1fr;
  gap: 10px;
  align-items: start;
}
.badge {
  justify-self: start;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  border: 1px solid;
  border-radius: 999px;
  padding: 2px 8px;
  background: color-mix(in srgb, currentColor 10%, transparent);
  line-height: 1.35;
}
.change-text {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-muted);
}
</style>
