<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  text: { type: String, required: true },
  speed: { type: Number, default: 75 }, // ms per character
  startDelay: { type: Number, default: 250 }, // ms before typing begins
})

const count = ref(0) // characters revealed so far
let timer = null

const typed = computed(() => props.text.slice(0, count.value))
// The untyped remainder is rendered transparently to reserve width, so the centered
// heading doesn't shift around as it types.
const ghost = computed(() => props.text.slice(count.value))

function step() {
  if (count.value >= props.text.length) return
  count.value += 1
  timer = setTimeout(step, props.speed)
}

onMounted(() => {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduce) {
    count.value = props.text.length // show it all at once, no animation
    return
  }
  timer = setTimeout(step, props.startDelay)
})

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <span class="typewriter">
    <span>{{ typed }}</span
    ><span class="caret" aria-hidden="true"></span><span class="ghost">{{ ghost }}</span>
  </span>
</template>

<style scoped>
.typewriter {
  white-space: pre;
}
.caret {
  display: inline-block;
  width: 0.09em;
  height: 0.92em;
  margin: 0 0.02em;
  vertical-align: -0.1em;
  background: var(--accent);
  animation: tw-blink 1.05s step-end infinite;
}
.ghost {
  opacity: 0; /* reserves layout width for the untyped remainder */
}
@keyframes tw-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
@media (prefers-reduced-motion: reduce) {
  .caret {
    animation: none;
  }
}
</style>
