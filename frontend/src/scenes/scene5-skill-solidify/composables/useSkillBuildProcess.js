/**
 * 技能包构建动画驱动（移植自 agent-loop useSkillBuildProcess）
 */
import { reactive } from 'vue'

const STAGE_FILE_PATH = {
  writing_skill_md: 'SKILL.md',
  writing_reference: 'reference.md',
  writing_scripts: 'scripts/fetch_traffic_data.sql',
  writing_meta: 'skill.meta.json',
}

function createInitialState() {
  return {
    active: false,
    status: 'idle',
    progress: 0,
    currentStage: null,
    stages: [],
    files: [],
    fileContents: {},
    activeFilePath: '',
    skillId: '',
    skillDir: '',
    downloadUrl: '',
    intersection: '',
    timePeriodLabel: '',
    action: '',
  }
}

function detectInstant() {
  const reduced = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const automation = typeof navigator !== 'undefined' && navigator.webdriver === true
  return reduced || automation
}

function addFileToTree(files, filePath, language, status) {
  const parts = filePath.split('/')
  let siblings = files
  let currentPath = ''
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    currentPath = currentPath ? `${currentPath}/${part}` : part
    const isFile = index === parts.length - 1
    let node = siblings.find((item) => item.name === part)
    if (!node) {
      node = {
        name: part,
        path: currentPath,
        type: isFile ? 'file' : 'directory',
        language: isFile ? language : undefined,
        status: isFile ? status : 'completed',
        children: isFile ? undefined : [],
      }
      siblings.push(node)
    }
    if (isFile) {
      node.type = 'file'
      node.language = language
      node.status = status
    } else {
      node.children ||= []
      siblings = node.children
    }
  }
}

function markFileStatus(files, path, status) {
  for (const node of files) {
    if (node.path === path) {
      node.status = status
      return true
    }
    if (node.children && markFileStatus(node.children, path, status)) return true
  }
  return false
}

export function useSkillBuildProcess() {
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

  function activateStage(index, stage) {
    for (let i = 0; i < index; i += 1) {
      if (state.stages[i]) state.stages[i].status = 'done'
    }
    if (state.stages[index]) state.stages[index].status = 'active'
    state.currentStage = stage.key
    state.progress = stage.progress
  }

  function finalize(meta, opts) {
    state.stages.forEach((s) => { s.status = 'done' })
    state.status = 'completed'
    state.currentStage = 'completed'
    state.progress = 100
    state.active = false
    state.skillId = meta.skillId
    state.skillDir = meta.skillDir
    state.downloadUrl = meta.downloadUrl
    state.intersection = meta.intersection
    state.timePeriodLabel = meta.timePeriodLabel
    state.action = meta.action || state.action
    opts.onDone?.()
  }

  function fileForStage(build, stageKey) {
    const path = STAGE_FILE_PATH[stageKey]
    if (!path) return undefined
    return (build.files ?? []).find((f) => f.path === path)
  }

  function start(build, meta, opts = {}) {
    reset()
    const instant = opts.instant ?? detectInstant()
    const stageCap = Math.min(opts.maxStageDelayMs ?? 700, 400)
    const typeDelay = opts.typeDelayMs ?? 20

    state.active = true
    state.status = 'running'
    state.action = meta.action || state.action
    state.stages = (build.stages ?? []).map((s) => ({
      key: s.key,
      label: s.label,
      progress: s.progress,
      status: 'pending',
    }))

    const stages = build.stages ?? []

    if (instant) {
      stages.forEach((stage, i) => {
        activateStage(i, stage)
        const file = fileForStage(build, stage.key)
        if (file) {
          addFileToTree(state.files, file.path, file.language, 'completed')
          state.fileContents[file.path] = file.content
          state.activeFilePath = file.path
        }
      })
      finalize(meta, opts)
      return
    }

    let i = 0

    function typeFile(file, done) {
      const content = file.content
      const chunk = Math.max(1, Math.ceil(content.length / 24))
      let pos = 0
      function tick() {
        pos = Math.min(content.length, pos + chunk)
        state.fileContents[file.path] = content.slice(0, pos)
        if (pos >= content.length) {
          done()
          return
        }
        const t = setTimeout(tick, typeDelay)
        timers.push(t)
      }
      const t0 = setTimeout(tick, typeDelay)
      timers.push(t0)
    }

    function nextStage() {
      if (i >= stages.length) {
        finalize(meta, opts)
        return
      }
      const stage = stages[i]
      activateStage(i, stage)
      const file = fileForStage(build, stage.key)
      if (file) {
        addFileToTree(state.files, file.path, file.language, 'writing')
        state.activeFilePath = file.path
        state.fileContents[file.path] = ''
        typeFile(file, () => {
          markFileStatus(state.files, file.path, 'completed')
          if (state.stages[i]) state.stages[i].status = 'done'
          i += 1
          const t = setTimeout(nextStage, stageCap)
          timers.push(t)
        })
      } else {
        if (state.stages[i]) state.stages[i].status = 'done'
        i += 1
        const t = setTimeout(nextStage, stageCap)
        timers.push(t)
      }
    }

    const t = setTimeout(nextStage, 0)
    timers.push(t)
  }

  function selectFile(path) {
    if (state.fileContents[path] !== undefined) state.activeFilePath = path
  }

  return { state, start, reset, selectFile }
}
