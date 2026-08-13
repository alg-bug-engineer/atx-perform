<script setup>
import TrialEffectPanel from './TrialEffectPanel.vue'

defineProps({
  payload: { type: Object, required: true },
  optimization: { type: Object, default: null },
  open: { type: Boolean, default: true },
})

const emit = defineEmits(['finish', 'home'])
</script>

<template>
  <Transition name="skill-drawer">
    <aside
      v-if="open"
      class="effect-drawer"
      data-testid="trial-effect-drawer"
    >
      <TrialEffectPanel
        :payload="payload"
        :optimization="optimization"
        @finish="emit('finish')"
        @home="emit('home')"
      />
    </aside>
  </Transition>
</template>

<style scoped>
.effect-drawer {
  position: absolute;
  top: 12px;
  bottom: 24px;
  left: 16px;
  right: 16px;
  z-index: 46;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 14px 16px;
  border-radius: 4px;
  border: 1px solid var(--cyan-border-strong);
  background: rgba(4, 12, 30, 0.96);
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
  pointer-events: auto;
}
.effect-drawer > :deep(*) {
  flex: 1;
  min-height: 0;
}
.skill-drawer-enter-active,
.skill-drawer-leave-active {
  transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.42s ease;
}
.skill-drawer-enter-from,
.skill-drawer-leave-to {
  transform: translateX(-24px);
  opacity: 0;
}
</style>
