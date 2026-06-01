<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import PlotChart from './PlotChart.vue'
import { getDragData, hasDragData } from '../dnd.js'
import { cloneLayout, compact, moveElement, bottom } from '../grid-engine.js'

const props = defineProps({
  subplots: { type: Array, required: true }, // [{ id, layout, visible:Set }]
  focusedId: { type: String, default: null },
  maximizedId: { type: String, default: null },
  colNum: { type: Number, default: 12 },
  // Shared chart props applied to every subplot. Axis settings (Y mode/range, X format/resolution)
  // are NOT here — they live per-subplot on `sp.axes`.
  parsed: { type: Object, required: true },
  live: { type: Boolean, default: false },
  gaps: { type: Array, default: null },
  displayPoints: { type: Number, default: 0 },
  // Per-series color overrides (name -> hex), shared by every subplot.
  colors: { type: Object, default: () => ({}) },
})

const emit = defineEmits([
  'focus',
  'close',
  'clear-series',
  'toggle-maximize',
  'series-drop',
  'layout-updated',
  'view-change',
])

const MARGIN = 8 // px gutter between cells (and around the grid)
const MIN_W = 2 // smallest subplot width, in grid columns
const MIN_H = 2 // smallest subplot height, in grid rows

const cols = computed(() => props.colNum)
const isMaximized = computed(() => props.maximizedId != null)
// Drag/resize are disabled while a subplot is maximized.
const interactive = computed(() => !isMaximized.value)

// Collect child PlotChart instances by subplot id so the focused one can be driven by the time bar.
const chartRefs = new Map()
function setChartRef(id, el) {
  if (el) chartRefs.set(id, el)
  else chartRefs.delete(id)
}

// Per-subplot playback + window state, reported by each PlotChart. `followingById` drives the
// header play/pause icon (reactive, rendered). `windowById` is only read on focus change to point
// the bottom bar at the focused plot — kept plain so live-follow frames don't churn reactivity.
const followingById = ref({})
const windowById = {} // id -> [min, max]

function onChildFollow(id, isFollowing) {
  followingById.value = { ...followingById.value, [id]: isFollowing }
}
function onChildView(id, range) {
  windowById[id] = range
  if (id === props.focusedId) emit('view-change', range) // focus-bound bottom bar follows
}
// Focusing a different plot should jump the bottom bar to its window.
watch(
  () => props.focusedId,
  (id) => {
    if (windowById[id]) emit('view-change', windowById[id])
  },
)

function togglePlay(id) {
  const chart = chartRefs.get(id)
  if (!chart) return
  if (followingById.value[id]) chart.pause()
  else chart.play()
}

// Time-bar scrub / reset act on the FOCUSED subplot only (per-subplot time axis).
function setFocusedXView(min, max) {
  chartRefs.get(props.focusedId)?.setXView?.(min, max)
}
function resetFocusedView() {
  chartRefs.get(props.focusedId)?.resetView?.()
}
defineExpose({ setFocusedXView, resetFocusedView })

// --- layout state ---------------------------------------------------------- //
// `layout` is the committed grid (engine items {i,x,y,w,h}). It is OUR source of truth while a
// gesture is in flight; otherwise it mirrors the parent model. Syncing one-way from the model
// (never feeding a freshly-built array back into a layout library mid-drag) is exactly what avoids
// the stuck-placeholder bug the old grid-layout-plus integration had.
const layout = ref([])

// Live gesture state. `gesture` = the active interaction; `preview` = the engine's resolved layout
// during the gesture; `ghost` = the snap target highlight; `activePx` = the dragged item's raw pixel
// box (so it tracks the pointer fluidly while neighbours animate into place).
// NOTE: these must be declared BEFORE the `immediate` watch below, which reads `gesture` during
// setup (a forward `const` reference would throw in the temporal dead zone).
const gesture = ref(null) // null | { id, kind:'move'|'resize', edges, cursor }
const preview = ref(null) // null | engine layout array
const ghost = ref(null) // null | { x, y, w, h }
const activePx = ref(null) // null | { left, top, width, height }
let start = null // non-reactive snapshot taken at pointerdown

const displayLayout = computed(() => preview.value || layout.value)
const geomById = computed(() => {
  const m = new Map()
  for (const l of displayLayout.value) m.set(l.i, l)
  return m
})

watch(
  () =>
    props.subplots
      .map((s) => `${s.id}:${s.layout.x},${s.layout.y},${s.layout.w},${s.layout.h}`)
      .join('|'),
  () => {
    // Don't clobber an in-flight gesture (the parent can't change mid-drag, but be defensive).
    if (gesture.value) return
    layout.value = props.subplots.map((s) => ({
      i: s.id,
      x: s.layout.x,
      y: s.layout.y,
      w: s.layout.w,
      h: s.layout.h,
    }))
    nextTick(recomputeRowHeight)
  },
  { immediate: true },
)

// --- geometry: track container size, derive column width + row height ------- //
const gridEl = ref(null)
const hostW = ref(0)
const hostH = ref(0)
const rowHeight = ref(40)
let ro = null

const colWidth = computed(() => {
  const w = hostW.value
  if (!w) return 0
  return Math.max(1, (w - (cols.value + 1) * MARGIN) / cols.value)
})

function xToPx(x) {
  return MARGIN + x * (colWidth.value + MARGIN)
}
function yToPx(y) {
  return MARGIN + y * (rowHeight.value + MARGIN)
}
function wToPx(w) {
  return Math.max(0, w * colWidth.value + (w - 1) * MARGIN)
}
function hToPx(h) {
  return Math.max(0, h * rowHeight.value + (h - 1) * MARGIN)
}

function occupiedRows() {
  return Math.max(1, bottom(layout.value))
}
function recomputeRowHeight() {
  const host = gridEl.value
  if (!host) return
  hostW.value = host.clientWidth
  hostH.value = host.clientHeight
  const rows = occupiedRows()
  const h = host.clientHeight
  if (!h || !rows) return
  // Total height = rows*rowHeight + (rows+1)*margin  ⇒  solve for rowHeight (fills the container).
  const rh = Math.max(24, Math.floor((h - (rows + 1) * MARGIN) / rows))
  if (rh !== rowHeight.value) rowHeight.value = rh
}

const contentHeight = computed(() => {
  const px = bottom(displayLayout.value) * (rowHeight.value + MARGIN) + MARGIN
  return Math.max(hostH.value, px) + 'px'
})

onMounted(() => {
  recomputeRowHeight()
  ro = new ResizeObserver(() => recomputeRowHeight())
  if (gridEl.value) ro.observe(gridEl.value)
})
onBeforeUnmount(() => {
  ro?.disconnect()
  removeWindowListeners()
})

// Entering/leaving maximized changes each chart's box → recompute height and nudge a resize.
watch(isMaximized, () => {
  nextTick(() => {
    recomputeRowHeight()
    requestAnimationFrame(() => {
      for (const c of chartRefs.values()) c?.refresh?.()
    })
  })
})

// --- positioning styles ---------------------------------------------------- //
function itemStyle(id) {
  if (id === props.maximizedId) return {} // the .maximized class drives full-bleed via !important
  if (gesture.value?.id === id && activePx.value) {
    const p = activePx.value
    return {
      left: `${p.left}px`,
      top: `${p.top}px`,
      width: `${p.width}px`,
      height: `${p.height}px`,
    }
  }
  const g = geomById.value.get(id)
  if (!g) return { display: 'none' }
  return {
    left: `${xToPx(g.x)}px`,
    top: `${yToPx(g.y)}px`,
    width: `${wToPx(g.w)}px`,
    height: `${hToPx(g.h)}px`,
  }
}
const ghostStyle = computed(() => {
  const g = ghost.value
  if (!g) return {}
  return {
    left: `${xToPx(g.x)}px`,
    top: `${yToPx(g.y)}px`,
    width: `${wToPx(g.w)}px`,
    height: `${hToPx(g.h)}px`,
  }
})

// --- gestures: drag-to-move and 8-way resize ------------------------------- //
const HANDLES = [
  { k: 'n', edges: { top: true }, cursor: 'ns-resize' },
  { k: 's', edges: { bottom: true }, cursor: 'ns-resize' },
  { k: 'e', edges: { right: true }, cursor: 'ew-resize' },
  { k: 'w', edges: { left: true }, cursor: 'ew-resize' },
  { k: 'ne', edges: { top: true, right: true }, cursor: 'nesw-resize' },
  { k: 'nw', edges: { top: true, left: true }, cursor: 'nwse-resize' },
  { k: 'se', edges: { bottom: true, right: true }, cursor: 'nwse-resize' },
  { k: 'sw', edges: { bottom: true, left: true }, cursor: 'nesw-resize' },
]

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function beginGesture(e, id, kind, edges, cursor) {
  if (!interactive.value || e.button !== 0) return
  const g = geomById.value.get(id)
  if (!g) return
  emit('focus', id)
  start = {
    id,
    pointerX: e.clientX,
    pointerY: e.clientY,
    geom: { x: g.x, y: g.y, w: g.w, h: g.h },
    px: { left: xToPx(g.x), top: yToPx(g.y), width: wToPx(g.w), height: hToPx(g.h) },
  }
  gesture.value = { id, kind, edges }
  preview.value = cloneLayout(layout.value)
  ghost.value = { ...start.geom }
  activePx.value = { ...start.px }
  document.body.style.userSelect = 'none'
  document.body.style.cursor = cursor || 'grabbing'
  addWindowListeners()
  e.preventDefault()
}

function startMove(e, id) {
  if (e.target.closest('.frame-btn')) return // let header buttons act normally
  beginGesture(e, id, 'move', null, 'grabbing')
}
function startResize(e, id, h) {
  beginGesture(e, id, 'resize', h.edges, h.cursor)
}

function onPointerMove(e) {
  if (!gesture.value) return
  if (gesture.value.kind === 'move') doMove(e)
  else doResize(e)
}

function doMove(e) {
  const stepX = colWidth.value + MARGIN
  const stepY = rowHeight.value + MARGIN
  const left = start.px.left + (e.clientX - start.pointerX)
  const top = Math.max(MARGIN, start.px.top + (e.clientY - start.pointerY))
  activePx.value = { left, top, width: start.px.width, height: start.px.height }

  const tx = clamp(Math.round((left - MARGIN) / stepX), 0, cols.value - start.geom.w)
  const ty = Math.max(0, Math.round((top - MARGIN) / stepY))

  const work = cloneLayout(layout.value)
  const item = work.find((l) => l.i === gesture.value.id)
  moveElement(work, item, tx, ty, true, cols.value)
  const next = compact(work, cols.value)
  preview.value = next
  const landed = next.find((l) => l.i === gesture.value.id)
  ghost.value = { x: landed.x, y: landed.y, w: landed.w, h: landed.h }
}

function doResize(e) {
  const ed = gesture.value.edges
  const sp = start.px
  const sg = start.geom
  const dx = e.clientX - start.pointerX
  const dy = e.clientY - start.pointerY

  let left = sp.left
  let top = sp.top
  let width = sp.width
  let height = sp.height
  if (ed.right) width = sp.width + dx
  if (ed.left) {
    left = sp.left + dx
    width = sp.width - dx
  }
  if (ed.bottom) height = sp.height + dy
  if (ed.top) {
    top = sp.top + dy
    height = sp.height - dy
  }

  // Clamp the raw pixel box so it never inverts below the minimum size.
  const minWpx = wToPx(MIN_W)
  const minHpx = hToPx(MIN_H)
  if (width < minWpx) {
    if (ed.left) left = sp.left + sp.width - minWpx
    width = minWpx
  }
  if (height < minHpx) {
    if (ed.top) top = sp.top + sp.height - minHpx
    height = minHpx
  }
  activePx.value = { left, top, width, height }

  // Snap to grid units, anchoring the opposite edge for top/left handles.
  const stepX = colWidth.value + MARGIN
  const stepY = rowHeight.value + MARGIN
  let nx = sg.x
  let ny = sg.y
  let nw = sg.w
  let nh = sg.h
  if (ed.right) nw = clamp(Math.round((width + MARGIN) / stepX), MIN_W, cols.value - sg.x)
  if (ed.bottom) nh = Math.max(MIN_H, Math.round((height + MARGIN) / stepY))
  if (ed.left) {
    const rightEdge = sg.x + sg.w
    nx = clamp(Math.round((left - MARGIN) / stepX), 0, rightEdge - MIN_W)
    nw = rightEdge - nx
  }
  if (ed.top) {
    const bottomEdge = sg.y + sg.h
    ny = clamp(Math.round((top - MARGIN) / stepY), 0, bottomEdge - MIN_H)
    nh = bottomEdge - ny
  }

  const work = cloneLayout(layout.value)
  const item = work.find((l) => l.i === gesture.value.id)
  item.x = nx
  item.y = ny
  item.w = nw
  item.h = nh
  // Pin the resized item so all four edges stay where the user pulled them; neighbours reflow.
  const next = compact(work, cols.value, gesture.value.id)
  preview.value = next
  const landed = next.find((l) => l.i === gesture.value.id)
  ghost.value = { x: landed.x, y: landed.y, w: landed.w, h: landed.h }
}

function commitGesture() {
  if (!gesture.value) return
  const next = preview.value || cloneLayout(layout.value)
  layout.value = next.map((l) => ({ i: l.i, x: l.x, y: l.y, w: l.w, h: l.h }))
  emit(
    'layout-updated',
    layout.value.map((l) => ({ ...l })),
  )
  clearGesture()
  nextTick(recomputeRowHeight)
}
function cancelGesture() {
  clearGesture() // drop the preview; committed `layout` is untouched
}
function clearGesture() {
  gesture.value = null
  preview.value = null
  ghost.value = null
  activePx.value = null
  start = null
  document.body.style.userSelect = ''
  document.body.style.cursor = ''
  removeWindowListeners()
}

function addWindowListeners() {
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', commitGesture)
  window.addEventListener('pointercancel', cancelGesture)
}
function removeWindowListeners() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', commitGesture)
  window.removeEventListener('pointercancel', cancelGesture)
}

// --- per-frame drag-to-plot drop target (native HTML5 DnD; separate from pointer gestures) --- //
const dragOverId = ref(null)
function onFrameDragOver(e, id) {
  if (!hasDragData(e)) return
  e.preventDefault()
  e.dataTransfer.dropEffect = 'copy'
  dragOverId.value = id
}
function onFrameDragLeave(e, id) {
  if (!e.currentTarget.contains(e.relatedTarget) && dragOverId.value === id) dragOverId.value = null
}
function onFrameDrop(e, id) {
  e.preventDefault()
  dragOverId.value = null
  const indices = getDragData(e)
  if (indices && indices.length) emit('series-drop', { id, indices })
}
</script>

<template>
  <!-- The grid host is always mounted (never v-if'd) so uPlot instances survive maximize, which is
       a pure CSS overlay state — avoids the rebuild freeze. -->
  <div ref="gridEl" class="grid-host" :class="{ 'is-maximized': isMaximized }">
    <div class="grid" :style="{ height: contentHeight }">
      <!-- Fully-owned snap placeholder: a plain v-if element we mount only during a gesture and
           always tear down on pointerup. It can never get stuck and sits cleanly behind frames. -->
      <div v-if="ghost" class="ghost" :style="ghostStyle"></div>

      <div
        v-for="sp in subplots"
        :key="sp.id"
        class="item"
        :class="{
          maximized: sp.id === maximizedId,
          hidden: isMaximized && sp.id !== maximizedId,
          active: gesture && gesture.id === sp.id,
        }"
        :style="itemStyle(sp.id)"
      >
        <div
          class="frame"
          :class="{ focused: sp.id === focusedId }"
          @mousedown="emit('focus', sp.id)"
        >
          <div
            class="frame-head"
            @pointerdown="startMove($event, sp.id)"
            @dblclick="emit('toggle-maximize', sp.id)"
          >
            <span class="grip" aria-hidden="true">⋮⋮</span>
            <span class="frame-title">Plot</span>
            <button
              v-if="live"
              class="frame-btn play-btn"
              :class="{ frozen: !followingById[sp.id] }"
              :title="
                followingById[sp.id] ? 'Freeze this plot (others keep streaming)' : 'Resume live'
              "
              @pointerdown.stop
              @click.stop="togglePlay(sp.id)"
            >
              <svg
                v-if="followingById[sp.id]"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
            <button
              class="frame-btn"
              :title="sp.id === maximizedId ? 'Restore' : 'Maximize'"
              @pointerdown.stop
              @click.stop="emit('toggle-maximize', sp.id)"
            >
              <svg
                v-if="sp.id === maximizedId"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path d="M9 9h6v6M15 9l-6 6" />
              </svg>
              <svg
                v-else
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
              >
                <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
              </svg>
            </button>
            <button
              class="frame-btn"
              title="Clear all series from this plot"
              :disabled="!sp.visible.size"
              @pointerdown.stop
              @click.stop="emit('clear-series', sp.id)"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 21h18" />
                <path d="M8 21l-4.5-4.5 9-9 4.5 4.5-9 9z" />
                <path d="M12.5 7.5l4 4" />
              </svg>
            </button>
            <button
              class="frame-btn"
              title="Close"
              @pointerdown.stop
              @click.stop="emit('close', sp.id)"
            >
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
          </div>
          <div
            class="frame-body"
            :class="{ 'drag-over': dragOverId === sp.id }"
            @dragover="onFrameDragOver($event, sp.id)"
            @dragenter="onFrameDragOver($event, sp.id)"
            @dragleave="onFrameDragLeave($event, sp.id)"
            @drop="onFrameDrop($event, sp.id)"
          >
            <PlotChart
              :ref="(el) => setChartRef(sp.id, el)"
              :parsed="parsed"
              :visible="sp.visible"
              :live="live"
              :yMode="sp.axes.yMode"
              :yMin="sp.axes.yMin"
              :yMax="sp.axes.yMax"
              :xFormat="sp.axes.xFormat"
              :xPrecision="sp.axes.xPrecision"
              :gaps="gaps"
              :displayPoints="displayPoints"
              :colors="colors"
              @view-change="onChildView(sp.id, $event)"
              @follow-change="onChildFollow(sp.id, $event)"
            />
            <div v-if="!sp.visible.size" class="empty-hint">
              Drag or check a series to plot here
            </div>
            <div v-if="dragOverId === sp.id" class="drop-hint">Drop to plot</div>
          </div>
        </div>

        <!-- Resize handles: 4 edges + 4 corners, hidden while maximized. -->
        <template v-if="interactive && sp.id !== maximizedId">
          <div
            v-for="h in HANDLES"
            :key="h.k"
            class="rz"
            :class="'rz-' + h.k"
            @pointerdown.stop="startResize($event, sp.id, h)"
          ></div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid-host {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: auto;
}
.grid-host.is-maximized {
  overflow: hidden;
}
.grid {
  position: relative;
  width: 100%;
  min-height: 100%;
}

/* Snap placeholder — behind every frame (z-index 1). */
.ghost {
  position: absolute;
  z-index: 1;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1.5px dashed color-mix(in srgb, var(--accent) 55%, transparent);
  transition:
    left 0.12s ease,
    top 0.12s ease,
    width 0.12s ease,
    height 0.12s ease;
  pointer-events: none;
}

/* Positioned subplot box. Non-active items animate to their new slot; the active one tracks the
   pointer with transitions off (see .item.active). Frames sit above the ghost (z-index 2). */
.item {
  position: absolute;
  z-index: 2;
  transition:
    left 0.18s ease,
    top 0.18s ease,
    width 0.18s ease,
    height 0.18s ease;
}
.item.active {
  z-index: 6;
  transition: none;
}
.item.maximized {
  position: absolute !important;
  inset: 0 !important;
  left: 0 !important;
  top: 0 !important;
  width: 100% !important;
  height: 100% !important;
  z-index: 5;
  transition: none;
}
.item.hidden {
  visibility: hidden;
  pointer-events: none;
}

.frame {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 10px;
  overflow: hidden;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;
}
.frame.focused {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.frame-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  cursor: grab;
  user-select: none;
  touch-action: none;
}
.item.active .frame-head {
  cursor: grabbing;
}
.grip {
  color: var(--text-dim);
  font-size: 11px;
  line-height: 1;
  letter-spacing: -2px;
}
.frame-title {
  flex: 1;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}
.frame-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}
.frame-btn:hover:not(:disabled) {
  background: var(--surface);
  color: var(--text);
}
.frame-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.frame-btn svg {
  width: 13px;
  height: 13px;
}
/* Play/pause: tint accent while this plot is frozen (not following live) so it stands out. */
.play-btn.frozen {
  color: var(--accent-contrast);
  background: var(--accent);
}
.play-btn.frozen:hover {
  color: var(--accent-contrast);
  background: var(--accent);
  opacity: 0.9;
}
.frame-body {
  position: relative;
  flex: 1;
  min-height: 0;
  padding: 6px;
}
.frame-body.drag-over {
  outline: 2px dashed var(--accent);
  outline-offset: -2px;
  border-radius: 8px;
}
.empty-hint {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--text-dim);
  font-size: 12px;
  pointer-events: none;
  text-align: center;
}
.drop-hint {
  position: absolute;
  top: 8px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--accent);
  color: var(--accent-contrast);
  padding: 3px 10px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 600;
  pointer-events: none;
}

/* --- resize handles ------------------------------------------------------- */
/* Always grabbable (when interactive); the accent indicator only reveals on hover so the chart
   stays clean. Handles extend a few px into the gutter for an easy hit area. */
.rz {
  position: absolute;
  z-index: 4;
}
.rz::after {
  content: '';
  position: absolute;
  background: var(--accent);
  opacity: 0;
  transition: opacity 0.12s ease;
}
.rz:hover::after,
.item.active .rz::after {
  opacity: 0.85;
}
.rz-n,
.rz-s {
  left: 12px;
  right: 12px;
  height: 11px;
  cursor: ns-resize;
}
.rz-n {
  top: -4px;
}
.rz-s {
  bottom: -4px;
}
.rz-n::after,
.rz-s::after {
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 3px;
}
.rz-n::after {
  top: 4px;
}
.rz-s::after {
  bottom: 4px;
}
.rz-e,
.rz-w {
  top: 12px;
  bottom: 12px;
  width: 11px;
  cursor: ew-resize;
}
.rz-e {
  right: -4px;
}
.rz-w {
  left: -4px;
}
.rz-e::after,
.rz-w::after {
  top: 0;
  bottom: 0;
  width: 3px;
  border-radius: 3px;
}
.rz-e::after {
  right: 4px;
}
.rz-w::after {
  left: 4px;
}
.rz-ne,
.rz-nw,
.rz-se,
.rz-sw {
  width: 18px;
  height: 18px;
}
.rz-ne {
  top: -4px;
  right: -4px;
  cursor: nesw-resize;
}
.rz-nw {
  top: -4px;
  left: -4px;
  cursor: nwse-resize;
}
.rz-se {
  bottom: -4px;
  right: -4px;
  cursor: nwse-resize;
}
.rz-sw {
  bottom: -4px;
  left: -4px;
  cursor: nesw-resize;
}
.rz-ne::after,
.rz-nw::after,
.rz-se::after,
.rz-sw::after {
  width: 9px;
  height: 9px;
  border: 2px solid var(--accent);
  background: transparent;
  border-radius: 3px;
}
.rz-ne::after {
  top: 4px;
  right: 4px;
  border-left: none;
  border-bottom: none;
}
.rz-nw::after {
  top: 4px;
  left: 4px;
  border-right: none;
  border-bottom: none;
}
.rz-se::after {
  bottom: 4px;
  right: 4px;
  border-left: none;
  border-top: none;
}
.rz-sw::after {
  bottom: 4px;
  left: 4px;
  border-right: none;
  border-top: none;
}
</style>
