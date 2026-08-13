<script setup>
defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
</script>

<template>
  <section class="scaffold">
    <div class="map-plane" aria-hidden="true">
      <div class="grid" />
      <slot name="stage" />
    </div>

    <aside class="panel">
      <header class="panel-head">
        <h2>{{ title }}</h2>
        <p v-if="subtitle">{{ subtitle }}</p>
      </header>

      <div v-if="loading" class="state">加载中…</div>
      <div v-else-if="error" class="state error">{{ error }}</div>
      <div v-else class="body">
        <slot />
      </div>
    </aside>
  </section>
</template>

<style scoped>
.scaffold {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 1fr minmax(320px, 380px);
}

.map-plane {
  position: relative;
  overflow: hidden;
}

.grid {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(rgba(0, 229, 255, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(0, 229, 255, 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  mask-image: radial-gradient(ellipse at center, black 40%, transparent 85%);
}

.panel {
  position: relative;
  z-index: 5;
  margin: 12px 16px 24px 0;
  border: 1px solid var(--cyan-border);
  background: var(--bg-panel);
  backdrop-filter: blur(8px);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.panel-head {
  padding: 16px 16px 10px;
  border-bottom: 1px solid var(--cyan-border);
}

.panel-head h2 {
  margin: 0;
  font-size: 15px;
  color: var(--cyan);
  font-weight: 500;
  letter-spacing: 1px;
}

.panel-head p {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.5;
}

.body {
  padding: 14px 16px;
  overflow: auto;
  flex: 1;
  font-size: 12px;
  line-height: 1.55;
}

.state {
  padding: 24px 16px;
  color: var(--text-muted);
}

.state.error {
  color: var(--danger);
}
</style>
