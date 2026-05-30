<script setup>
import { computed, onBeforeUnmount, ref } from 'vue'
import { formatTimestamp } from '../xaxis.js'

const props = defineProps({
  // Full buffer time range [start, end].
  extent: { type: Array, default: null },
  // Currently visible window [min, max].
  view: { type: Array, default: null },
  // Disabled only when there is no data; otherwise draggable in both live and paused modes.
  disabled: { type: Boolean, default: false },
  xFormat: { type: String, default: 'number' },
  xPrecision: { type: Number, default: 2 },
})
const emit = defineEmits(['update:view'])

const trackEl = ref(null)
let drag = null

const ready = computed(() => Array.isArray(props.extent) && props.extent[1] > props.extent[0])

function fracOf(v) {
  const [e0, e1] = props.extent
  return Math.min(1, Math.max(0, (v - e0) / (e1 - e0)))
}

// Window rectangle geometry as CSS percentages.
const windowStyle = computed(() => {
  if (!ready.value) return { left: '0%', width: '100%' }
  const v = props.view && props.view.length === 2 ? props.view : props.extent
  const left = fracOf(v[0]) * 100
  const right = fracOf(v[1]) * 100
  return { left: `${left}%`, width: `${Math.max(0.5, right - left)}%` }
})

const startLabel = computed(() => {
  const v = props.view || props.extent
  return v ? formatTimestamp(v[0], props.xFormat, props.xPrecision) : ''
})
const endLabel = computed(() => {
  const v = props.view || props.extent
  return v ? formatTimestamp(v[1], props.xFormat, props.xPrecision) : ''
})

function valAt(clientX) {
  const r = trackEl.value.getBoundingClientRect()
  const f = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
  const [e0, e1] = props.extent
  return e0 + f * (e1 - e0)
}

function onPointerDown(e) {
  if (props.disabled || !ready.value) return
  const view = props.view && props.view.length === 2 ? props.view : props.extent
  const width = view[1] - view[0]
  const val = valAt(e.clientX)
  // Grab inside the window to pan; clicking outside recenters the window on the click.
  const grab = val >= view[0] && val <= view[1] ? val - view[0] : width / 2
  drag = { grab, width }
  e.target.setPointerCapture?.(e.pointerId)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  onPointerMove(e)
}

function onPointerMove(e) {
  if (!drag) return
  const [e0, e1] = props.extent
  let v0 = valAt(e.clientX) - drag.grab
  v0 = Math.min(Math.max(v0, e0), e1 - drag.width)
  emit('update:view', [v0, v0 + drag.width])
}

function onPointerUp() {
  drag = null
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
}

onBeforeUnmount(onPointerUp)
</script>

<template>
  <div class="timebar" :class="{ disabled }">
    <div ref="trackEl" class="track" @pointerdown="onPointerDown">
      <div class="window" :style="windowStyle"></div>
    </div>
    <div class="labels">
      <span>{{ startLabel }}</span>
      <span>{{ endLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.timebar {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.track {
  position: relative;
  height: 22px;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 7px;
  cursor: pointer;
  overflow: hidden;
}
.window {
  position: absolute;
  top: 0;
  bottom: 0;
  background: color-mix(in srgb, var(--accent) 32%, transparent);
  border-left: 2px solid var(--accent);
  border-right: 2px solid var(--accent);
  box-sizing: border-box;
  cursor: grab;
}
.window:active {
  cursor: grabbing;
}
.timebar.disabled .track {
  cursor: default;
  opacity: 0.5;
}
.timebar.disabled .window {
  cursor: default;
}
.labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--text-dim);
  font-variant-numeric: tabular-nums;
}
</style>
