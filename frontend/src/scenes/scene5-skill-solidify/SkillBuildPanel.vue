<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  state: { type: Object, required: true },
  writePath: { type: String, default: '' },
  writeAction: { type: String, default: '' },
  writeError: { type: String, default: '' },
})

const emit = defineEmits(['select', 'finish'])

const WRITE_ACTION_LABEL = {
  created: '新建',
  updated: '更新',
  unchanged: '无变更',
}

const codeRef = ref(null)

const activeContent = computed(
  () => (props.state.activeFilePath
    ? (props.state.fileContents[props.state.activeFilePath] ?? '')
    : ''),
)
const codeLines = computed(() => activeContent.value.split('\n'))

const ACTION_LABEL = {
  created: '新建固化',
  updated: '更新固化',
  unchanged: '已存在',
}
const actionLabel = computed(
  () => ACTION_LABEL[props.state.action] ?? props.state.action,
)

const statusLabel = computed(() => {
  if (props.state.status === 'completed') return '已完成'
  if (props.state.status === 'running') return '沉淀中'
  return '待开始'
})

function flattenFiles(nodes, out = []) {
  for (const n of nodes) {
    if (n.type === 'file') out.push(n)
    if (n.children) flattenFiles(n.children, out)
  }
  return out
}

const flatFiles = computed(() => flattenFiles(props.state.files))

watch(activeContent, () => {
  const el = codeRef.value
  if (el) el.scrollTop = el.scrollHeight
})
</script>

<template>
  <section class="build" data-testid="skill-build-panel">
    <header class="build-hd">
      <div>
        <span class="build-eyebrow">技能固化</span>
        <h2>{{ state.intersection || '技能构建' }}</h2>
        <p v-if="state.timePeriodLabel" class="build-sub">{{ state.timePeriodLabel }}</p>
      </div>
      <div class="progress-card">
        <span>{{ statusLabel }}</span>
        <strong data-testid="build-progress">{{ state.progress }}%</strong>
      </div>
    </header>

    <div class="workbench">
      <aside class="timeline" aria-label="阶段时间线">
        <h3>阶段</h3>
        <div
          v-for="stage in state.stages"
          :key="stage.key"
          class="timeline-item"
          :class="`is-${stage.status}`"
        >
          <span class="timeline-dot" aria-hidden="true" />
          <span class="timeline-label">{{ stage.label }}</span>
          <small class="timeline-pct">{{ stage.progress }}%</small>
        </div>
      </aside>

      <section class="code-pane" aria-label="技能文件内容">
        <div class="code-pane-hd">
          <span class="code-pane-path">{{ state.activeFilePath || '等待生成…' }}</span>
        </div>
        <div ref="codeRef" class="code-output">
          <div v-for="(line, i) in codeLines" :key="i" class="code-line">
            <span class="ln">{{ i + 1 }}</span>
            <span class="txt">{{ line || ' ' }}</span>
          </div>
        </div>
      </section>

      <aside class="tree-pane" aria-label="技能包文件">
        <h3>技能包文件</h3>
        <ul v-if="flatFiles.length" class="file-list">
          <li
            v-for="f in flatFiles"
            :key="f.path"
            class="file-item"
            :class="{ active: f.path === state.activeFilePath, [`st-${f.status}`]: true }"
            @click="emit('select', f.path)"
          >
            {{ f.name }}
          </li>
        </ul>
        <p v-else class="muted">文件将逐个出现并开始写入。</p>
      </aside>
    </div>

    <footer v-if="state.status === 'completed'" class="build-ft" data-testid="build-footer">
      <div class="skill-card">
        <div class="skill-row">
          <span class="skill-k">技能 ID</span>
          <span class="skill-v mono">{{ state.skillId }}</span>
        </div>
        <div class="skill-row">
          <span class="skill-k">路口</span>
          <span class="skill-v">{{ state.intersection || '—' }}</span>
        </div>
        <div class="skill-row">
          <span class="skill-k">时段</span>
          <span class="skill-v">{{ state.timePeriodLabel || '—' }}</span>
        </div>
        <div class="skill-row">
          <span class="skill-k">动作</span>
          <span class="skill-v tag">{{ actionLabel }}</span>
        </div>
        <div v-if="writePath || writeError" class="skill-row">
          <span class="skill-k">落盘</span>
          <span v-if="writeError" class="skill-v fail">失败：{{ writeError }}</span>
          <span v-else class="skill-v mono ok-path">
            {{ writePath }}
            <template v-if="writeAction">
              · {{ WRITE_ACTION_LABEL[writeAction] || writeAction }}
            </template>
          </span>
        </div>
      </div>
      <div class="build-actions">
        <button
          type="button"
          class="btn btn-primary"
          data-testid="skill-return-home"
          @click="emit('finish')"
        >
          返回主页
        </button>
      </div>
    </footer>
  </section>
</template>

<style scoped>
.build {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
}
.build-hd {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.build-eyebrow {
  font-size: 10px;
  letter-spacing: 1px;
  color: var(--text-muted);
}
.build-hd h2 {
  margin: 2px 0;
  font-size: 16px;
  color: var(--text);
}
.build-sub {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
}
.progress-card {
  text-align: right;
  font-size: 11px;
  color: var(--text-muted);
}
.progress-card strong {
  display: block;
  font-size: 22px;
  color: var(--text);
}
.workbench {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 140px 1fr 160px;
  gap: 10px;
}
.timeline h3,
.tree-pane h3 {
  margin: 0 0 8px;
  font-size: 11px;
  color: var(--text-muted);
}
.timeline-item {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  gap: 6px;
  align-items: center;
  font-size: 11px;
  color: rgba(160, 200, 220, 0.45);
  margin-bottom: 6px;
}
.timeline-item.is-active,
.timeline-item.is-done {
  color: var(--text);
}
.timeline-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgba(160, 200, 220, 0.35);
}
.timeline-item.is-active .timeline-dot {
  background: var(--cyan);
  box-shadow: 0 0 6px rgba(0, 229, 255, 0.6);
}
.timeline-item.is-done .timeline-dot {
  background: var(--ok);
}
.timeline-pct {
  color: rgba(160, 200, 220, 0.45);
}
.code-pane {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--cyan-border);
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.28);
}
.code-pane-hd {
  padding: 6px 8px;
  border-bottom: 1px solid rgba(0, 229, 255, 0.12);
  font-size: 11px;
  color: #7ee8f5;
}
.code-output {
  flex: 1;
  overflow: auto;
  padding: 6px 0;
  font-family: var(--font-mono);
  font-size: 11px;
}
.code-line {
  display: flex;
  gap: 8px;
  padding: 0 8px;
  line-height: 1.45;
}
.ln {
  width: 28px;
  text-align: right;
  color: rgba(160, 200, 220, 0.35);
  flex-shrink: 0;
}
.txt {
  color: var(--text);
  white-space: pre-wrap;
}
.file-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
}
.file-item {
  font-size: 11px;
  padding: 4px 6px;
  border-radius: 2px;
  cursor: pointer;
  color: var(--text-muted);
  border: 1px solid transparent;
}
.file-item.active {
  color: #7ee8f5;
  border-color: var(--cyan-border-strong);
  background: rgba(0, 229, 255, 0.08);
}
.file-item.st-writing {
  color: var(--warn);
}
.muted {
  font-size: 11px;
  color: rgba(160, 200, 220, 0.45);
}
.build-ft {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid rgba(0, 229, 255, 0.15);
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
}
.skill-card {
  display: grid;
  gap: 4px;
  font-size: 11px;
}
.skill-row {
  display: flex;
  gap: 8px;
}
.skill-k {
  color: var(--text-muted);
  min-width: 48px;
}
.skill-v {
  color: var(--text);
}
.skill-v.mono {
  font-family: var(--font-mono);
  font-size: 10px;
}
.skill-v.tag {
  color: var(--text);
}
.skill-v.ok-path {
  color: var(--text);
}
.skill-v.fail {
  color: var(--danger);
}
.btn {
  padding: 8px 18px;
  border-radius: 2px;
  border: 1px solid var(--cyan-border-strong);
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.btn-primary {
  background: rgba(0, 229, 255, 0.92);
  color: rgba(4, 12, 22, 0.95);
}
.btn-primary:hover {
  background: var(--cyan);
}
@media (max-width: 900px) {
  .workbench {
    grid-template-columns: 1fr;
  }
}
</style>
