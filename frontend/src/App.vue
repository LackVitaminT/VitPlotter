<script setup>
import { ref } from 'vue'
import FileDropZone from './components/FileDropZone.vue'
import SeriesSelector from './components/SeriesSelector.vue'
import PlotChart from './components/PlotChart.vue'
import { uploadCsv } from './api.js'
import { theme, toggleTheme } from './theme.js'

// Update this to your repository URL.
const GITHUB_URL = 'https://github.com/LackVitaminT/VitPlotter'

const parsed = ref(null)
const visible = ref(new Set()) // visible series indices; replaced on change for reactivity
const loading = ref(false)
const error = ref('')

async function handleFile(file) {
  loading.value = true
  error.value = ''
  try {
    const data = await uploadCsv(file)
    parsed.value = data
    visible.value = new Set(data.series.map((_, i) => i)) // show all by default
  } catch (e) {
    error.value = e.message || 'Failed to parse file'
    parsed.value = null
  } finally {
    loading.value = false
  }
}

function toggle(i) {
  const next = new Set(visible.value)
  if (next.has(i)) next.delete(i)
  else next.add(i)
  visible.value = next
}

function selectAll() {
  visible.value = new Set(parsed.value.series.map((_, i) => i))
}

function selectNone() {
  visible.value = new Set()
}

function reset() {
  parsed.value = null
  visible.value = new Set()
  error.value = ''
}
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <div class="brand" @click="reset">
        <span class="dot"></span>
        <span class="name">VitPlotter</span>
      </div>

      <div class="spacer"></div>

      <span v-if="parsed" class="meta">
        {{ parsed.filename }} · {{ parsed.rows }} rows · {{ parsed.series.length }} series
      </span>

      <button class="icon-btn" :title="theme === 'dark' ? 'Light mode' : 'Dark mode'" @click="toggleTheme">
        <!-- sun (shown in dark mode) / moon (shown in light mode) -->
        <svg v-if="theme === 'dark'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5L19 19M19 5l-1.5 1.5M6.5 17.5L5 19" />
        </svg>
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      </button>

      <a class="icon-btn" :href="GITHUB_URL" target="_blank" rel="noopener" title="View on GitHub">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 1.5a10.5 10.5 0 0 0-3.32 20.47c.52.1.71-.23.71-.5v-1.76c-2.89.63-3.5-1.39-3.5-1.39-.47-1.2-1.16-1.52-1.16-1.52-.95-.65.07-.64.07-.64 1.05.08 1.6 1.08 1.6 1.08.93 1.6 2.44 1.14 3.04.87.09-.68.36-1.14.66-1.4-2.31-.26-4.74-1.16-4.74-5.14 0-1.13.4-2.06 1.07-2.79-.11-.26-.46-1.31.1-2.73 0 0 .87-.28 2.85 1.07a9.9 9.9 0 0 1 5.2 0c1.98-1.35 2.85-1.07 2.85-1.07.56 1.42.21 2.47.1 2.73.67.73 1.07 1.66 1.07 2.79 0 3.99-2.43 4.87-4.75 5.13.37.32.7.95.7 1.92v2.85c0 .27.19.61.72.5A10.5 10.5 0 0 0 12 1.5z" />
        </svg>
      </a>
    </header>

    <!-- Empty state: centered dropzone -->
    <main v-if="!parsed" class="welcome">
      <div class="welcome-box">
        <h1 class="hero">Plot your CSV data.</h1>
        <p class="sub">A minimal, web-based plotting tool inspired by PlotJuggler.</p>
        <FileDropZone :loading="loading" @file="handleFile" />
        <p v-if="error" class="error">{{ error }}</p>
      </div>
    </main>

    <!-- Loaded: series sidebar + chart -->
    <main v-else class="workspace">
      <aside class="sidebar">
        <SeriesSelector
          :series="parsed.series"
          :visible="visible"
          @toggle="toggle"
          @all="selectAll"
          @none="selectNone"
        />
      </aside>
      <section class="chart-area">
        <PlotChart :parsed="parsed" :visible="visible" />
      </section>
    </main>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 18px;
  background: var(--bg-elev);
  border-bottom: 1px solid var(--border);
}
.brand {
  display: flex;
  align-items: center;
  gap: 9px;
  cursor: pointer;
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--accent);
}
.name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.01em;
}
.spacer {
  flex: 1;
}
.meta {
  font-size: 12px;
  color: var(--text-dim);
  margin-right: 4px;
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
  transition: background 0.15s ease, color 0.15s ease;
}
.icon-btn:hover {
  background: var(--surface);
  color: var(--text);
}
.icon-btn svg {
  width: 18px;
  height: 18px;
}

.welcome {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.welcome-box {
  width: 100%;
  max-width: 560px;
  text-align: center;
}
.hero {
  margin: 0 0 8px;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.sub {
  margin: 0 0 28px;
  color: var(--text-muted);
  font-size: 15px;
}
.error {
  margin-top: 16px;
  color: var(--danger);
}

.workspace {
  flex: 1;
  display: flex;
  min-height: 0;
}
.sidebar {
  width: 248px;
  flex: 0 0 248px;
  padding: 18px 16px;
  background: var(--bg-elev);
  border-right: 1px solid var(--border);
  overflow: hidden;
}
.chart-area {
  flex: 1;
  min-width: 0;
  padding: 20px;
}
</style>
