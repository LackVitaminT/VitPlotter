<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { theme } from '../theme.js'

const props = defineProps({
  // { times:[s], freqs:[Hz], mags:[Float32Array per frame, length = freqs.length] (dB) }
  spectro: { type: Object, default: null },
  dynamicRange: { type: Number, default: 60 }, // dB shown below the peak
})

const canvasEl = ref(null)
let ro = null

// Viridis-ish colormap stops (perceptually ordered), interpolated for t in [0,1].
const STOPS = [
  [68, 1, 84],
  [59, 82, 139],
  [33, 144, 140],
  [93, 201, 99],
  [253, 231, 37],
]
function colormap(t) {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1)
  const i = Math.min(STOPS.length - 2, Math.floor(x))
  const f = x - i
  const a = STOPS[i]
  const b = STOPS[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

function draw() {
  const canvas = canvasEl.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  const host = canvas.parentElement
  const W = Math.max(1, host?.clientWidth || 300)
  const H = Math.max(1, host?.clientHeight || 160)
  canvas.width = W
  canvas.height = H
  ctx.clearRect(0, 0, W, H)

  const sg = props.spectro
  const cols = sg?.mags?.length || 0
  const rows = sg?.freqs?.length || 0
  if (cols < 1 || rows < 1) return

  // Peak / floor for normalization.
  let max = -Infinity
  for (const col of sg.mags) for (let k = 0; k < rows; k++) if (col[k] > max) max = col[k]
  if (!Number.isFinite(max)) return
  const floor = max - props.dynamicRange
  const span = max - floor || 1

  // Render the matrix into a cols×rows image, then scale it onto the display canvas.
  const img = ctx.createImageData(cols, rows)
  for (let c = 0; c < cols; c++) {
    const col = sg.mags[c]
    for (let k = 0; k < rows; k++) {
      const y = rows - 1 - k // high frequency at the top
      const t = (col[k] - floor) / span
      const [r, g, b] = colormap(t)
      const o = (y * cols + c) * 4
      img.data[o] = r
      img.data[o + 1] = g
      img.data[o + 2] = b
      img.data[o + 3] = 255
    }
  }
  const tmp = document.createElement('canvas')
  tmp.width = cols
  tmp.height = rows
  tmp.getContext('2d').putImageData(img, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(tmp, 0, 0, W, H)
}

const fmtHz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v))

onMounted(() => {
  draw()
  ro = new ResizeObserver(draw)
  if (canvasEl.value?.parentElement) ro.observe(canvasEl.value.parentElement)
})
onBeforeUnmount(() => ro?.disconnect())
watch(() => props.spectro, draw, { deep: false })
watch(theme, draw)
</script>

<template>
  <div class="spectro">
    <div class="canvas-wrap">
      <canvas ref="canvasEl"></canvas>
      <span v-if="spectro?.freqs?.length" class="ax ax-top"
        >{{ fmtHz(spectro.freqs[spectro.freqs.length - 1]) }} Hz</span
      >
      <span v-if="spectro?.freqs?.length" class="ax ax-bot">0 Hz</span>
    </div>
    <div v-if="!spectro?.mags?.length" class="placeholder">Waiting for enough samples…</div>
  </div>
</template>

<style scoped>
.spectro {
  position: relative;
  width: 100%;
  height: 100%;
}
.canvas-wrap {
  position: relative;
  width: 100%;
  height: 100%;
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 6px;
}
.ax {
  position: absolute;
  left: 4px;
  font-size: 10px;
  color: #fff;
  text-shadow: 0 0 3px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}
.ax-top {
  top: 3px;
}
.ax-bot {
  bottom: 3px;
}
.placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--text-dim);
  font-size: 12px;
}
</style>
