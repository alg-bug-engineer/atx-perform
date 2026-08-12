<script setup>
defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '技能固化' },
  body: { type: String, default: '' },
})

const emit = defineEmits(['confirm', 'decline'])
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="solidify-overlay"
      role="dialog"
      aria-label="技能固化确认"
      data-testid="solidify-overlay"
    >
      <div class="prompt" data-testid="solidify-prompt">
        <h2 class="prompt-title">{{ title }}</h2>
        <p class="prompt-body">{{ body }}</p>
        <div class="prompt-actions">
          <button
            type="button"
            class="btn btn-ghost"
            data-testid="solidify-decline"
            @click="emit('decline')"
          >
            暂不固化
          </button>
          <button
            type="button"
            class="btn btn-primary"
            data-testid="solidify-confirm"
            @click="emit('confirm')"
          >
            确认固化
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.solidify-overlay {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 3vh 3vw;
  background: rgba(2, 8, 16, 0.78);
  backdrop-filter: blur(6px);
}
.prompt {
  width: min(460px, calc(100% - 32px));
  padding: 22px 24px;
  border-radius: 4px;
  border: 1px solid var(--cyan-border-strong);
  background: rgba(4, 12, 30, 0.98);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
}
.prompt-title {
  margin: 0 0 12px;
  font-size: 17px;
  color: var(--cyan);
}
.prompt-body {
  margin: 0 0 20px;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--text-muted);
}
.prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
.btn {
  padding: 8px 20px;
  border-radius: 2px;
  border: 1px solid transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
}
.btn-primary {
  background: rgba(0, 229, 255, 0.92);
  color: rgba(4, 12, 22, 0.95);
  border-color: var(--cyan-border-strong);
}
.btn-primary:hover {
  background: var(--cyan);
}
.btn-ghost {
  background: transparent;
  border-color: var(--cyan-border);
  color: var(--text-muted);
}
.btn-ghost:hover {
  color: var(--cyan);
  border-color: var(--cyan-border-strong);
}
</style>
