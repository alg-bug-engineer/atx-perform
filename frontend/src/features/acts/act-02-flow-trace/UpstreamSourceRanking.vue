<script setup>
/**
 * 幕 2 · 上游来向比较
 * 左/直/右各取 flow_share_ratio 前 3，按跳数分层；主来向锁定需求口径转向的 hop1 最大份额。
 */
defineProps({
  ranking: { type: Object, default: null },
});

function formatShare(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}

function shortName(name) {
  return String(name || '').replace(/路口$/, '');
}
</script>

<template>
  <section v-if="ranking" class="upstream-rank">
    <header class="rank-head">
      <div class="rank-title">上游来向排行</div>
      <div class="rank-meta">
        <span class="src-chip">PG</span>
        <span>仅 flow_share_ratio · hop≤{{ ranking.maxHop }}</span>
      </div>
    </header>

    <div class="rank-cols">
      <div
        v-for="turn in ranking.turns"
        :key="turn.turnKey"
        class="rank-col"
        :class="{ 'is-primary-turn': turn.isPrimaryTurn }"
      >
        <div class="col-label">
          {{ turn.turnLabel }}
          <span v-if="turn.isPrimaryTurn" class="col-tag">需求口径</span>
        </div>
        <div v-for="group in turn.hops" :key="`${turn.turnKey}-${group.hop}`" class="hop-block">
          <div class="hop-lab">第{{ group.hop }}跳</div>
          <article
            v-for="row in group.rows"
            :key="`${row.interId}-${row.hop}-${row.approachLabel}-${row.movementLabel}`"
            class="rank-row"
            :class="{ 'is-primary': row.isPrimary }"
          >
            <div class="row-name">
              {{ shortName(row.interName) }}
              <span v-if="row.isPrimary" class="primary-tag">主来向</span>
            </div>
            <div class="row-sub">{{ row.approachLabel }} · {{ row.movementLabel }}</div>
            <div class="row-share">{{ formatShare(row.share) }}</div>
            <div class="row-note">{{ row.geometryNote || '关联份额' }}</div>
          </article>
        </div>
      </div>
    </div>

    <p class="rank-conclusion">{{ ranking.conclusion }}</p>
    <p class="rank-foot">主来向按北进口直行、第 1 跳最大份额判定，不是三转向全局最大。份额不是辆/h。地图仍演示主走廊汇入；未映射路径只保留本卡证据。</p>
  </section>
</template>

<style scoped>
.upstream-rank {
  padding: 10px 12px;
  background: rgba(6, 14, 26, 0.9);
  border: 1px solid rgba(0, 200, 230, 0.28);
}

.rank-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.rank-title {
  font-size: 12px;
  letter-spacing: 1px;
  color: var(--text);
}

.rank-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: rgba(160, 180, 200, 0.75);
}

.src-chip {
  padding: 0 5px;
  border: 1px solid rgba(0, 229, 255, 0.4);
  color: #00e5ff;
  letter-spacing: 0.6px;
}

.rank-cols {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.rank-col {
  min-width: 0;
  padding: 6px;
  border: 1px solid rgba(240, 246, 255, 0.12);
}

.rank-col.is-primary-turn {
  border-color: rgba(0, 229, 255, 0.35);
}

.col-label {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  font-size: 12px;
  color: #e8f6ff;
}

.col-tag,
.primary-tag {
  font-size: 10px;
  letter-spacing: 0.3px;
  color: #00e5ff;
}

.hop-block + .hop-block {
  margin-top: 6px;
}

.hop-lab {
  font-size: 10px;
  color: rgba(160, 180, 200, 0.7);
  margin-bottom: 4px;
}

.rank-row {
  padding: 4px 0;
}

.rank-row + .rank-row {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.rank-row.is-primary {
  padding: 5px 4px;
  background: rgba(0, 229, 255, 0.08);
}

.row-name {
  font-size: 12px;
  color: rgba(230, 240, 250, 0.95);
  line-height: 1.35;
}

.row-sub,
.row-note {
  font-size: 10px;
  color: rgba(160, 180, 200, 0.72);
}

.row-share {
  margin-top: 2px;
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: #e8f6ff;
}

.rank-row.is-primary .row-share {
  color: #00e5ff;
}

.rank-conclusion {
  margin: 8px 0 0;
  padding-top: 8px;
  border-top: 1px solid rgba(240, 246, 255, 0.2);
  font-size: 12px;
  line-height: 1.55;
  color: var(--text);
}

.rank-foot {
  margin: 6px 0 0;
  font-size: 10px;
  line-height: 1.45;
  color: rgba(160, 180, 200, 0.7);
}
</style>
