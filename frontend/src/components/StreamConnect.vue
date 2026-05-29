<script setup>
import { ref } from 'vue'

const props = defineProps({
  connecting: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['connect'])

const host = ref('0.0.0.0')
const port = ref(9870)
const timestampField = ref('')

function submit() {
  emit('connect', {
    host: host.value.trim() || '0.0.0.0',
    port: port.value,
    timestampField: timestampField.value.trim(),
  })
}
</script>

<template>
  <form class="connect" @submit.prevent="submit">
    <div class="row">
      <label class="field host">
        <span>Host</span>
        <input v-model="host" type="text" placeholder="0.0.0.0" spellcheck="false" />
      </label>
      <label class="field port">
        <span>Port</span>
        <input v-model.number="port" type="number" min="1" max="65535" placeholder="9870" />
      </label>
    </div>
    <label class="field">
      <span>Timestamp field <em>(optional)</em></span>
      <input
        v-model="timestampField"
        type="text"
        placeholder="auto-detect (t, time, timestamp…)"
        spellcheck="false"
      />
    </label>
    <button type="submit" :disabled="connecting">
      {{ connecting ? 'Connecting…' : 'Connect UDP stream' }}
    </button>
    <p v-if="error" class="error">{{ error }}</p>
    <p class="note">
      Listens for JSON datagrams. Nested objects become dotted series (e.g. <code>imu.ax</code>).
    </p>
  </form>
</template>

<style scoped>
.connect {
  display: flex;
  flex-direction: column;
  gap: 12px;
  text-align: left;
  background: var(--bg-elev);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 24px;
}
.row {
  display: flex;
  gap: 12px;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
}
.field.port {
  flex: 0 0 110px;
}
.field > span {
  font-size: 12px;
  color: var(--text-muted);
}
.field em {
  color: var(--text-dim);
  font-style: normal;
}
input {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 9px 11px;
  font-size: 14px;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s ease;
}
input:focus {
  border-color: var(--accent);
}
button {
  margin-top: 4px;
  background: var(--accent);
  color: var(--accent-contrast);
  border: none;
  border-radius: 10px;
  padding: 11px 16px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}
button:hover {
  opacity: 0.9;
}
button:disabled {
  opacity: 0.6;
  cursor: progress;
}
.error {
  margin: 0;
  color: var(--danger);
  font-size: 13px;
}
.note {
  margin: 0;
  font-size: 12px;
  color: var(--text-dim);
}
.note code {
  background: var(--surface);
  padding: 1px 5px;
  border-radius: 5px;
  font-size: 11px;
}
</style>
