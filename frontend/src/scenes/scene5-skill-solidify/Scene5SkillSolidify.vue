<script setup>
/**
 * 确认弹窗 → 右侧经验吸收（保持不收起）+ 左侧技能抽屉 → 落盘 → 返回主页
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { solidifySkillToProject } from '../../services/skillSolidifyApi.js'
import { loadScene5Data } from './index.js'
import SkillSolidifyOverlay from './SkillSolidifyOverlay.vue'
import ExperienceAbsorptionPanel from './ExperienceAbsorptionPanel.vue'
import SkillBuildDrawer from './SkillBuildDrawer.vue'
import { useSkillBuildProcess } from './composables/useSkillBuildProcess.js'
import { useExperienceAbsorption } from './composables/useExperienceAbsorption.js'

const { setScene } = useSceneRoute()
const build = useSkillBuildProcess()
const absorption = useExperienceAbsorption()

const loading = ref(true)
const error = ref('')
const payload = ref(null)
/** prompt | absorbing | building | declined */
const phase = ref('prompt')
const absorptionStarted = ref(false)
const buildStarted = ref(false)
const writeResult = ref(null)
const writeError = ref('')

const instant = (() => {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const automation = typeof navigator !== 'undefined' && navigator.webdriver === true
  return reduced || automation
})()

const promptTitle = computed(() => payload.value?.prompt?.title || '技能固化')
const promptBody = computed(() => payload.value?.prompt?.body || '')
/** 吸收完成后仍保留右侧面板，与左侧技能抽屉同屏 */
const showAbsorption = computed(
  () => phase.value === 'absorbing' || phase.value === 'building',
)
const showBuild = computed(() => phase.value === 'building')

onMounted(async () => {
  try {
    payload.value = (await loadScene5Data()).skill
  } catch (e) {
    error.value = e?.message || String(e)
  } finally {
    loading.value = false
  }
})

onUnmounted(() => {
  absorption.reset()
  build.reset()
})

function returnHome(message) {
  absorption.reset()
  build.reset()
  absorptionStarted.value = false
  buildStarted.value = false
  phase.value = 'prompt'
  setScene('0')
  if (message && typeof window !== 'undefined') {
    console.info('[skill-solidify]', message)
  }
}

async function persistSkill() {
  if (!payload.value) return
  writeError.value = ''
  try {
    writeResult.value = await solidifySkillToProject({
      skillId: payload.value.result_meta?.skillId,
      skillDir: payload.value.result_meta?.skillDir,
      resultMeta: payload.value.result_meta,
      files: payload.value.build?.files || [],
    })
    if (writeResult.value?.skillDir) {
      build.state.skillDir = writeResult.value.skillDir
    }
    if (writeResult.value?.action) {
      build.state.action = writeResult.value.action
    }
  } catch (e) {
    writeError.value = e?.message || String(e)
    console.error('[skill-solidify] 落盘失败', e)
  }
}

function startBuilding() {
  if (!payload.value || buildStarted.value) return
  buildStarted.value = true
  phase.value = 'building'
  const meta = {
    skillId: payload.value.result_meta?.skillId || '',
    skillDir: payload.value.result_meta?.skillDir || '',
    downloadUrl: payload.value.result_meta?.downloadUrl || '',
    intersection: payload.value.result_meta?.intersection || '',
    timePeriodLabel: payload.value.result_meta?.timePeriodLabel || '',
    action: payload.value.result_meta?.action || 'created',
  }
  build.start(payload.value.build || {}, meta, {
    instant,
    onDone: () => {
      void persistSkill()
    },
  })
}

function confirmSolidify() {
  if (!payload.value || absorptionStarted.value) return
  absorptionStarted.value = true
  phase.value = 'absorbing'
  absorption.start(payload.value.absorption || {}, {
    instant,
    skillId: payload.value.result_meta?.skillId,
    intersection: payload.value.result_meta?.intersection,
    onDone: () => startBuilding(),
  })
}

function declineSolidify() {
  returnHome('方案已跳过固化，已返回主页。')
}

function onBuildFinish() {
  const dir = writeResult.value?.skillDir || payload.value?.result_meta?.skillDir || ''
  const msg = writeError.value
    ? `技能包展示完成，但落盘失败：${writeError.value}`
    : dir
      ? `技能已固化并写入 ${dir}`
      : '技能已固化，已返回主页。'
  returnHome(msg)
}
</script>

<template>
  <div class="scene5" data-testid="scene5-skill-solidify">
    <div class="map-plane" aria-hidden="true">
      <div class="grid" />
    </div>

    <div v-if="loading" class="state-banner">加载中…</div>
    <div v-else-if="error" class="state-banner error">{{ error }}</div>

    <template v-else>
      <SkillSolidifyOverlay
        :open="phase === 'prompt'"
        :title="promptTitle"
        :body="promptBody"
        @confirm="confirmSolidify"
        @decline="declineSolidify"
      />

      <Transition name="dock-fade">
        <aside v-if="showAbsorption" class="absorption-dock">
          <ExperienceAbsorptionPanel :state="absorption.state" />
        </aside>
      </Transition>

      <SkillBuildDrawer
        :open="showBuild"
        :state="build.state"
        :write-path="writeResult?.skillDir || ''"
        :write-action="writeResult?.action || ''"
        :write-error="writeError"
        @select="build.selectFile($event)"
        @finish="onBuildFinish"
      />

      <div v-if="phase === 'prompt'" class="hint">
        等待确认是否固化本次处置经验…
      </div>
    </template>
  </div>
</template>

<style scoped>
.scene5 {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.map-plane {
  position: absolute;
  inset: 0;
  pointer-events: none;
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
.absorption-dock {
  position: absolute;
  top: 12px;
  right: 16px;
  bottom: 24px;
  width: min(360px, 32vw);
  z-index: 44;
  overflow: hidden;
  pointer-events: auto;
}
.scene5 :deep(.skill-drawer) {
  top: 12px;
  bottom: 24px;
  left: 16px;
  /* 为右侧经验吸收留空 */
  width: min(980px, calc(100% - 360px - 48px));
}
.state-banner,
.hint {
  position: absolute;
  left: 50%;
  top: 40%;
  transform: translate(-50%, -50%);
  z-index: 40;
  color: var(--text-muted);
  font-size: 13px;
  pointer-events: none;
  text-align: center;
}
.state-banner.error {
  color: var(--danger);
}
.dock-fade-enter-active,
.dock-fade-leave-active {
  transition: opacity 0.35s ease, transform 0.35s ease;
}
.dock-fade-enter-from,
.dock-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
