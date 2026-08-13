<script setup>
/**
 * 幕头：小标签 + 结论式大标题 + 摘要 + 右侧措施 chip。
 * 与幕 3/3b/4 现有幕头同字号同间距，避免每幕各写一套。
 */
defineProps({
  eyebrow: { type: String, default: '' },
  title: { type: String, required: true },
  lede: { type: String, default: '' },
  chips: { type: Array, default: () => [] },
})
</script>

<template>
  <header class="head">
    <div class="head-main">
      <p v-if="eyebrow" class="eyebrow">{{ eyebrow }}</p>
      <h2>{{ title }}</h2>
      <p v-if="lede" class="lede">{{ lede }}</p>
      <slot name="lede" />
    </div>
    <div v-if="chips.length" class="chips">
      <div v-for="c in chips" :key="c.k" class="chip" :class="c.tone">
        <span>{{ c.k }}</span>
        <strong>{{ c.v }}</strong>
      </div>
    </div>
  </header>
</template>

<style scoped>
.head {
  display: flex;
  gap: 20px;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  flex: none;
}

.eyebrow {
  margin: 0 0 4px;
  font-size: 11px;
  letter-spacing: 4px;
  color: var(--cyan-dim);
}

h2 {
  margin: 0 0 4px;
  font-size: 21px;
  font-weight: 500;
  letter-spacing: 1px;
  color: var(--text);
}

.lede {
  margin: 0;
  max-width: 96ch;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-muted);
}

.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.chip {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 5px 12px;
  border: 1px solid var(--cyan-border);
  border-radius: 3px;
  background: var(--bg-inset);
}

.chip span {
  font-size: 11px;
  color: var(--text-muted);
}

.chip strong {
  font-size: 13px;
  font-weight: 500;
  color: var(--cyan);
}

.chip.change {
  border-color: rgba(51, 204, 136, 0.5);
}

.chip.change strong {
  color: var(--ok);
}

.chip.alert {
  border-color: rgba(255, 68, 68, 0.5);
}

.chip.alert strong {
  color: var(--danger);
}
</style>
