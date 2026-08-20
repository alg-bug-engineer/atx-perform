<script setup>
/**
 * 解放东×奥体西汇入示意图：北直 / 东左 / 西右。
 * 箭头为杆+三角一体填充，杆在三角底边收住，避免 marker 叠在线段上。
 */
const props = defineProps({
  ranking: { type: Object, default: null },
});

const ARROW_W = 5;
const HEAD_LEN = 11;
const HEAD_W = 9;
const LANE_Y = 130;
const TIP_Y = 256;
const SOUTH_L = 124;
const SOUTH_C = 140;
const SOUTH_R = 156;

function shareOf(key) {
  const row = props.ranking?.turns?.find((item) => item.turnKey === key);
  const n = Number(row?.share);
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1)}%`;
}

function southHead(x, yTip, fromEast) {
  const baseY = yTip - HEAD_LEN;
  const hw = HEAD_W / 2;
  const half = ARROW_W / 2;
  if (fromEast) {
    return `L ${x + half} ${baseY} L ${x + hw} ${baseY} L ${x} ${yTip} L ${x - hw} ${baseY} L ${x - half} ${baseY}`;
  }
  return `L ${x - half} ${baseY} L ${x - hw} ${baseY} L ${x} ${yTip} L ${x + hw} ${baseY} L ${x + half} ${baseY}`;
}

const northArrow = (() => {
  const x = SOUTH_C;
  const half = ARROW_W / 2;
  return `M ${x - half} 20 L ${x + half} 20 ${southHead(x, TIP_Y, true)} Z`;
})();

const westArrow = (() => {
  const half = ARROW_W / 2;
  const x = SOUTH_L;
  return [
    `M 18 ${LANE_Y - half}`,
    `L ${x + half} ${LANE_Y - half}`,
    southHead(x, TIP_Y, true),
    `L ${x - half} ${LANE_Y + half}`,
    `L 18 ${LANE_Y + half}`,
    'Z',
  ].join(' ');
})();

const eastArrow = (() => {
  const half = ARROW_W / 2;
  const x = SOUTH_R;
  return [
    `M 262 ${LANE_Y - half}`,
    `L ${x - half} ${LANE_Y - half}`,
    southHead(x, TIP_Y, false),
    `L ${x + half} ${LANE_Y + half}`,
    `L 262 ${LANE_Y + half}`,
    'Z',
  ].join(' ');
})();
</script>

<template>
  <section v-if="ranking" class="inflow-schema">
    <header class="schema-head">
      <div class="schema-title">奥体西 × 解放东 · 三向汇入北向南</div>
    </header>

    <svg class="schema-svg" viewBox="0 0 280 300" role="img" aria-label="汇入方向示意图">
      <rect x="118" y="14" width="44" height="272" rx="2" fill="rgba(0,229,255,0.08)" stroke="rgba(0,200,230,0.28)" />
      <rect x="12" y="108" width="256" height="44" rx="2" fill="rgba(0,229,255,0.08)" stroke="rgba(0,200,230,0.28)" />
      <rect x="118" y="108" width="44" height="44" fill="rgba(6,14,26,0.95)" stroke="rgba(0,229,255,0.45)" />

      <text x="168" y="28" fill="rgba(160,180,200,0.85)" font-size="11">北 · 奥体西</text>
      <text x="214" y="102" fill="rgba(160,180,200,0.85)" font-size="11">东 · 解放东</text>
      <text x="16" y="102" fill="rgba(160,180,200,0.85)" font-size="11">西 · 解放东</text>
      <text x="168" y="292" fill="rgba(160,180,200,0.85)" font-size="11">南 · 问题路段</text>

      <path :d="westArrow" fill="#86efac" />
      <path :d="eastArrow" fill="#f5c14b" />
      <path :d="northArrow" fill="#00e5ff" />

      <text x="150" y="50" fill="#00e5ff" font-size="16" font-weight="700">{{ shareOf('north_through') }}</text>
      <text x="150" y="64" fill="rgba(200,220,235,0.9)" font-size="11">北进口直行</text>

      <text x="176" y="168" fill="#f5c14b" font-size="16" font-weight="700">{{ shareOf('east_left') }}</text>
      <text x="176" y="182" fill="rgba(200,220,235,0.9)" font-size="11">东进口左转</text>

      <text x="22" y="168" fill="#86efac" font-size="16" font-weight="700">{{ shareOf('west_right') }}</text>
      <text x="22" y="182" fill="rgba(200,220,235,0.9)" font-size="11">西进口右转</text>
    </svg>
    <p class="schema-legend">
      北直 {{ shareOf('north_through') }} · 东左 {{ shareOf('east_left') }} · 西右 {{ shareOf('west_right') }}
    </p>
  </section>
</template>

<style scoped>
.inflow-schema {
  width: 320px;
  padding: 10px 12px 8px;
  background: rgba(6, 14, 26, 0.92);
  border: 1px solid rgba(0, 200, 230, 0.28);
}

.schema-head {
  display: flex;
  align-items: center;
}

.schema-title {
  font-size: 13px;
  letter-spacing: 0.6px;
  line-height: 1.4;
  color: #ffffff;
}

.schema-svg {
  display: block;
  width: 100%;
  height: auto;
  margin-top: 8px;
}

.schema-legend {
  margin: 6px 0 0;
  font-size: 12px;
  letter-spacing: 0.4px;
  color: rgba(200, 220, 235, 0.88);
}
</style>
