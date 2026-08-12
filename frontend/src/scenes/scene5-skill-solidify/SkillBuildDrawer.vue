<script setup>
import SkillBuildPanel from './SkillBuildPanel.vue'

defineProps({
  state: { type: Object, required: true },
  open: { type: Boolean, default: false },
  writePath: { type: String, default: '' },
  writeAction: { type: String, default: '' },
  writeError: { type: String, default: '' },
})

const emit = defineEmits(['select', 'finish'])
</script>

<template>
  <Transition name="skill-drawer">
    <aside
      v-if="open"
      class="skill-drawer"
      data-testid="skill-build-drawer"
    >
      <SkillBuildPanel
        :state="state"
        :write-path="writePath"
        :write-action="writeAction"
        :write-error="writeError"
        @select="emit('select', $event)"
        @finish="emit('finish')"
      />
    </aside>
  </Transition>
</template>

<style scoped>
.skill-drawer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: min(980px, calc(100% - 360px - 48px));
  z-index: 45;
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
.skill-drawer > :deep(*) {
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
@media (max-width: 1100px) {
  .skill-drawer {
    width: 100%;
  }
}
</style>
