<script setup>
/**
 * 渠化变化示意动画（成因幕弹窗配图）：
 * SVG 重绘「奥体西路（纵贯）× 解放东路（上/北）× 经十路（下/南）」双路口示意，
 * 上北下南正常方位：道路图形用横版本地坐标绘制后整体顺时针旋转 90°（北从左转到上），
 * 文字/徽标等标注不随旋转，在竖版新坐标系单独排版保持正向；
 * 两处交叉口按路口形态绘制（斑马线 + 四向进口停止线）；
 * 断面按真实渠化：路段北向南 3 车道（每道 30px）+ 中央绿化带（24px）+ 南向北 3 车道；
 * 进口段压缩绿化带至 4px，北向南拓宽为 5 车道（每道 22px，车道收窄），
 * 对向（南向北）车道完全不压缩；新增左转车道贴绿化带侧。
 * 渠化渐变段距经十路口约 100m（路段约 1/3 处）；进口 5 车道为
 * 左转×2（贴绿化带）+ 直行×2 + 右转×1（最外侧）；排队阶段表现渠化影响：
 * 车辆从上游一辆辆驶入依次减速停下，拓宽区短，左转车排满后溢出
 * 占用最左直行道，直行通行效率下降（无循环车流）。
 * 分镜跟 a2f.channel_change 口播逐句对齐——
 *   红框强调渠化变化点 → 3 车道拓宽为 5 车道（绿化带压缩 + 车道线生长）→ 通行能力变化 →
 *   两路口周期 200s/220s 交替高亮 + 信号灯错位 → 排队溢出堆积。
 * 节点时间按文案字数比例从口播时长推导；自动化/降动效环境直接落终态。
 */
import { onMounted, onUnmounted, ref } from 'vue';
import { prefersInstant } from '../../../shared/useSceneBeats.js';

const props = defineProps({
  /** 口播实际时长（秒）；0 时按 18.5s 兜底 */
  durationSec: { type: Number, default: 0 },
});

const SCRIPT =
  '奥体西路经十路北向南路段，100米处道路渠化由3车道拓宽为5车道，通行能力发生变化。'
  + '解放东路路口红绿灯周期200秒，经十路路口220秒，两个路口红绿灯周期不协调，容易导致排队溢出。';

/** 分镜节点：口播念到第 chars 字时触发（按字数比例换算成秒） */
const NODES = [
  { key: 'redbox', chars: 13 }, // 「…北向南路段，」后 → 红框 + 100m 标注
  { key: 'widen', chars: 18 }, // 「100米处道路渠化」→ 拓宽线生长
  { key: 'capacity', chars: 36 }, // 「通行能力…」→ 通行能力徽标
  { key: 'cycleLeft', chars: 42 }, // 后半句开始 → 解放东路周期高亮
  { key: 'cycleRight', chars: 58 }, // 「经十路…220秒」→ 经十路周期高亮
  { key: 'mismatch', chars: 68 }, // 「不协调」→ 信号灯红绿错位
  { key: 'queue', chars: 81 }, // 「容易导致排队溢出」→ 排队块堆积
];

const stage = ref(0);
let timers = [];

onMounted(() => {
  if (prefersInstant()) {
    stage.value = NODES.length;
    return;
  }
  const dur = Math.max(6, props.durationSec || 18.5);
  NODES.forEach((node, i) => {
    timers.push(setTimeout(() => {
      stage.value = i + 1;
    }, (node.chars / SCRIPT.length) * dur * 1000));
  });
});

onUnmounted(() => {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
});

function has(key) {
  const i = NODES.findIndex((n) => n.key === key);
  return i >= 0 && stage.value >= i + 1;
}

/** 排队车队（小汽车模型）：车辆从上游一辆辆驶入、依次减速停到位（靠停止线的先停） */
const DRIVE_IN = 400; // 默认驶入距离（px）：从队列位后方开来
const DRIVE_SPEED = 220; // 驶入速度（px/s），按距离换算行驶时长
const queueCarGroups = [
  { cars: [944, 904, 864, 824], y: 340, delay: 0, step: 0.5, turn: true, from: 740 }, // 左转道1：从拓宽区入口驶入
  { cars: [944, 904, 864, 824], y: 362, delay: 0.25, step: 0.5, turn: true, from: 740 }, // 左转道2：从拓宽区入口驶入
  { cars: [944, 904, 864, 824, 784, 744], y: 384, delay: 0.9, step: 0.5, turn: true }, // 溢出占最左直行道（进口/渐变段）
  { cars: [704, 664, 624, 584], y: 364, delay: 1.8, step: 0.5, turn: true }, // 溢出延伸出拓宽区，占用路段最内侧直行道
  { cars: [944, 904, 864, 824, 784, 744, 704, 664, 624, 584], y: 406, delay: 1.2, step: 0.35, turn: false }, // 直行道2 被堵排队向路段蔓延
  { cars: [704, 664, 624, 584], y: 428, delay: 2.0, step: 0.5, turn: false }, // 外侧直行道排队蔓延（进口右转道畅通不排）
];

/** 斑马线条纹（路口形态；坐标为旋转前本地坐标，本地左/右路口即旋转后上/下路口）：
 *  横跨纵向路的横排（竖条纹）与横跨横向路的竖排（横条纹） */
const zebraNS = Array.from({ length: 13 }, (_, i) => 132 + i * 5.7); // 上(本地左)路口北/南
const zebraNS2 = Array.from({ length: 13 }, (_, i) => 1002 + i * 5.7); // 下(本地右)路口北/南
const zebraEW = Array.from({ length: 21 }, (_, i) => 240 + i * 9.5); // 上/下路口西/东
</script>

<template>
  <svg
    class="channel-diagram"
    viewBox="0 0 780 1200"
    preserveAspectRatio="xMidYMid meet"
    role="img"
    aria-label="奥体西路北向南渠化拓宽示意图：距经十路口100米处由3车道拓宽为5车道，两路口周期200秒与220秒不协调"
  >
    <!-- 道路图形整体顺时针旋转 90°（上北下南）：本地 (x,y) → 屏幕 (722-y, x)；
         动画（拓宽生长/排队驶入/红框脉冲）均在本地坐标运转，旋转后方向自动正确 -->
    <g transform="translate(722 0) rotate(90)">
    <!-- ── 底图路网（本地横版坐标）────────────────────────────── -->
    <!-- 奥体西路（本地横向）：南向北 4 车道（上）+ 中央绿化带 + 北向南 3→5 车道（下）；
         旋转后南向北在东半幅、北向南在西半幅（右侧通行，车流自上而下） -->
    <rect class="pave" x="40" y="218" width="1120" height="228" />
    <!-- 解放东路（本地左，旋转后上/北端）/ 经十路（本地右，旋转后下/南端） -->
    <rect class="pave" x="130" y="-58" width="76" height="780" />
    <rect class="pave" x="1000" y="-58" width="76" height="780" />

    <!-- 道路外缘（北向南外缘 y=446 全程固定，拓宽不吃对向） -->
    <line class="edge" x1="40" y1="218" x2="1160" y2="218" />
    <line class="edge" x1="40" y1="446" x2="994" y2="446" />
    <line class="edge" x1="130" y1="-58" x2="130" y2="218" />
    <line class="edge" x1="206" y1="-58" x2="206" y2="218" />
    <line class="edge" x1="130" y1="446" x2="130" y2="722" />
    <line class="edge" x1="206" y1="446" x2="206" y2="722" />
    <line class="edge" x1="1000" y1="-58" x2="1000" y2="218" />
    <line class="edge" x1="1076" y1="-58" x2="1076" y2="218" />
    <line class="edge" x1="1000" y1="446" x2="1000" y2="722" />
    <line class="edge" x1="1076" y1="446" x2="1076" y2="722" />

    <!-- 中央绿化带（路段 24px；渐变段起压缩至 4px，widen 动画） -->
    <rect class="greenbelt" x="206" y="332" width="529" height="24" />
    <g class="green-out" :class="{ out: has('widen') }">
      <rect class="greenbelt" x="735" y="332" width="259" height="24" />
      <line class="greenbelt-curb" x1="735" y1="356" x2="994" y2="356" />
    </g>
    <line class="greenbelt-curb" x1="206" y1="332" x2="994" y2="332" />
    <line class="greenbelt-curb" x1="206" y1="356" x2="735" y2="356" />

    <!-- 纵向路中线 -->
    <line class="median" x1="164" y1="-58" x2="164" y2="218" />
    <line class="median" x1="172" y1="-58" x2="172" y2="218" />
    <line class="median" x1="164" y1="446" x2="164" y2="722" />
    <line class="median" x1="172" y1="446" x2="172" y2="722" />
    <line class="median" x1="1034" y1="-58" x2="1034" y2="218" />
    <line class="median" x1="1042" y1="-58" x2="1042" y2="218" />
    <line class="median" x1="1034" y1="446" x2="1034" y2="722" />
    <line class="median" x1="1042" y1="446" x2="1042" y2="722" />

    <!-- 车道虚线：南向北 3 车道（全程不压缩，不受拓宽挤压） -->
    <line class="lane-dash" x1="206" y1="256" x2="1000" y2="256" />
    <line class="lane-dash" x1="206" y1="294" x2="1000" y2="294" />
    <!-- 北向南 3 车道边界（渐变段 x735 起被 5 车道网格替换） -->
    <line class="lane-dash" x1="206" y1="386" x2="735" y2="386" />
    <line class="lane-dash" x1="206" y1="416" x2="735" y2="416" />
    <g class="lane-out" :class="{ out: has('widen') }">
      <line class="lane-dash" x1="735" y1="386" x2="994" y2="386" />
      <line class="lane-dash" x1="735" y1="416" x2="994" y2="416" />
    </g>
    <!-- 纵向路半幅车道线（避开中线） -->
    <line class="lane-dash" x1="130" y1="80" x2="162" y2="80" />
    <line class="lane-dash" x1="174" y1="80" x2="206" y2="80" />
    <line class="lane-dash" x1="130" y1="584" x2="162" y2="584" />
    <line class="lane-dash" x1="174" y1="584" x2="206" y2="584" />
    <line class="lane-dash" x1="1000" y1="80" x2="1032" y2="80" />
    <line class="lane-dash" x1="1044" y1="80" x2="1076" y2="80" />
    <line class="lane-dash" x1="1000" y1="584" x2="1032" y2="584" />
    <line class="lane-dash" x1="1044" y1="584" x2="1076" y2="584" />

    <!-- ── 路口形态：斑马线 + 四向进口停止线 ──────────────────── -->
    <!-- 左路口（解放东路 × 奥体西路） -->
    <g class="zebra">
      <rect v-for="(x, i) in zebraNS" :key="`ln-${i}`" :x="x" y="222" width="3.5" height="14" />
      <rect v-for="(x, i) in zebraNS" :key="`ls-${i}`" :x="x" y="428" width="3.5" height="14" />
      <rect v-for="(y, i) in zebraEW" :key="`lw-${i}`" x="134" :y="y" width="14" height="3.5" />
      <rect v-for="(y, i) in zebraEW" :key="`le-${i}`" x="188" :y="y" width="14" height="3.5" />
    </g>
    <!-- 右路口（经十路 × 奥体西路） -->
    <g class="zebra">
      <rect v-for="(x, i) in zebraNS2" :key="`rn-${i}`" :x="x" y="222" width="3.5" height="14" />
      <rect v-for="(x, i) in zebraNS2" :key="`rs-${i}`" :x="x" y="428" width="3.5" height="14" />
      <rect v-for="(y, i) in zebraEW" :key="`rw-${i}`" x="1004" :y="y" width="14" height="3.5" />
      <rect v-for="(y, i) in zebraEW" :key="`re-${i}`" x="1058" :y="y" width="14" height="3.5" />
    </g>
    <!-- 进口停止线 -->
    <line class="stopline" x1="118" y1="356" x2="118" y2="446" />
    <line class="stopline" x1="222" y1="218" x2="222" y2="332" />
    <line class="stopline" x1="132" y1="212" x2="162" y2="212" />
    <line class="stopline" x1="174" y1="452" x2="204" y2="452" />
    <line class="stopline" x1="996" y1="356" x2="996" y2="446" />
    <line class="stopline" x1="1092" y1="218" x2="1092" y2="332" />
    <line class="stopline" x1="1002" y1="212" x2="1032" y2="212" />
    <line class="stopline" x1="1044" y1="452" x2="1074" y2="452" />

    <!-- 导向箭头（本地坐标）：北向南 3 车道段（朝右，旋转后朝下）；南向北 3 车道（朝左，旋转后朝上） -->
    <g class="arrow">
      <path d="M350 371 h34 m-10 -8 l10 8 l-10 8" />
      <path d="M350 401 h34 m-10 -8 l10 8 l-10 8" />
      <path d="M350 431 h34 m-10 -8 l10 8 l-10 8" />
      <path d="M560 371 h34 m-10 -8 l10 8 l-10 8" />
      <path d="M560 401 h34 m-10 -8 l10 8 l-10 8" />
      <path d="M560 431 h34 m-10 -8 l10 8 l-10 8" />
      <path d="M620 237 h-34 m10 -8 l-10 8 l10 8" />
      <path d="M620 275 h-34 m10 -8 l-10 8 l10 8" />
      <path d="M620 313 h-34 m10 -8 l-10 8 l10 8" />
    </g>

    <!-- ── 拓宽动画（widen 阶段，渐变段 x735→885 即旋转后 y735→885，距经十路口约100m/路段1/3处）── -->
    <!-- 绿化带压缩 + 5 车道（每道 22px）网格从渐变段向路口生长 -->
    <g class="widen-lines" :class="{ on: has('widen') }">
      <!-- 压缩后绿化带（渐变段平滑收窄至 4px 窄带） -->
      <path class="greenbelt" d="M735 332 L994 332 L994 336 L885 336 C825 336 795 356 735 356 Z" />
      <path class="greenbelt-curve" d="M735 356 C795 356 825 336 885 336 L994 336" />
      <!-- 新增长车道绿色高亮（贴绿化带侧 2 条左转车道，336-380） -->
      <path
        class="widen-glow"
        d="M735 356 C795 356 825 336 885 336 L994 336 L994 380 L885 380 C825 380 795 386 735 386 Z"
      />
      <!-- 渐变段车道边界（分叉过渡）：3 车道网格 → 5 车道网格 -->
      <path class="lane-dash" d="M735 356 C795 356 825 358 885 358" />
      <path class="lane-dash" d="M735 386 C795 386 825 380 885 380" />
      <path class="lane-dash" d="M735 386 C795 386 825 402 885 402" />
      <path class="lane-dash" d="M735 416 C795 416 825 424 885 424" />
      <!-- 进口道实线网格（5 车道渠化段，每道 22px，禁止变道） -->
      <line class="lane-solid" x1="885" y1="358" x2="994" y2="358" />
      <line class="lane-solid" x1="885" y1="380" x2="994" y2="380" />
      <line class="lane-solid" x1="885" y1="402" x2="994" y2="402" />
      <line class="lane-solid" x1="885" y1="424" x2="994" y2="424" />
      <!-- 经十路口停止线延长（覆盖新车道） -->
      <line class="stopline" x1="996" y1="336" x2="996" y2="356" />
      <!-- 新增左转车道箭头（贴绿化带侧；旋转后向下行驶 → 转向右/东） -->
      <path d="M905 347 h16 v-10 m0 0 l-6 7 m6 -7 l6 7" class="turn-arrow" />
      <path d="M905 369 h16 v-10 m0 0 l-6 7 m6 -7 l6 7" class="turn-arrow" />
      <!-- 最右车道：右转箭头（旋转后向下行驶 → 转向左/西） -->
      <path d="M905 430 h16 v10 m0 0 l-6 -7 m6 7 l6 -7" class="turn-arrow" />
      <!-- 进口段直行箭头（5 车道网格对齐，直行 2 条） -->
      <path d="M905 391 h34 m-10 -8 l10 8 l-10 8" class="arrow-turn" />
      <path d="M905 413 h34 m-10 -8 l10 8 l-10 8" class="arrow-turn" />
    </g>

    <!-- ── 红框强调（redbox 阶段，罩住渠化渐变段）────────── -->
    <g class="redbox" :class="{ on: has('redbox') }">
      <rect x="723" y="318" width="174" height="136" rx="8" />
    </g>

    <!-- 100m 距离标注（渠化渐变起点 → 经十路口；线与双向箭头随图旋转成纵向） -->
    <g class="dist-100" :class="{ on: has('redbox') }">
      <line x1="737" y1="540" x2="992" y2="540" />
      <path d="M745 536 l-8 4 l8 4" />
      <path d="M984 536 l8 4 l-8 4" />
    </g>

    <!-- ── 排队溢出（queue 阶段）：车辆从上游（本地左侧，旋转后上方）一辆辆驶入、依次减速停到位 ── -->
    <g class="queue-cars">
      <template v-for="(grp, gi) in queueCarGroups" :key="gi">
        <g
          v-for="(x, i) in grp.cars"
          :key="`${gi}-${i}`"
          class="queue-car"
          :class="[grp.turn ? 'queue-turn' : 'queue-thru', { arrive: has('queue') }]"
          :style="{
            '--x0': `${grp.from ?? x - DRIVE_IN}px`,
            '--x1': `${x}px`,
            '--y': `${grp.y}px`,
            transitionDelay: `${grp.delay + i * grp.step}s`,
            transitionDuration: `${Math.max(0.7, (x - (grp.from ?? x - DRIVE_IN)) / DRIVE_SPEED).toFixed(2)}s`,
          }"
        >
          <rect class="qc-body" width="26" height="13" rx="4" />
          <rect class="qc-glass" x="5" y="2.5" width="3" height="8" rx="1" />
          <rect class="qc-glass" x="18" y="2.5" width="3" height="8" rx="1" />
        </g>
      </template>
    </g>
    </g><!-- /顺时针旋转 90° 的道路图形组 -->

    <!-- ── 以下标注不随图形旋转，在上北下南竖版坐标系单独排版保持正向 ── -->
    <!-- 100m 距离标注文字（纵线顶端上方，道路左侧） -->
    <g class="dist-100" :class="{ on: has('redbox') }">
      <text x="177" y="716" text-anchor="middle">距经十路口 100m</text>
    </g>

    <!-- ── 徽标：车道数 / 通行能力（道路右侧，对齐拓宽段高度）── -->
    <g class="badge-capacity" :class="{ on: has('capacity') }">
      <rect x="516" y="742" width="200" height="38" rx="6" />
      <text x="616" y="768" text-anchor="middle">通行能力变化</text>
    </g>
    <g class="badge-lanes" :class="{ on: has('widen') }">
      <rect x="516" y="794" width="200" height="40" rx="6" />
      <text x="616" y="822" text-anchor="middle">3 → 5 车道</text>
    </g>

    <!-- ── 周期标签 + 信号灯 ──────────────────────────────────── -->
    <g class="cyc-tag cyc-left" :class="{ on: has('cycleLeft') }">
      <rect x="277" y="16" width="226" height="42" rx="6" />
      <text x="390" y="43" text-anchor="middle">解放东路 · 周期 200s</text>
    </g>
    <g class="cyc-tag cyc-right" :class="{ on: has('cycleRight') }">
      <rect x="277" y="1120" width="226" height="42" rx="6" />
      <text x="390" y="1147" text-anchor="middle">经十路 · 周期 220s</text>
    </g>

    <g class="lamps" :class="{ mismatch: has('mismatch') }">
      <!-- 上：解放东路（路口东北侧路外） -->
      <g class="lamp lamp-left">
        <rect x="572" y="58" width="18" height="50" rx="4" />
        <circle class="l-red" cx="581" cy="70" r="5.5" />
        <circle class="l-yellow" cx="581" cy="83" r="5.5" />
        <circle class="l-green" cx="581" cy="96" r="5.5" />
      </g>
      <!-- 下：经十路（路口东南侧路外） -->
      <g class="lamp lamp-right">
        <rect x="572" y="1096" width="18" height="50" rx="4" />
        <circle class="l-red" cx="581" cy="1108" r="5.5" />
        <circle class="l-yellow" cx="581" cy="1121" r="5.5" />
        <circle class="l-green" cx="581" cy="1134" r="5.5" />
      </g>
    </g>

    <!-- 排队影响说明（queue 阶段淡入，图底部居中） -->
    <g class="queue-note" :class="{ on: has('queue') }">
      <text x="390" y="1186" text-anchor="middle">左转排队溢出占用直行车道，直行通行效率下降</text>
    </g>

    <!-- ── 静态标注 ───────────────────────────────────────────── -->
    <text class="road-name" x="602" y="300" text-anchor="middle">奥体西路</text>
    <text class="road-name road-sub" x="70" y="118" text-anchor="middle">解放东路</text>
    <text class="road-name road-sub" x="70" y="1096" text-anchor="middle">经十路</text>
    <text class="flow-hint" x="189" y="330" text-anchor="middle">北向南 ↓</text>
  </svg>
</template>

<style scoped>
.channel-diagram {
  display: block;
  width: 100%;
  height: 100%;
  font-family: 'PingFang SC', 'Microsoft YaHei', sans-serif;
}

.pave {
  fill: #232e3b;
}

.edge {
  stroke: rgba(236, 243, 250, 0.75);
  stroke-width: 2;
}

.median {
  stroke: #e6c34d;
  stroke-width: 2.5;
}

/* 中央绿化带：路段 24px，进口压缩至 4px（拓宽不吃对向） */
.greenbelt {
  fill: #2f6b45;
}
.greenbelt-curb {
  stroke: rgba(236, 243, 250, 0.75);
  stroke-width: 2;
}
.greenbelt-curve {
  fill: none;
  stroke: rgba(236, 243, 250, 0.75);
  stroke-width: 2;
}

.lane-dash {
  stroke: rgba(236, 243, 250, 0.7);
  stroke-width: 1.6;
  stroke-dasharray: 14 10;
}

/* 进口道渠化段实线（拓宽后 5 车道段，禁止变道） */
.lane-solid {
  stroke: rgba(236, 243, 250, 0.85);
  stroke-width: 2;
}

.stopline {
  stroke: rgba(236, 243, 250, 0.9);
  stroke-width: 4;
}

/* 斑马线 */
.zebra rect {
  fill: rgba(236, 243, 250, 0.55);
}

.arrow path,
.arrow-turn,
.turn-arrow {
  fill: none;
  stroke: rgba(236, 243, 250, 0.85);
  stroke-width: 2.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* 小汽车造型：车身 + 前后挡风玻璃 */
.qc-body {
  fill: #ff5252;
}
.queue-turn .qc-body {
  fill: #ff9f43;
}
.queue-thru .qc-body {
  fill: #ff5252;
}
.qc-glass {
  fill: rgba(16, 26, 36, 0.6);
}

/* 拓宽：路段绿化带/车道线让位（淡出），新元素从渐变段向路口生长 */
.green-out,
.lane-out {
  transition: opacity 0.7s ease 0.2s;
}
.green-out.out,
.lane-out.out {
  opacity: 0;
}

.widen-lines {
  clip-path: inset(-30px 100% -30px 0);
  transition: clip-path 2.6s linear 0.25s;
}
.widen-lines.on {
  clip-path: inset(-30px 0% -30px 0);
}

.widen-glow {
  fill: rgba(46, 204, 113, 0.16);
}

/* 红框脉冲 */
.redbox {
  opacity: 0;
  transition: opacity 0.5s ease;
}
.redbox.on {
  opacity: 1;
}
.redbox rect {
  fill: rgba(255, 82, 82, 0.05);
  stroke: #ff5252;
  stroke-width: 3;
  animation: redbox-pulse 1.6s ease-in-out infinite;
}
@keyframes redbox-pulse {
  0%, 100% { stroke-opacity: 0.45; fill-opacity: 0.3; }
  50% { stroke-opacity: 1; fill-opacity: 1; }
}

/* 100m 距离标注 */
.dist-100 {
  opacity: 0;
  transition: opacity 0.5s ease 0.25s;
}
.dist-100.on {
  opacity: 1;
}
.dist-100 line {
  stroke: #ffd666;
  stroke-width: 1.6;
}
.dist-100 path {
  fill: none;
  stroke: #ffd666;
  stroke-width: 1.6;
  stroke-linecap: round;
}
.dist-100 text {
  fill: #ffd666;
  font-size: 21px;
  letter-spacing: 1px;
}

/* 徽标 */
.badge-lanes,
.badge-capacity {
  opacity: 0;
  transform: translateY(6px);
  transition: opacity 0.5s ease, transform 0.5s ease;
}
.badge-lanes.on,
.badge-capacity.on {
  opacity: 1;
  transform: translateY(0);
}
.badge-lanes rect {
  fill: rgba(255, 82, 82, 0.14);
  stroke: #ff5252;
  stroke-width: 1.6;
}
.badge-lanes text {
  fill: #ffd6d6;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 2px;
}
.badge-capacity rect {
  fill: rgba(62, 207, 142, 0.12);
  stroke: #3ecf8e;
  stroke-width: 1.6;
}
.badge-capacity text {
  fill: #b7f2d8;
  font-size: 22px;
  font-weight: 600;
  letter-spacing: 2px;
}

/* 周期标签 */
.cyc-tag rect {
  fill: rgba(6, 16, 28, 0.7);
  stroke: rgba(0, 200, 230, 0.35);
  stroke-width: 1.4;
  transition: stroke 0.4s ease, filter 0.4s ease;
}
.cyc-tag text {
  fill: rgba(220, 232, 244, 0.9);
  font-size: 21px;
  letter-spacing: 1px;
  transition: fill 0.4s ease;
}
.cyc-tag.on rect {
  stroke: #ffd666;
  filter: drop-shadow(0 0 6px rgba(255, 214, 102, 0.45));
}
.cyc-tag.on text {
  fill: #ffd666;
}

/* 信号灯：默认双绿；mismatch 阶段左右红绿交替错位 */
.lamp rect {
  fill: #0b1118;
  stroke: rgba(236, 243, 250, 0.4);
  stroke-width: 1.2;
}
.l-red { fill: #ff5252; opacity: 0.15; }
.l-yellow { fill: #ffcf4d; opacity: 0.15; }
.l-green { fill: #3ecf8e; opacity: 1; }

.lamps.mismatch .lamp-left .l-green { animation: lamp-a 2.4s linear infinite; }
.lamps.mismatch .lamp-left .l-red { animation: lamp-b 2.4s linear infinite; }
.lamps.mismatch .lamp-right .l-green { animation: lamp-b 2.4s linear infinite; }
.lamps.mismatch .lamp-right .l-red { animation: lamp-a 2.4s linear infinite; }
@keyframes lamp-a {
  0%, 49.9% { opacity: 1; }
  50%, 100% { opacity: 0.15; }
}
@keyframes lamp-b {
  0%, 49.9% { opacity: 0.15; }
  50%, 100% { opacity: 1; }
}

/* 排队车队（小汽车模型）：从上游驶入、依次减速停到位（靠停止线的先停）
   —— 起点在队列位后方（左转道从拓宽区入口驶入），到点后减速刹车 */
.queue-car {
  transform: translate(var(--x0), var(--y));
  opacity: 0;
  transition-property: transform;
  transition-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1);
}
.queue-car.arrive {
  transform: translate(var(--x1), var(--y));
  opacity: 1;
  animation: car-pop 0.25s ease;
}
@keyframes car-pop {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* 排队影响说明 */
.queue-note {
  opacity: 0;
  transition: opacity 0.5s ease 4.6s;
}
.queue-note.on {
  opacity: 1;
}
.queue-note text {
  fill: #ff9f43;
  font-size: 20px;
  letter-spacing: 1px;
}

/* 静态标注 */
.road-name {
  fill: rgba(220, 232, 244, 0.92);
  font-size: 24px;
  letter-spacing: 4px;
}
.road-sub {
  font-size: 21px;
  letter-spacing: 2px;
}
.flow-hint {
  fill: rgba(160, 180, 200, 0.75);
  font-size: 19px;
  letter-spacing: 2px;
}
</style>
