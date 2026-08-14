/**
 * 幕讲解播报：读取预合成 manifest / scripts，按幕入队本地 WAV。
 */
import scripts from '@data/tts/scripts.json'
import manifest from '@data/tts/manifest.json'

import s1Main from '@data/tts/scene1/s1-main.wav?url'
import s3Main from '@data/tts/scene3/s3-main.wav?url'
import s3bMain from '@data/tts/scene3b/s3b-main.wav?url'
import s4Main from '@data/tts/scene4/s4-main.wav?url'
import s5Main from '@data/tts/scene5/s5-main.wav?url'

import { clearBroadcastQueue, triggerBroadcast } from './broadcast-bus.js'
import { stopCurrent } from './tts.js'

const NARRATED = new Set(['1', '3', '3b', '4', '5'])

const AUDIO_BY_FILE = {
  'scene1/s1-main.wav': s1Main,
  'scene3/s3-main.wav': s3Main,
  'scene3b/s3b-main.wav': s3bMain,
  'scene4/s4-main.wav': s4Main,
  'scene5/s5-main.wav': s5Main,
}

/**
 * 切幕时调用：打断旧播报，若该幕有脚本则重新入队。
 * @param {string} sceneKey
 */
export function playSceneNarration(sceneKey) {
  stopCurrent()
  clearBroadcastQueue()

  if (!NARRATED.has(String(sceneKey))) return

  const scene = scripts.scenes?.[String(sceneKey)]
  const baked = manifest.scenes?.[String(sceneKey)]
  if (!scene?.segments?.length) return

  const segments = baked?.segments?.length ? baked.segments : scene.segments

  for (const seg of segments) {
    triggerBroadcast(seg.id, seg.text, {
      audioUrl: AUDIO_BY_FILE[seg.file] || '',
      durationSec: seg.duration_sec || seg.approx_sec || 0,
    })
  }
}

export function sceneHasNarration(sceneKey) {
  return NARRATED.has(String(sceneKey))
}
