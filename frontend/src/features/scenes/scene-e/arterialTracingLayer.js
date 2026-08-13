/**
 * arterialTracingLayer.js  v6
 *
 * 干线流量溯源图层
 * ─ 拓扑 BFS：从干线路口出发，沿 from_inter_id / to_inter_id 逐圈扩展
 * ─ 4km 半径截断
 * ─ 与干线夹角 < 20° 的路段只参与 BFS 传播，不渲染（排除平行路）
 * ─ 方向由拓扑确定：箭头始终指向干线（发现路段的那侧=靠近干线侧）
 * ─ 颜色与干线一致（三层橙色 Line2）
 * ─ 动画箭头（InstancedMesh 三角形沿路段向干线侧滑动）
 * ─ 流向粒子
 */

import * as THREE from 'three';
import { Line2 }        from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const CENTER_LON = 117.096, CENTER_LAT = 36.662, MPU = 10;
function project(lon, lat) {
  const x =  (lon - CENTER_LON) * Math.cos(CENTER_LAT * Math.PI / 180) * (Math.PI / 180) * 6371000 / MPU;
  const z = -(lat - CENTER_LAT) * (Math.PI / 180) * 6371000 / MPU;
  return [x, z];
}

function segBearing(x1, z1, x2, z2) {
  const b = Math.atan2(x2 - x1, z1 - z2) * 180 / Math.PI;
  return ((b % 180) + 180) % 180;
}
function angleBetween(b1, b2) {
  let d = Math.abs(b1 - b2); if (d > 90) d = 180 - d; return d;
}
function ptSegDist(px, pz, ax1, az1, ax2, az2) {
  const dx = ax2 - ax1, dz = az2 - az1;
  const len2 = dx * dx + dz * dz;
  if (len2 < 1e-12) return Math.hypot(px - ax1, pz - az1);
  const t = Math.max(0, Math.min(1, ((px - ax1) * dx + (pz - az1) * dz) / len2));
  return Math.hypot(px - (ax1 + t * dx), pz - (az1 + t * dz));
}
function roadToWorldPts(coords) {
  return coords.map(([lon, lat]) => project(lon, lat));
}
function roadMinDist(pts, segList) {
  let minD = Infinity;
  for (const [px, pz] of pts)
    for (const [ax1, az1, ax2, az2] of segList) {
      const d = ptSegDist(px, pz, ax1, az1, ax2, az2);
      if (d < minD) { minD = d; if (minD < 1) return 0; }
    }
  return minD;
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Array}         allLines      所有 LineString features
 * @param {Array}         allPoints     所有 Point features（路口位置）
 * @param {Array}         arterialRoads 干线路段 features（经十路）
 * @param {THREE.Vector2} resolution    渲染器分辨率
 */
export function createArterialTracingLayer(allLines, allPoints, arterialRoads, resolution) {
  const res      = resolution ?? new THREE.Vector2(1920, 1080);
  const RADIUS   = 400;  // 4km in world units
  const MIN_ANGLE = 20;

  // ── 1. 干线线段列表 + 平均方向 ─────────────────────────────────────────────
  const artSegments = [];
  const artBearings = [];
  for (const road of arterialRoads) {
    const pts = roadToWorldPts(road.geometry.coordinates);
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      artSegments.push([x1, z1, x2, z2]);
      artBearings.push(segBearing(x1, z1, x2, z2));
    }
  }
  const artBearing = artBearings.length
    ? artBearings.reduce((a, b) => a + b, 0) / artBearings.length : 90;

  // ── 2. 路口位置表（inter_id → [x, z]）────────────────────────────────────
  // 优先从 Point features 取坐标，再从路段端点补充
  const interPos = new Map();
  for (const pt of allPoints) {
    const id = pt.properties?.inter_id;
    if (id) interPos.set(id, project(pt.geometry.coordinates[0], pt.geometry.coordinates[1]));
  }
  for (const road of allLines) {
    const { from_inter_id, to_inter_id } = road.properties;
    const coords = road.geometry.coordinates;
    if (from_inter_id && !interPos.has(from_inter_id))
      interPos.set(from_inter_id, project(coords[0][0], coords[0][1]));
    if (to_inter_id && !interPos.has(to_inter_id))
      interPos.set(to_inter_id, project(coords[coords.length-1][0], coords[coords.length-1][1]));
  }

  // ── 3. 路口 → 路段索引（inter_id → roads[]）──────────────────────────────
  const interToRoads = new Map();
  const addToMap = (id, road) => {
    if (!id) return;
    if (!interToRoads.has(id)) interToRoads.set(id, []);
    interToRoads.get(id).push(road);
  };
  for (const road of allLines) {
    const { from_inter_id, to_inter_id } = road.properties;
    addToMap(from_inter_id, road);
    addToMap(to_inter_id,   road);
  }

  // ── 4. 干线路口 ID 集合（含 path_inter_ids 中间节点）────────────────────
  const arterialInterIds = new Set();
  for (const road of arterialRoads) {
    const p = road.properties;
    if (p.from_inter_id) arterialInterIds.add(p.from_inter_id);
    if (p.to_inter_id)   arterialInterIds.add(p.to_inter_id);
    String(p.path_inter_ids || '').split(',').forEach(id => {
      const s = id.trim(); if (s) arterialInterIds.add(s);
    });
  }

  // ── 5. 拓扑 BFS：从干线路口向外扩散 ──────────────────────────────────────
  // visitedInters: 已加入队列的路口
  // visitedRoads:  已处理的路段（link_id）
  // foundRoads:    最终要渲染的路段列表
  const visitedInters = new Set(arterialInterIds);
  const visitedRoads  = new Set();
  const foundRoads    = [];   // { pts, cumLen, total, reverseCoords, dist, w }

  const queue = [...arterialInterIds];

  while (queue.length > 0) {
    const interId = queue.shift();
    const roads   = interToRoads.get(interId) || [];

    for (const road of roads) {
      const p   = road.properties;
      const key = String(p.link_id ?? p.path_rids ?? JSON.stringify(p));

      if (visitedRoads.has(key)) continue;
      visitedRoads.add(key);

      // 排除干线自身
      if (String(p.road_names || '').startsWith('经十路:')) continue;

      // 当前路口是 from 侧还是 to 侧
      // from 侧在靠近干线一端 → 箭头从 to 端流向 from 端 → coords 逆向遍历
      const fromIsArterial = (p.from_inter_id === interId);
      const otherId        = fromIsArterial ? p.to_inter_id : p.from_inter_id;

      const coords = road.geometry.coordinates;
      const pts    = roadToWorldPts(coords);

      // 距干线距离（基于路段点集）
      const dist = roadMinDist(pts, artSegments);
      if (dist > RADIUS) continue;

      // 夹角检查：< MIN_ANGLE 的路段既不渲染也不传播 BFS（平行路作为屏障）
      const [hx, hz] = pts[0], [tx, tz] = pts[pts.length - 1];
      const rb       = segBearing(hx, hz, tx, tz);
      if (angleBetween(artBearing, rb) < MIN_ANGLE) continue;

      // 通过角度检查，可以渲染 + 传播
      {
        // 距离权重 easeOut 0.10~1.0
        const tw    = Math.max(0, 1 - dist / RADIUS);
        const wDist = 0.10 + 0.90 * (tw * tw);

        // 车道数 → 流量权重 0.3~1.0（avg_lanes 最大参考值 8 车道）
        const lanes    = Math.max(1, Number(p.avg_lanes) || 2);
        const wLanes   = Math.min(1.0, 0.3 + (lanes / 8) * 0.7);

        // 综合权重（取几何平均，保留两者影响）
        const w = Math.sqrt(wDist * wLanes);

        // 累积弧长
        const cumLen = [0];
        for (let i = 0; i < pts.length - 1; i++)
          cumLen.push(cumLen[i] + Math.hypot(pts[i+1][0]-pts[i][0], pts[i+1][1]-pts[i][1]));

        // reverseCoords: true → 粒子/箭头从 pts[last] 流向 pts[0]（from 侧=干线侧）
        foundRoads.push({
          pts, cumLen,
          total:        cumLen[cumLen.length - 1] || 1,
          reverseCoords: fromIsArterial,
          dist, lanes, w,
        });
      }

      // 将对侧路口加入 BFS 队列
      if (otherId && !visitedInters.has(otherId)) {
        const opos = interPos.get(otherId);
        if (opos) {
          const od = ptSegDist(opos[0], opos[1],
            ...artSegments[0]  // 快速粗判，后续 roadMinDist 会精确过滤
          );
          // 粗判通过再精算（避免性能浪费）
          if (od <= RADIUS * 1.5) {
            visitedInters.add(otherId);
            queue.push(otherId);
          }
        }
      }
    }
  }

  // ── 6. 构建 Three.js 对象 ──────────────────────────────────────────────────
  const group = new THREE.Group();
  group.name = 'arterialTracing';
  group.lineMaterials = [];
  if (foundRoads.length === 0) return group;

  // 按 t∈[0,1] 采样世界坐标 + 切线（t=0 为远端，t=1 为靠近干线端）
  function samplePath(road, t) {
    const tt = road.reverseCoords ? (1 - t) : t;
    const d  = tt * road.total;
    for (let i = 0; i < road.cumLen.length - 1; i++) {
      if (d <= road.cumLen[i + 1] + 1e-6) {
        const seg = road.cumLen[i + 1] - road.cumLen[i];
        const lt  = seg > 0 ? (d - road.cumLen[i]) / seg : 0;
        const a   = road.pts[i], b = road.pts[i + 1];
        const px  = a[0] + (b[0] - a[0]) * lt;
        const pz  = a[1] + (b[1] - a[1]) * lt;
        // 切线方向（始终指向干线，即 t 增大方向）
        const len = Math.hypot(b[0]-a[0], b[1]-a[1]) || 1;
        const sign = road.reverseCoords ? -1 : 1;
        return { px, pz, tdx: sign*(b[0]-a[0])/len, tdz: sign*(b[1]-a[1])/len };
      }
    }
    const last = road.pts[road.pts.length - 1];
    const prev = road.pts[road.pts.length - 2] ?? last;
    const len  = Math.hypot(last[0]-prev[0], last[1]-prev[1]) || 1;
    const sign = road.reverseCoords ? -1 : 1;
    return { px: last[0], pz: last[1],
      tdx: sign*(last[0]-prev[0])/len, tdz: sign*(last[1]-prev[1])/len };
  }

  // ── 三层橙色 Line2 ────────────────────────────────────────────────────────
  const lineMatRefs = [];
  for (const { pts, w } of foundRoads) {
    const flatPos = pts.flatMap(([x, z]) => [x, 1.5, z]);
    const layers = [
      { lw: 9 * w,   color: 0xcc3300, baseOp: 0.13 * w },
      { lw: 4.5 * w, color: 0xdd4400, baseOp: 0.38 * w },
      { lw: 1.6 * w, color: 0xff5500, baseOp: 0.82 * w },
    ];
    const mats = [];
    for (const { lw, color, baseOp } of layers) {
      const geo = new LineGeometry();
      geo.setPositions(flatPos);
      const mat = new LineMaterial({
        color, linewidth: Math.max(0.3, lw),
        transparent: true, opacity: baseOp,
        blending: THREE.AdditiveBlending, depthWrite: false,
        resolution: res,
      });
      const line = new Line2(geo, mat);
      line.computeLineDistances();
      line.frustumCulled = false;
      line.renderOrder   = 15;
      group.add(line);
      group.lineMaterials.push(mat);
      mats.push({ mat, baseOp });
    }
    lineMatRefs.push(mats);
  }

  // ── 彗星粒子流（参考车流溯源 FlowParticles，头亮尾暗，方向朝干线）──────────
  // 每颗"彗星" = 1个头粒子 + TAIL_LEN个尾粒子，紧密排列
  const TAIL_LEN      = 4;    // 尾粒子数
  const TAIL_DT       = 0.022; // 相邻粒子 t 间距（越小越紧凑）
  const COMET_INTERVAL = 30;   // 相邻彗星在路段上的世界单位间距

  // 彗星颜色表：头→尾逐渐变暗
  const COMET_COLORS = [
    new THREE.Color(0xffaa66),  // 头：亮橙白
    new THREE.Color(0xff6622),  // 尾1
    new THREE.Color(0xdd3300),  // 尾2
    new THREE.Color(0xaa2200),  // 尾3
    new THREE.Color(0x551100),  // 尾4
  ];
  // 对应大小
  const COMET_SIZES = [4.5, 3.0, 2.0, 1.2, 0.7];

  // 构建彗星元数据（车道数多 → 彗星更密、更快）
  const cometMeta = foundRoads.map(road => {
    // 车道数影响间距：6车道间距30，2车道间距55
    const laneInterval = Math.max(20, COMET_INTERVAL * (1 - road.w * 0.35));
    const n     = Math.max(1, Math.round(road.total / laneInterval));
    const speed = 0.016 + road.w * 0.032;
    const phases = Array.from({ length: n }, (_, k) => k / n);
    return { n, speed, phases };
  });

  const PARTS_PER_COMET = 1 + TAIL_LEN;
  const totalPts = cometMeta.reduce((s, m) => s + m.n * PARTS_PER_COMET, 0);

  const pPos  = new Float32Array(totalPts * 3);
  const pCol  = new Float32Array(totalPts * 3);
  const pSize = new Float32Array(totalPts);

  const ptGeo = new THREE.BufferGeometry();
  ptGeo.setAttribute('position', new THREE.Float32BufferAttribute(pPos, 3));
  ptGeo.setAttribute('color',    new THREE.Float32BufferAttribute(pCol, 3));
  ptGeo.setAttribute('size',     new THREE.Float32BufferAttribute(pSize, 1));

  const ptMat = new THREE.PointsMaterial({
    size: 1, vertexColors: true, sizeAttenuation: true,
    transparent: true, opacity: 0.92,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const pts3d = new THREE.Points(ptGeo, ptMat);
  pts3d.frustumCulled = false;
  pts3d.renderOrder   = 16;
  group.add(pts3d);

  const posAttr  = ptGeo.attributes.position;
  const colAttr  = ptGeo.attributes.color;
  const sizeAttr = ptGeo.attributes.size;

  // ── update / dispose ─────────────────────────────────────────────────────
  group.update = (time) => {
    const dt    = 0.016;
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.2);

    // 路段脉冲
    lineMatRefs.forEach(mats => {
      mats.forEach(({ mat, baseOp }) => {
        mat.opacity = baseOp * (0.6 + 0.4 * pulse);
      });
    });

    // 彗星粒子
    let idx = 0;
    foundRoads.forEach((road, ri) => {
      const { n, speed, phases } = cometMeta[ri];
      const sz = 0.7 + 0.5 * road.w;

      for (let k = 0; k < n; k++) {
        // 推进头部相位
        phases[k] = (phases[k] + speed * dt) % 1;
        const headT = phases[k];

        // 写入头 + 各尾粒子
        for (let tail = 0; tail < PARTS_PER_COMET; tail++) {
          // 尾粒子在 t 方向上落后（mod 1 循环）
          const tSample = ((headT - tail * TAIL_DT) % 1 + 1) % 1;
          const { px, pz } = samplePath(road, tSample);

          posAttr.setXYZ(idx, px, 2.5, pz);

          const c = COMET_COLORS[tail];
          colAttr.setXYZ(idx, c.r, c.g, c.b);

          // 头粒子随脉冲轻微闪烁
          const sizePulse = tail === 0 ? (1 + 0.3 * pulse) : 1;
          sizeAttr.setX(idx, COMET_SIZES[tail] * sz * sizePulse);
          idx++;
        }
      }
    });

    posAttr.needsUpdate  = true;
    colAttr.needsUpdate  = true;
    sizeAttr.needsUpdate = true;
  };

  group.dispose = () => {
    ptGeo.dispose();
    ptMat.dispose();
    group.traverse(obj => {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
      else obj.material?.dispose();
    });
  };

  return group;
}
