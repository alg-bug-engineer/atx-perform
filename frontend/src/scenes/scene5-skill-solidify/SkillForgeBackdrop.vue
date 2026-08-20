<script setup>
/**
 * 技能固化主视觉：左侧四幕处置思路 → 中间锻造核心 → 右侧可复用技能包。
 * 只吃 absorption 的进度，不做业务判断，纯表现层。
 */
import { computed } from 'vue'

const props = defineProps({
  progress: { type: Number, default: 0 },
  stage: { type: String, default: null },
  skillId: { type: String, default: '' },
  intersection: { type: String, default: '' },
  period: { type: String, default: '' },
  files: { type: Array, default: () => [] },
  forging: { type: Boolean, default: false },
})

const W = 1600
const H = 880
/**
 * 右侧 x>1260 留给经验吸收面板（约占屏宽 19–21%，见 Scene5 的 --dock-w），
 * 主视觉的思路→核心→技能包三段都压在 1260 以内，避免被面板盖住。
 */
const CX = 620
const CY = 430
const PACK_X = 872
const PACK_R = 1252

const SOURCES = [
  { key: 'locate', n: '2', name: '问题定位', desc: '奥体西 N→S 晚高峰排队 270 m' },
  { key: 'cause', n: '3', name: '分析成因', desc: '展宽仅 100 m · 上游红灯期汇入' },
  { key: 'plan', n: '4', name: '优化方案', desc: '解放东相位差 +56 s 协调放行' },
  { key: 'eval', n: '5', name: '效果评估', desc: '排队 270 → 230 m' },
]

const sources = computed(() =>
  SOURCES.map((s, i) => {
    const y = 168 + i * 152
    return {
      ...s,
      y,
      on: props.progress >= 8 + i * 18,
      path: `M 300 ${y} C 420 ${y}, 460 ${CY}, ${CX - 156} ${CY}`,
      delay: `${i * 0.5}s`,
    }
  }),
)

const fileRows = computed(() => {
  const list = props.files.length
    ? props.files
    : [{ path: 'SKILL.md' }, { path: 'reference.md' }, { path: 'scripts/fetch_traffic_data.sql' }, { path: 'skill.meta.json' }]
  return list.slice(0, 5).map((f, i) => ({
    key: f.path || f.name || i,
    label: f.path || f.name || '',
    y: 336 + i * 46,
    on: props.progress >= 45 + i * 12,
  }))
})

const pct = computed(() => Math.max(0, Math.min(100, Math.round(props.progress))))
const coreLabel = computed(() => (props.forging ? '技能锻造' : props.stage === 'done' ? '吸收完成' : '经验吸收'))
/** 外圈进度弧：r=150 的整圆周长 */
const RING_C = 2 * Math.PI * 150
const ringDash = computed(() => `${(RING_C * pct.value) / 100} ${RING_C}`)

const sealed = computed(() => props.forging || props.stage === 'done')

function hex(cx, cy, r) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i - Math.PI / 6
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`
  }).join(' ')
}
</script>

<template>
  <div class="forge" :class="{ forging }" aria-hidden="true">
    <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="xMidYMid slice" class="stage">
      <defs>
        <radialGradient id="core-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" :stop-color="sealed ? 'rgba(51,204,136,0.55)' : 'rgba(0,229,255,0.45)'" />
          <stop offset="60%" :stop-color="sealed ? 'rgba(51,204,136,0.12)' : 'rgba(0,229,255,0.1)'" />
          <stop offset="100%" stop-color="rgba(0,229,255,0)" />
        </radialGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" :stop-color="sealed ? 'rgba(51,204,136,0.75)' : 'rgba(0,229,255,0.55)'" />
          <stop offset="100%" stop-color="rgba(0,229,255,0.04)" />
        </linearGradient>
        <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="7" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <!-- 透视地网 -->
      <g class="floor">
        <line v-for="i in 22" :key="`fv${i}`" :x1="i * 74 - 40" y1="880" :x2="CX + (i * 74 - 40 - CX) * 0.28" :y2="470" />
        <line v-for="i in 7" :key="`fh${i}`" x1="0" :y1="880 - i * i * 15" :x2="W" :y2="880 - i * i * 15" />
      </g>

      <!-- 思路来源 → 核心 -->
      <g class="feeds">
        <path
          v-for="s in sources"
          :key="`p${s.key}`"
          :class="['feed', { on: s.on }]"
          :d="s.path"
          :style="{ animationDelay: s.delay }"
        />
      </g>

      <g v-for="s in sources" :key="s.key" :class="['src', { on: s.on }]">
        <polygon class="src-mark" :points="hex(96, s.y, 21)" />
        <text class="src-mark-t" x="96" :y="s.y + 5" text-anchor="middle">{{ s.n }}</text>
        <text class="src-name" x="136" :y="s.y - 11">{{ s.name }}</text>
        <text class="src-desc" x="136" :y="s.y + 12">{{ s.desc }}</text>
        <line class="src-rule" x1="136" :y1="s.y + 24" x2="300" :y2="s.y + 24" />
      </g>

      <!-- 锻造核心 -->
      <g :class="['core', { sealed }]">
        <circle class="halo" :cx="CX" :cy="CY" r="210" fill="url(#core-glow)" />
        <g class="ring-a" :style="{ transformOrigin: `${CX}px ${CY}px` }">
          <circle class="ring dashed" :cx="CX" :cy="CY" r="176" />
        </g>
        <g class="ring-b" :style="{ transformOrigin: `${CX}px ${CY}px` }">
          <circle class="ring ticks" :cx="CX" :cy="CY" r="150" />
        </g>
        <circle class="ring track" :cx="CX" :cy="CY" r="150" />
        <circle
          class="ring prog"
          :cx="CX"
          :cy="CY"
          r="150"
          :stroke-dasharray="ringDash"
          :transform="`rotate(-90 ${CX} ${CY})`"
        />
        <polygon class="core-hex" :points="hex(CX, CY, 108)" filter="url(#soft)" />
        <polygon class="core-hex inner" :points="hex(CX, CY, 84)" />
        <text class="core-pct" :x="CX" :y="CY + 8" text-anchor="middle">{{ pct }}<tspan class="core-pct-u">%</tspan></text>
        <text class="core-label" :x="CX" :y="CY + 40" text-anchor="middle">{{ coreLabel }}</text>
        <text class="core-cap" :x="CX" :y="CY - 128" text-anchor="middle">处置经验 · 结构化</text>
      </g>

      <!-- 核心 → 技能包 -->
      <path class="beam" :d="`M ${CX + 112} ${CY} L ${PACK_X} ${CY}`" stroke="url(#beam)" />
      <g class="spark"><circle :cx="CX + 120" :cy="CY" r="5" /></g>

      <!-- 技能包 -->
      <g :class="['pack', { sealed }]">
        <polyline
          class="pack-frame"
          :points="`${PACK_X},232 ${PACK_R},232 ${PACK_R},668 ${PACK_X},668`"
        />
        <line class="pack-edge" :x1="PACK_X" y1="232" :x2="PACK_X" y2="668" />
        <text class="pack-kicker" x="900" y="272">可复用技能包</text>
        <text class="pack-id" x="900" y="306">{{ skillId || 'skill-package' }}</text>

        <g v-for="f in fileRows" :key="f.key" :class="['file', { on: f.on }]">
          <rect class="file-chip" x="900" :y="f.y - 15" width="20" height="22" rx="2" />
          <line class="file-chip-l" x1="905" :y1="f.y - 9" x2="915" :y2="f.y - 9" />
          <line class="file-chip-l" x1="905" :y1="f.y - 4" x2="915" :y2="f.y - 4" />
          <line class="file-chip-l" x1="905" :y1="f.y + 1" x2="911" :y2="f.y + 1" />
          <text class="file-name" x="932" :y="f.y">{{ f.label }}</text>
        </g>

        <line class="pack-rule" x1="900" y1="576" x2="1224" y2="576" />
        <text class="pack-meta" x="900" y="604">{{ intersection }}</text>
        <text class="pack-meta dim" x="900" y="630">{{ period }} · 同类路口可直接调用</text>
      </g>

      <!-- 落在核心与技能包之间，左边留给左下角讲解头像的字幕气泡 -->
      <text class="caption" x="760" y="792" text-anchor="middle">
        一次处置的分析思路，写成系统可执行的技能
      </text>
    </svg>
  </div>
</template>

<style scoped>
.forge {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
}
.stage { width: 100%; height: 100%; display: block; }

/* 进入锻造阶段后左右两侧被抽屉占满，主视觉退成环境光，避免被裁一半 */
.forge .pack,
.forge .caption,
.forge .src,
.forge .feeds,
.forge .core,
.forge .beam,
.forge .spark {
  transition: opacity 0.6s ease;
}
.forge.forging .pack,
.forge.forging .caption,
.forge.forging .beam,
.forge.forging .spark {
  opacity: 0;
}
.forge.forging .src,
.forge.forging .feeds,
.forge.forging .core {
  opacity: 0.3;
}

.floor line { stroke: rgba(0, 229, 255, 0.055); stroke-width: 1; }

.feed {
  fill: none;
  stroke: rgba(0, 229, 255, 0.14);
  stroke-width: 1.4;
  stroke-dasharray: 5 13;
}
.feed.on {
  stroke: rgba(0, 229, 255, 0.65);
  stroke-width: 1.8;
  animation: flow 1.5s linear infinite;
}
@keyframes flow {
  to { stroke-dashoffset: -36; }
}

.src { opacity: 0.3; transition: opacity 0.6s ease; }
.src.on { opacity: 1; }
.src-mark { fill: rgba(0, 229, 255, 0.07); stroke: rgba(0, 229, 255, 0.35); stroke-width: 1.2; }
.src.on .src-mark { fill: rgba(0, 229, 255, 0.18); stroke: var(--cyan); }
.src-mark-t { font-size: 15px; font-family: var(--font-mono); fill: rgba(160, 200, 220, 0.7); }
.src.on .src-mark-t { fill: var(--cyan); }
.src-name { font-size: 19px; fill: rgba(226, 244, 255, 0.9); letter-spacing: 2px; }
.src-desc { font-size: 13px; fill: rgba(160, 200, 220, 0.55); }
.src-rule { stroke: rgba(0, 229, 255, 0.16); }
.src.on .src-rule { stroke: rgba(0, 229, 255, 0.34); }

.ring { fill: none; }
.ring.dashed { stroke: rgba(0, 229, 255, 0.2); stroke-width: 1; stroke-dasharray: 3 22; }
.ring.ticks { stroke: rgba(0, 229, 255, 0.16); stroke-width: 6; stroke-dasharray: 2 30; }
.ring.track { stroke: rgba(0, 229, 255, 0.12); stroke-width: 2.5; }
.ring.prog {
  stroke: var(--cyan);
  stroke-width: 2.5;
  stroke-linecap: round;
  filter: drop-shadow(0 0 8px rgba(0, 229, 255, 0.7));
  transition: stroke-dasharray 0.7s ease;
}
.core.sealed .ring.prog { stroke: var(--ok); filter: drop-shadow(0 0 10px rgba(51, 204, 136, 0.8)); }
.ring-a { animation: spin 46s linear infinite; }
.ring-b { animation: spin 30s linear infinite reverse; }
@keyframes spin {
  to { transform: rotate(360deg); }
}

.core-hex {
  fill: rgba(0, 90, 130, 0.16);
  stroke: rgba(0, 229, 255, 0.4);
  stroke-width: 1.4;
  animation: breathe 3.6s ease-in-out infinite;
  transform-origin: center;
}
.core-hex.inner { fill: rgba(2, 20, 36, 0.62); stroke: rgba(0, 229, 255, 0.22); animation: none; }
.core.sealed .core-hex { stroke: rgba(51, 204, 136, 0.5); }
@keyframes breathe {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}
.core-pct { font-size: 62px; font-family: var(--font-mono); fill: var(--cyan); letter-spacing: -1px; }
.core.sealed .core-pct { fill: var(--ok); }
.core-pct-u { font-size: 24px; fill: rgba(160, 200, 220, 0.6); }
.core-label { font-size: 14px; letter-spacing: 6px; fill: rgba(160, 200, 220, 0.7); }
.core-cap { font-size: 12px; letter-spacing: 5px; fill: rgba(240, 246, 255, 0.6); }
.halo { animation: breathe 5s ease-in-out infinite; }

.beam { stroke-width: 2; fill: none; }
.spark circle {
  fill: rgba(240, 246, 255, 0.92);
  filter: drop-shadow(0 0 7px rgba(0, 229, 255, 0.9));
  animation: travel 2.4s linear infinite;
}
@keyframes travel {
  0% { transform: translateX(0); opacity: 0; }
  12% { opacity: 1; }
  88% { opacity: 1; }
  100% { transform: translateX(140px); opacity: 0; }
}

.pack-frame, .pack-edge { fill: none; stroke: rgba(0, 229, 255, 0.22); stroke-width: 1.2; }
.pack.sealed .pack-frame { stroke: rgba(51, 204, 136, 0.5); }
.pack-edge { stroke-dasharray: 4 6; }
.pack-kicker { font-size: 12px; letter-spacing: 6px; fill: rgba(240, 246, 255, 0.7); }
.pack-id { font-size: 18px; font-family: var(--font-mono); fill: rgba(226, 244, 255, 0.9); }
.pack.sealed .pack-id { fill: var(--ok); }
.pack-rule { stroke: rgba(0, 229, 255, 0.16); }
.pack-meta { font-size: 14px; fill: rgba(190, 220, 236, 0.72); }
.pack-meta.dim { font-size: 12.5px; fill: rgba(160, 200, 220, 0.45); }

.file { opacity: 0.24; transition: opacity 0.5s ease; }
.file.on { opacity: 1; }
.file-chip { fill: rgba(0, 229, 255, 0.07); stroke: rgba(0, 229, 255, 0.3); stroke-width: 1; }
.file.on .file-chip { fill: rgba(0, 229, 255, 0.16); stroke: var(--cyan); }
.file-chip-l { stroke: rgba(0, 229, 255, 0.45); stroke-width: 1; }
.file-name { font-size: 14px; font-family: var(--font-mono); fill: rgba(200, 230, 246, 0.8); }

.caption { font-size: 15px; letter-spacing: 3px; fill: rgba(150, 190, 212, 0.5); }

@media (prefers-reduced-motion: reduce) {
  .feed.on, .ring-a, .ring-b, .core-hex, .halo, .spark circle { animation: none; }
}
</style>
