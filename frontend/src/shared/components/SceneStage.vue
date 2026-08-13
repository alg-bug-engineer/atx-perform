<script setup>
/**
 * 全幕通用舞台：栅格背景 + 加载/错误态 + 满幅抽屉 + 底部动作条。
 * 版式取自幕 3/3b/4（抽屉 top 12 / bottom 24 / 左右 16），幕 0–5 共用同一套外框。
 */
defineProps({
  loading: { type: Boolean, default: false },
  error: { type: String, default: '' },
  ready: { type: Boolean, default: true },
})
</script>

<template>
  <div class="scene-stage">
    <div class="map-plane" aria-hidden="true">
      <div class="grid" />
      <slot name="backdrop" />
    </div>

    <div v-if="loading" class="state-banner">加载中…</div>
    <div v-else-if="error" class="state-banner error">{{ error }}</div>

    <section v-else-if="ready" class="drawer">
      <div class="drawer-body">
        <slot />
      </div>
      <footer v-if="$slots.foot" class="drawer-foot">
        <slot name="foot" />
      </footer>
    </section>
  </div>
</template>

<style scoped>
.scene-stage {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.map-plane {
  position: absolute;
  inset: 0;
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

.state-banner {
  position: absolute;
  left: 50%;
  top: 40%;
  transform: translate(-50%, -50%);
  z-index: 40;
  color: var(--text-muted);
  font-size: 13px;
}

.state-banner.error {
  color: var(--danger);
}

.drawer {
  position: absolute;
  top: 12px;
  right: 16px;
  bottom: 24px;
  left: 16px;
  z-index: 46;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
  padding: 14px 16px;
  border-radius: 4px;
  border: 1px solid var(--cyan-border-strong);
  background: var(--bg-drawer);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
}

.drawer-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drawer-foot {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
</style>
