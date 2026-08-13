<script setup>
import { ref, onMounted, watch } from 'vue';

const props = defineProps({
  interItem: { type: Object, required: true },
  allData:   { type: Array,  default: () => [] },
});

const canvasRef = ref(null);

// ── Geohash decoder ───────────────────────────────────────────────────────────
const GH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
function decodeGeohash(hash) {
  let isLon = true, minLat = -90, maxLat = 90, minLon = -180, maxLon = 180;
  for (const c of hash) {
    const val = GH_BASE32.indexOf(c);
    for (let b = 4; b >= 0; b--) {
      const bit = (val >> b) & 1;
      if (isLon) { const m = (minLon + maxLon) / 2; if (bit) minLon = m; else maxLon = m; }
      else        { const m = (minLat + maxLat) / 2; if (bit) minLat = m; else maxLat = m; }
      isLon = !isLon;
    }
  }
  return { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 };
}

// ── Arm processing ────────────────────────────────────────────────────────────
function processArms(interItem, allData) {
  const info    = interItem.intersection_info;
  const curGeo  = info.inter_id.substring(3, 10); // e.g. "wwe0qyw"

  // inter_id → position
  const interMap = {};
  allData.forEach(d => {
    const i = d.intersection_info;
    interMap[i.inter_id] = { lon: i.longitude, lat: i.latitude };
  });

  const outLanes = interItem.surrounding_lanes['朝向对向路口的车道'] || [];
  const inLanes  = interItem.surrounding_lanes['朝向当前路口的车道']  || [];
  const allLanes = [...outLanes, ...inLanes];

  // Group by link_id
  const byLink = {};
  allLanes.forEach(l => {
    (byLink[l.link_id] = byLink[l.link_id] || []).push(l);
  });

  // Merge into arms keyed by otherGeo
  const arms = {};
  Object.entries(byLink).forEach(([lid, lanes]) => {
    if (lid.length < 16) return;
    const fromGeo = lid.substring(2, 9);
    const toGeo   = lid.substring(9, 16);
    const isOut   = fromGeo === curGeo;
    const otherGeo = isOut ? toGeo : fromGeo;
    const key     = otherGeo;

    if (!arms[key]) {
      // Determine direction: prefer belong_inter_id lookup, fall back to geohash decode
      let otherPos = null;
      const withId = lanes.find(l => l.belong_inter_id);
      if (withId && interMap[withId.belong_inter_id]) {
        otherPos = interMap[withId.belong_inter_id];
      } else {
        const dec = decodeGeohash(otherGeo);
        otherPos = { lon: dec.lon, lat: dec.lat };
      }
      const dx    = otherPos.lon - info.longitude;
      const dy    = otherPos.lat - info.latitude;
      const angle = Math.atan2(dy, dx); // 0=east, CCW positive
      const rName = lanes[0].road_name.split(':')[0];
      arms[key] = { angle, outLanes: [], inLanes: [], roadName: rName };
    }

    lanes.sort((a, b) => (a.lane_no || 0) - (b.lane_no || 0));
    if (isOut) arms[key].outLanes.push(...lanes);
    else       arms[key].inLanes.push(...lanes);
  });

  return Object.values(arms);
}

// ── Canvas drawing ────────────────────────────────────────────────────────────
const LANE_W = 22;
const ARM_LEN = 170;
const BOX_R   = 52;

function draw() {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2;

  ctx.clearRect(0, 0, W, H);

  // Background
  ctx.fillStyle = '#d4d4d4';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = 'rgba(0,0,0,0.10)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= W; x += 20) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let y = 0; y <= H; y += 20) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }

  const arms = processArms(props.interItem, props.allData);

  // Draw each arm
  arms.forEach(arm => drawArm(ctx, cx, cy, arm));

  // Intersection center box (drawn last to cover arm overlap)
  ctx.fillStyle = '#282828';
  ctx.fillRect(cx - BOX_R, cy - BOX_R, BOX_R * 2, BOX_R * 2);

  // Title
  ctx.fillStyle = '#111';
  ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(props.interItem.intersection_info.inter_name, cx, 22);

  // Total lanes info
  const totalLanes = props.interItem.surrounding_lanes['总车道数'] || '';
  if (totalLanes) {
    ctx.fillStyle = '#555';
    ctx.font = '11px monospace';
    ctx.fillText(`总车道数 ${totalLanes}`, cx, H - 10);
  }
}

function drawArm(ctx, cx, cy, arm) {
  const { outLanes, inLanes, angle, roadName } = arm;

  // Use approach lanes (inLanes) if available, else outLanes for arrow display
  const approachLanes = inLanes.length  ? inLanes  : outLanes;
  const departureLanes = outLanes.length ? outLanes : inLanes;

  const nApp = Math.max(approachLanes.length, 1);
  const nDep = Math.max(departureLanes.length, 1);
  const appW = nApp * LANE_W;
  const depW = nDep * LANE_W;
  const halfW = (appW + depW) / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-angle); // geographic angle → canvas (flip y-axis)

  const x0 = BOX_R, x1 = BOX_R + ARM_LEN;

  // ── Road surface ──────────────────────────────────────────────────────────
  // departure (outgoing) lanes: negative y region (north/upper in canvas)
  // approach (incoming) lanes:  positive y region (south/lower in canvas)
  ctx.fillStyle = '#2e2e2e';
  ctx.fillRect(x0, -halfW, ARM_LEN, appW + depW);

  // ── Outer curb lines (green) ──────────────────────────────────────────────
  ctx.strokeStyle = '#22cc55';
  ctx.lineWidth = 3;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x0, -halfW); ctx.lineTo(x1, -halfW); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x0,  halfW); ctx.lineTo(x1,  halfW); ctx.stroke();

  // ── Center divider (yellow) ───────────────────────────────────────────────
  const centerY = -halfW + depW; // boundary between dep and app
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.moveTo(x0, centerY); ctx.lineTo(x1, centerY); ctx.stroke();

  // ── Lane dividers (white dashed) ──────────────────────────────────────────
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([9, 7]);

  for (let i = 1; i < nDep; i++) {
    const y = -halfW + i * LANE_W;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  for (let i = 1; i < nApp; i++) {
    const y = centerY + i * LANE_W;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // ── Stop line (red bar) ───────────────────────────────────────────────────
  ctx.fillStyle = '#ff2222';
  ctx.fillRect(x0 + 3, -halfW, 5, appW + depW);

  // ── Crosswalk (white stripes) ─────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  for (let dx = x0 + 11; dx < x0 + 29; dx += 6) {
    ctx.fillRect(dx, -halfW, 4, appW + depW);
  }

  // ── Approach lane arrows (on approach/incoming side) ─────────────────────
  // Approach cars travel ← (leftward in arm frame, toward center)
  // Arrow placed at ~55% of arm length
  const arrowX = x0 + ARM_LEN * 0.55;
  approachLanes.forEach((lane, i) => {
    if (!lane.lane_function) return;
    const laneY = centerY + (i + 0.5) * LANE_W;
    drawLaneArrow(ctx, arrowX, laneY, lane.lane_function, LANE_W * 0.42);
  });

  // ── Lane numbers ──────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  approachLanes.forEach((lane, i) => {
    const laneY = centerY + (i + 0.5) * LANE_W;
    ctx.fillText(String(lane.lane_no || i + 1), x1 - 10, laneY + 3);
  });

  // ── Road name label ───────────────────────────────────────────────────────
  if (roadName) {
    ctx.save();
    ctx.translate(x1 + 10, centerY);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#333';
    ctx.font = '11px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(roadName, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

// ── Arrow drawing ─────────────────────────────────────────────────────────────
// In arm local frame: arm goes RIGHT (+x). Approach cars travel LEFT (←).
// From driver facing left (west): left-turn = south = ↓, right-turn = north = ↑
function drawLaneArrow(ctx, x, y, laneFunc, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = 'rgba(255,255,255,0.88)';
  ctx.fillStyle   = 'rgba(255,255,255,0.88)';
  ctx.lineWidth   = 1.6;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  const fn = (laneFunc || '').toUpperCase();
  const S  = fn.includes('C');
  const L  = fn.includes('B') || fn.includes('A');
  const R  = fn.includes('D') || fn.includes('E');
  const s  = size;

  if (S && !L && !R) {
    // Straight ←
    arrowLine(ctx,  s * 0.6, 0, -s * 0.6, 0, s * 0.32, s * 0.38);
  } else if (L && !S && !R) {
    // Left turn only → arc ← then ↓
    ctx.beginPath();
    ctx.moveTo(s * 0.4, 0);
    ctx.lineTo(-s * 0.15, 0);
    ctx.lineTo(-s * 0.15, s * 0.75);
    ctx.stroke();
    arrowHead(ctx, -s * 0.15, s * 0.75, 0, 1, s * 0.28, s * 0.32);
  } else if (R && !S && !L) {
    // Right turn only → arc ← then ↑
    ctx.beginPath();
    ctx.moveTo(s * 0.4, 0);
    ctx.lineTo(-s * 0.15, 0);
    ctx.lineTo(-s * 0.15, -s * 0.75);
    ctx.stroke();
    arrowHead(ctx, -s * 0.15, -s * 0.75, 0, -1, s * 0.28, s * 0.32);
  } else if (L && S) {
    // Left + Straight: ← with ↓ branch
    ctx.beginPath();
    ctx.moveTo(s * 0.5, 0); ctx.lineTo(-s * 0.5, 0); ctx.stroke();
    arrowHead(ctx, -s * 0.5, 0, -1, 0, s * 0.30, s * 0.36);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, s * 0.72); ctx.stroke();
    arrowHead(ctx, 0, s * 0.72, 0, 1, s * 0.25, s * 0.30);
  } else if (R && S) {
    // Right + Straight: ← with ↑ branch
    ctx.beginPath();
    ctx.moveTo(s * 0.5, 0); ctx.lineTo(-s * 0.5, 0); ctx.stroke();
    arrowHead(ctx, -s * 0.5, 0, -1, 0, s * 0.30, s * 0.36);
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(0, -s * 0.72); ctx.stroke();
    arrowHead(ctx, 0, -s * 0.72, 0, -1, s * 0.25, s * 0.30);
  } else if (L && R) {
    // Both turns
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.5); ctx.lineTo(0, s * 0.5); ctx.stroke();
    arrowHead(ctx, 0,  s * 0.5,  0, 1,  s * 0.28, s * 0.32);
    arrowHead(ctx, 0, -s * 0.5,  0, -1, s * 0.28, s * 0.32);
  } else {
    arrowLine(ctx, s * 0.6, 0, -s * 0.6, 0, s * 0.32, s * 0.38);
  }

  ctx.restore();
}

function arrowLine(ctx, x1, y1, x2, y2, hw, hl) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  arrowHead(ctx, x2, y2, dx / len, dy / len, hw, hl);
}

function arrowHead(ctx, x, y, nx, ny, hw, hl) {
  const px = -ny, py = nx;
  ctx.beginPath();
  ctx.moveTo(x - nx * hl + px * hw, y - ny * hl + py * hw);
  ctx.lineTo(x, y);
  ctx.lineTo(x - nx * hl - px * hw, y - ny * hl - py * hw);
  ctx.fill();
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
onMounted(draw);
watch(() => props.interItem, draw);
</script>

<template>
  <div class="channelization-wrap">
    <canvas ref="canvasRef" :width="580" :height="460" class="channelization-canvas" />
  </div>
</template>

<style scoped>
.channelization-wrap {
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #c8c8c8;
}
.channelization-canvas {
  display: block;
  max-width: 100%;
}
</style>
