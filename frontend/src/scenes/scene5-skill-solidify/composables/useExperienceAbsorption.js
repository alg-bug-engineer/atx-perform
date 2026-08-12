/**
 * 经验吸收动画驱动（移植自 agent-loop useExperienceAbsorption）
 */
import { reactive } from 'vue'

function createInitialState() {
  return {
    active: false,
    currentStage: null,
    progress: 0,
    lines: [],
    valueSnapshot: null,
    action: null,
    skillId: '',
    intersection: '',
  }
}

function detectInstant() {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const automation = typeof navigator !== 'undefined' && navigator.webdriver === true
  return reduced || automation
}

export function useExperienceAbsorption() {
  const state = reactive(createInitialState())
  const timers = []

  function clearTimers() {
    timers.forEach(clearTimeout)
    timers.length = 0
  }

  function reset() {
    clearTimers()
    Object.assign(state, createInitialState())
  }

  function applyStage(stage, index, total) {
    state.currentStage = stage.key
    state.lines.push({
      seq: state.lines.length + 1,
      stage: stage.key,
      label: stage.label,
      monologue: stage.monologue,
      chips: stage.evidence_chips ?? [],
      durationMs: stage.duration_ms,
    })
    state.progress = Math.min(95, Math.round(((index + 1) / total) * 100))
  }

  function finalize(absorption) {
    state.currentStage = 'done'
    state.progress = 100
    state.valueSnapshot = absorption.value_snapshot
    state.action = absorption.action
    state.active = false
  }

  function start(absorption, opts = {}) {
    reset()
    const instant = opts.instant ?? detectInstant()
    const cap = opts.maxStageDelayMs ?? 700
    const stages = absorption?.stages ?? []
    const total = Math.max(stages.length, 1)

    state.active = true
    state.action = absorption.action
    if (opts.skillId) state.skillId = opts.skillId
    if (opts.intersection) state.intersection = opts.intersection
    opts.onStart?.()

    if (instant) {
      stages.forEach((stage, i) => {
        opts.onStageStart?.(stage.key)
        applyStage(stage, i, total)
      })
      finalize(absorption)
      opts.onDone?.()
      return
    }

    let acc = 0
    stages.forEach((stage, i) => {
      const t = setTimeout(() => {
        opts.onStageStart?.(stage.key)
        applyStage(stage, i, total)
      }, acc)
      timers.push(t)
      acc += Math.min(Math.max(stage.duration_ms ?? 400, 0), cap)
    })
    const doneT = setTimeout(() => {
      finalize(absorption)
      opts.onDone?.()
    }, acc)
    timers.push(doneT)
  }

  return { state, start, reset }
}
