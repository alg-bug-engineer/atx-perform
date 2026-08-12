<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  state: { type: Object, required: true },
})

const traceRef = ref(null)
const pulsing = computed(
  () => props.state.active && props.state.currentStage !== 'done',
)
const traceFingerprint = computed(
  () => props.state.lines.map((l) => l.seq).join(','),
)

watch(
  [traceFingerprint, () => props.state.valueSnapshot],
  () => {
    nextTick(() => {
      const el = traceRef.value
      if (el) el.scrollTop = el.scrollHeight
    })
  },
  { flush: 'post' },
)
</script>

<template>
  <section class="absorption" data-testid="absorption-panel">
    <header class="absorption-hd">
      <span class="absorption-icon" aria-hidden="true">◆</span>
      <h2>经验吸收</h2>
      <span v-if="pulsing" class="pulse-dot" title="吸收中" data-testid="absorption-pulse" />
    </header>

    <div ref="traceRef" class="trace" data-testid="absorption-trace">
      <ol v-if="state.lines.length" class="trace-list">
        <li v-for="line in state.lines" :key="line.seq" class="trace-item">
          <div class="trace-meta">
            <span class="stage-badge">{{ line.label }}</span>
            <span v-if="line.durationMs != null" class="duration">{{ line.durationMs }}ms</span>
          </div>
          <p class="monologue">{{ line.monologue }}</p>
          <div v-if="line.chips.length" class="chip-row">
            <span v-for="chip in line.chips" :key="chip.key" class="chip">
              <span class="chip-label">{{ chip.label }}</span>
              <span class="chip-value">{{ chip.value }}</span>
            </span>
          </div>
        </li>
      </ol>
      <p v-else class="placeholder">等待吸收追踪…</p>
    </div>

    <div v-if="state.valueSnapshot?.why_rows?.length" class="value-block">
      <h3 class="value-title">价值前后对照</h3>
      <table class="value-table" data-testid="absorption-value-table">
        <thead>
          <tr>
            <th>维度</th>
            <th>吸收前</th>
            <th>吸收后</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in state.valueSnapshot.why_rows" :key="row.key">
            <td>{{ row.label }}</td>
            <td>{{ row.before }}</td>
            <td>{{ row.after }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.absorption {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  padding: 12px 14px;
  border-radius: 4px;
  border: 1px solid var(--cyan-border);
  background: var(--bg-panel);
  pointer-events: auto;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
}
.absorption-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.absorption-hd h2 {
  flex: 1;
  margin: 0;
  font-size: 15px;
  color: var(--text);
}
.absorption-icon {
  color: var(--cyan);
  font-size: 12px;
}
.pulse-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cyan);
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.75);
  animation: pulse 1.2s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}
.trace {
  flex: 1;
  overflow-y: auto;
  min-height: 120px;
}
.trace-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 10px;
}
.trace-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.stage-badge {
  font-size: 10px;
  padding: 1px 6px;
  border: 1px solid var(--cyan-border-strong);
  color: #7ee8f5;
}
.duration {
  font-size: 10px;
  color: rgba(160, 200, 220, 0.45);
}
.monologue {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text);
}
.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  display: inline-flex;
  gap: 4px;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 2px;
  background: rgba(0, 229, 255, 0.08);
  border: 1px solid rgba(0, 229, 255, 0.2);
}
.chip-label { color: var(--text-muted); }
.chip-value { color: var(--text); }
.placeholder {
  margin: 0;
  font-size: 12px;
  color: rgba(160, 200, 220, 0.45);
}
.value-block {
  margin-top: 10px;
  flex-shrink: 0;
}
.value-title {
  margin: 0 0 6px;
  font-size: 11px;
  color: var(--cyan-dim);
  letter-spacing: 0.5px;
}
.value-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
}
.value-table th,
.value-table td {
  border: 1px solid var(--cyan-border);
  padding: 5px 6px;
  text-align: left;
}
.value-table th {
  color: var(--cyan-dim);
  background: rgba(255, 255, 255, 0.03);
}
.value-table td {
  color: var(--text);
}
</style>
