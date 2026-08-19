/**
 * 幕讲解播报：读取预合成 manifest / scripts，按幕入队本地 WAV。
 *
 * 幕 1 已改为「指挥家时间轴」分段讲解（conductor 按拍取用
 * getConductorSegments），不再由本模块整段抢播；
 * 幕 3（成因分析）a2f 逐拍经 narrateBeat 走预合成 WAV（统一音色）；
 * 幕 3/3b/4/5 仍走进场整段播报。
 */
import scripts from '@data/tts/scripts.json'
import manifest from '@data/tts/manifest.json'

import s1Lock from '@data/tts/scene1/s1-lock.wav?url'
import s1Metrics from '@data/tts/scene1/s1-metrics.wav?url'
import s1Sat from '@data/tts/scene1/s1-sat.wav?url'
import s1Conclusion from '@data/tts/scene1/s1-conclusion.wav?url'
import s2Trace from '@data/tts/scene2/s2-trace.wav?url'
import s2Supply from '@data/tts/scene2/s2-supply.wav?url'
import s2Downstream from '@data/tts/scene2/s2-downstream.wav?url'
import s2Arterial from '@data/tts/scene2/s2-arterial.wav?url'
import s2Signal from '@data/tts/scene2/s2-signal.wav?url'
import s2Done from '@data/tts/scene2/s2-done.wav?url'
import s3Main from '@data/tts/scene3/s3-main.wav?url'
import s3bMain from '@data/tts/scene3b/s3b-main.wav?url'
import s4Main from '@data/tts/scene4/s4-main.wav?url'
import s5Main from '@data/tts/scene5/s5-main.wav?url'

import { clearBroadcastQueue, triggerBroadcast } from './broadcast-bus.js'
import { stopCurrent } from './tts.js'

const NARRATED = new Set(['3', '3b', '4', '5'])

const AUDIO_BY_FILE = {
  'scene1/s1-lock.wav': s1Lock,
  'scene1/s1-metrics.wav': s1Metrics,
  'scene1/s1-sat.wav': s1Sat,
  'scene1/s1-conclusion.wav': s1Conclusion,
  'scene2/s2-trace.wav': s2Trace,
  'scene2/s2-supply.wav': s2Supply,
  'scene2/s2-downstream.wav': s2Downstream,
  'scene2/s2-arterial.wav': s2Arterial,
  'scene2/s2-signal.wav': s2Signal,
  'scene2/s2-done.wav': s2Done,
  'scene3/s3-main.wav': s3Main,
  'scene3b/s3b-main.wav': s3bMain,
  'scene4/s4-main.wav': s4Main,
  'scene5/s5-main.wav': s5Main,
}

/**
 * 供指挥家时间轴按拍取用分段音频。
 * @param {string} sceneKey
 * @returns {Array<{ id: string, file: string, text: string, approxSec: number, durationSec: number, audioUrl: string }>}
 */
export function getConductorSegments(sceneKey) {
  const scene = scripts.scenes?.[String(sceneKey)]
  const baked = manifest.scenes?.[String(sceneKey)]
  const bakedById = new Map((baked?.segments || []).map((seg) => [seg.id, seg]))
  return (scene?.segments || []).map((seg) => {
    const bakedSeg = bakedById.get(seg.id)
    // 文案变化但 WAV 尚未重合成时，必须回退实时 TTS，禁止拿旧录音配新字幕。
    const audioCurrent = Boolean(
      bakedSeg
      && bakedSeg.file === seg.file
      && bakedSeg.text === seg.text
      && bakedSeg.audio_stale !== true
      && AUDIO_BY_FILE[seg.file],
    )
    return {
      id: seg.id,
      file: seg.file,
      text: seg.text || '',
      approxSec: Number(seg.approx_sec) || 0,
      durationSec: audioCurrent
        ? Number(bakedSeg.duration_sec) || Number(seg.approx_sec) || 0
        : Number(seg.approx_sec) || 0,
      audioUrl: audioCurrent ? AUDIO_BY_FILE[seg.file] : '',
    }
  })
}

/**
 * 切幕时调用：打断旧播报，若该幕有脚本则重新入队。
 * @param {string} sceneKey
 */
export function playSceneNarration(sceneKey) {
  stopCurrent()
  clearBroadcastQueue()

  if (!NARRATED.has(String(sceneKey))) return

  const segments = getConductorSegments(sceneKey)
  if (!segments.length) return

  for (const seg of segments) {
    triggerBroadcast(seg.id, seg.text, {
      audioUrl: seg.audioUrl,
      durationSec: seg.durationSec || seg.approxSec || 0,
    })
  }
}

export function sceneHasNarration(sceneKey) {
  return NARRATED.has(String(sceneKey))
}

/**
 * 幕 3（成因分析）逐拍口播：a2f.* beat 命中预合成 WAV 则入队播报（统一音色），
 * 返回是否已处理；未命中（文案未合成）时调用方回退实时 TTS。
 * @param {string} beatId
 */
export function narrateBeat(beatId) {
  const seg = getConductorSegments('2').find((s) => s.id === beatId)
  if (!seg || !seg.audioUrl) return false
  triggerBroadcast(seg.id, seg.text, {
    audioUrl: seg.audioUrl,
    durationSec: seg.durationSec || seg.approxSec || 0,
  })
  return true
}
