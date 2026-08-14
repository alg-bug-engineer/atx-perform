<script setup>
/**
 * 相位相序图：对齐 assets/信控方案可视化图.png
 * 一阶段一张卡，绿时前后对比 + 渠化流向。默认解放东（有改动的口）。
 */
import { computed, ref } from 'vue'
import StageChannelization from '../scene3b-signal-plan/StageChannelization.vue'

const props = defineProps({
  board: { type: Object, required: true },
})

const selectedKey = ref('jiefang')

const nodes = computed(() => {
  const list = [...(props.board?.intersections || [])]
  return list.sort((a, b) => Number(b.key === 'jiefang') - Number(a.key === 'jiefang'))
})

const node = computed(
  () => nodes.value.find((n) => n.key === selectedKey.value) || nodes.value[0],
)

const cards = computed(() => {
  const n = node.value
  if (!n) return []
  return (n.stages || [])
    .filter((s) => s.green_before_s > 0 || s.green_after_s > 0 || (s.movements || []).length)
    .map((s) => {
      const delta = s.green_delta_s || 0
      const tone = delta < 0 ? 'cut' : delta > 0 ? 'add' : 'flat'
      return {
        key: `${n.key}-${s.stage_seq_no}`,
        seq: s.stage_seq_no,
        stageNo: s.stage_no,
        role: s.role,
        note: s.note,
        focus: Boolean(s.feeds_problem_link),
        movements: s.movements || [],
        labels: (s.movements || []).map((m) => m.label).join('、') || '过渡 / 行人',
        before: s.green_before_s,
        after: s.green_after_s,
        delta,
        tone,
        minG: s.min_green_sec,
        maxG: s.max_green_sec,
      }
    })
})

function deltaText(d) {
  if (d === 0) return '±0s'
  return `${d > 0 ? '+' : ''}${d}s`
}
</script>

<template>
  <section v-if="node" class="phase-board" data-testid="phase-sequence">
    <header class="col-head">
      <h3>相位相序图</h3>
      <div class="picker">
        <button
          v-for="n in nodes"
          :key="n.key"
          type="button"
          class="tg"
          :class="{ on: n.key === node.key }"
          @click="selectedKey = n.key"
        >
          {{ n.key === 'jiefang' ? '解放东' : '经十路' }}
        </button>
      </div>
    </header>

    <p class="note">{{ node.note }}</p>

    <ul class="meta">
      <li>
        <span>周期</span>
        <strong>{{ node.cycle_len_sec }} s</strong>
      </li>
      <li>
        <span>相位差</span>
        <strong>
          {{ node.offset_before_s }} → {{ node.offset_after_s }} s
          <em v-if="node.offset_delta_s" :class="node.offset_delta_s > 0 ? 'add' : 'cut'">
            {{ node.offset_delta_s > 0 ? '+' : '' }}{{ node.offset_delta_s }}s
          </em>
        </strong>
      </li>
    </ul>

    <div class="cards">
      <article
        v-for="c in cards"
        :key="c.key"
        class="card"
        :class="[c.tone, { focus: c.focus }]"
      >
        <header>
          <span class="ph">阶段 {{ c.stageNo }}</span>
          <strong>
            {{ c.before }}s → {{ c.after }}s
            <b>{{ deltaText(c.delta) }}</b>
          </strong>
        </header>
        <StageChannelization class="chan" :movements="c.movements" />
        <p class="labels">{{ c.labels }}</p>
        <p class="role">{{ c.role }}</p>
        <p v-if="c.minG != null" class="bound">最小/最大绿 {{ c.minG }}s / {{ c.maxG }}s</p>
      </article>
    </div>
  </section>
</template>

<style scoped>
.phase-board {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  padding: 6px 8px 8px;
  border: 1px solid var(--cyan-border);
  background: rgba(0, 16, 28, 0.55);
}

.col-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--cyan);
}
.picker {
  display: flex;
  gap: 4px;
}
.tg {
  padding: 2px 10px;
  font-size: 11px;
  letter-spacing: 1px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--cyan-border);
  cursor: pointer;
}
.tg.on {
  color: #041020;
  background: var(--cyan);
  border-color: var(--cyan);
}

.note {
  margin: 6px 0 4px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-muted);
}

.meta {
  display: flex;
  gap: 14px;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  font-size: 11px;
}
.meta span {
  margin-right: 6px;
  color: var(--text-muted);
}
.meta strong {
  font-weight: 500;
  color: var(--text);
}
.meta em {
  margin-left: 4px;
  font-style: normal;
}
.meta em.add,
.card.add header b {
  color: var(--ok);
}
.meta em.cut,
.card.cut header b {
  color: var(--danger);
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  min-height: 0;
  overflow: auto;
  flex: 1;
  align-content: start;
}
.card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 8px 8px 6px;
  border: 1px solid var(--cyan-border);
  background: rgba(4, 18, 32, 0.7);
}
.card.focus {
  border-color: var(--cyan-border-strong);
  box-shadow: 0 0 12px rgba(0, 229, 255, 0.18);
}
.card header {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.ph {
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.card header strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--text);
}
.card header b {
  margin-left: 4px;
  font-weight: 600;
}
.card.flat header b {
  color: var(--text-muted);
}

.chan {
  width: 100%;
  aspect-ratio: 1;
}

.labels,
.role,
.bound {
  margin: 0;
  font-size: 10px;
  line-height: 1.35;
  color: var(--text-muted);
}
.role {
  color: rgba(190, 220, 236, 0.8);
}
</style>
