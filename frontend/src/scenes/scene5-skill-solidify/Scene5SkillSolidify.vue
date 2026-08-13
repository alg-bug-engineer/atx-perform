<script setup>
/**
 * 幕 4 点「固化」直接进来：右侧经验吸收（保持不收起）+ 左侧技能抽屉 → 落盘 → 返回主页
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useSceneRoute } from '../../shared/useSceneRoute.js'
import { prefersInstant } from '../../shared/useSceneBeats.js'
import { solidifySkillToProject } from '../../services/skillSolidifyApi.js'
import { loadScene5Data } from './index.js'
import SkillForgeBackdrop from './SkillForgeBackdrop.vue'
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
/** absorbing | building */
const phase = ref('absorbing')
const absorptionStarted = ref(false)
const buildStarted = ref(false)
const writeResult = ref(null)
const writeError = ref('')

const instant = prefersInstant()

/** 吸收完成后仍保留右侧面板，与左侧技能抽屉同屏 */
const showAbsorption = computed(
  () => phase.value === 'absorbing' || phase.value === 'building',
)
const showBuild = computed(() => phase.value === 'building')

onMounted(async () => {
  try {
    payload.value = (await loadScene5Data()).skill
    startAbsorbing()
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
  phase.value = 'absorbing'
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

function startAbsorbing() {
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
    <SkillForgeBackdrop
      :progress="absorption.state.progress"
      :stage="absorption.state.currentStage"
      :skill-id="payload?.result_meta?.skillId || ''"
      :intersection="payload?.result_meta?.intersection || ''"
      :period="payload?.result_meta?.timePeriodLabel || ''"
      :files="payload?.build?.files || []"
      :forging="phase === 'building'"
    />

    <div v-if="loading" class="state-banner">加载中…</div>
    <div v-else-if="error" class="state-banner error">{{ error }}</div>

    <template v-else>
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
    </template>
  </div>
</template>

<style scoped>
.scene5 {
  position: absolute;
  inset: 0;
  pointer-events: none;
  /* 经验吸收面板宽度：主视觉按屏宽 ~21% 预留右侧空档，两者不叠 */
  --dock-w: min(352px, 19vw);
}
.absorption-dock {
  position: absolute;
  top: 12px;
  right: 16px;
  bottom: 24px;
  width: var(--dock-w);
  z-index: 44;
  overflow: hidden;
  pointer-events: auto;
}
.scene5 :deep(.skill-drawer) {
  top: 12px;
  bottom: 24px;
  left: 16px;
  /* 铺满除经验吸收面板外的宽度，大屏上不留空档 */
  width: calc(100% - var(--dock-w) - 48px);
}
.state-banner {
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
