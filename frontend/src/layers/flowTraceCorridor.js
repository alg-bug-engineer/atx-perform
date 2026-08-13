/**
 * 幕 2 上游流量溯源层（精简自 agent-loop Act5 flowTraceCorridorLayer）
 * - 主走廊边 + 琥珀箭头 + 节点光晕
 * - upstream：最远 hop 先亮 → 目标口最后
 */
import * as THREE from 'three';

const CORRIDOR_HOP_REVEAL_DELAY_S = 0.45;
const REVEAL_FADE_S = 0.225;

const TRACE = {
  glow: 0xf5a623,
  core: 0xffcf7a,
  arrow: 0xffe0a0,
};

const NODE = {
  target: { glow: 0x22c55e, core: 0x86efac },
  upstream: { glow: 0xf59e0b, core: 0xfbbf24 },
};

function toWorld(projectFn, lon, lat, yUp = 0.8) {
  const [x, northY] = projectFn(lon, lat);
  return new THREE.Vector3(x, yUp, -northY);
}

function makeGlowTexture() {
  const sz = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = sz;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeArrowTexture() {
  const cvs = document.createElement('canvas');
  cvs.width = 64;
  cvs.height = 64;
  const ctx = cvs.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(8, 32);
  ctx.lineTo(40, 12);
  ctx.lineTo(40, 24);
  ctx.lineTo(56, 24);
  ctx.lineTo(56, 40);
  ctx.lineTo(40, 40);
  ctx.lineTo(40, 52);
  ctx.closePath();
  ctx.fill();
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function pathLen(pts) {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    len += pts[i].distanceTo(pts[i + 1]);
  }
  return len;
}

function samplePath(pts, t) {
  const total = pathLen(pts);
  if (total <= 1e-6) {
    const p = pts[0] || new THREE.Vector3();
    return { pos: p.clone(), dir: new THREE.Vector3(0, 0, -1) };
  }
  const d = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = a.distanceTo(b);
    if (acc + seg >= d - 1e-6) {
      const lt = seg > 0 ? (d - acc) / seg : 0;
      const pos = a.clone().lerp(b, lt);
      const dir = b.clone().sub(a).normalize();
      return { pos, dir };
    }
    acc += seg;
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2] || last;
  return { pos: last.clone(), dir: last.clone().sub(prev).normalize() };
}

function revealAlpha(elapsed, revealAt, fadeS = REVEAL_FADE_S) {
  const t = (elapsed - revealAt) / Math.max(0.05, fadeS);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - (1 - t) ** 2;
}

function coordsToPath(projectFn, coordinates, yUp = 0.9) {
  return (coordinates || []).map(([lon, lat]) => toWorld(projectFn, lon, lat, yUp));
}

function buildRevealSchedule(nodes, traceDir = 'upstream') {
  const revealAt = new Map();
  let maxHop = 0;
  for (const n of nodes) {
    if (n.role === 'target') continue;
    const hop = Number(n.hop ?? n.corridor_hop);
    if (Number.isFinite(hop) && hop > maxHop) maxHop = hop;
  }
  for (const n of nodes) {
    const id = n.id || n.inter_id;
    if (!id) continue;
    if (n.role === 'target') {
      revealAt.set(id, traceDir === 'upstream' ? maxHop * CORRIDOR_HOP_REVEAL_DELAY_S : 0);
      continue;
    }
    const hop = Math.max(0, Number(n.hop ?? n.corridor_hop) || 0);
    const at =
      traceDir === 'upstream'
        ? Math.max(0, maxHop - hop) * CORRIDOR_HOP_REVEAL_DELAY_S
        : hop * CORRIDOR_HOP_REVEAL_DELAY_S;
    revealAt.set(id, at);
  }
  return { revealAt, maxHop };
}

/**
 * @param {object} flowTrace 1-2-flow-trace.json
 * @param {(lon:number,lat:number)=>[number,number]} projectFn
 */
export function createFlowTraceCorridorLayer(flowTrace, projectFn) {
  const group = new THREE.Group();
  group.name = 'flowTraceCorridor';

  const nodes = flowTrace?.nodes || [];
  const links = flowTrace?.links || [];
  const traceDir = flowTrace?.trace_direction || 'upstream';
  const { revealAt, maxHop } = buildRevealSchedule(nodes, traceDir);

  const glowTex = makeGlowTexture();
  const arrowTex = makeArrowTexture();

  const nodeItems = [];
  const edgeItems = [];
  const arrowItems = [];
  const bounds = {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };

  function expand(v) {
    bounds.minX = Math.min(bounds.minX, v.x);
    bounds.maxX = Math.max(bounds.maxX, v.x);
    bounds.minZ = Math.min(bounds.minZ, v.z);
    bounds.maxZ = Math.max(bounds.maxZ, v.z);
  }

  for (const n of nodes) {
    const id = n.id || n.inter_id;
    const lng = n.lng ?? n.lon;
    const lat = n.lat;
    if (lng == null || lat == null) continue;
    const pos = toWorld(projectFn, lng, lat, 1.2);
    expand(pos);
    const pal = n.role === 'target' ? NODE.target : NODE.upstream;

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: pal.glow,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    glow.position.copy(pos);
    glow.scale.set(28, 28, 1);
    glow.renderOrder = 50;
    group.add(glow);

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(1.8, 16, 16),
      new THREE.MeshBasicMaterial({
        color: pal.core,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      }),
    );
    core.position.copy(pos);
    core.renderOrder = 51;
    group.add(core);

    nodeItems.push({
      id,
      revealAt: revealAt.get(id) ?? 0,
      glow,
      core,
      baseGlow: 0.85,
      baseCore: 0.95,
      isTarget: n.role === 'target',
    });
  }

  for (const link of links) {
    const pts = coordsToPath(projectFn, link.coordinates, 0.95);
    if (pts.length < 2) continue;
    pts.forEach(expand);

    // edge reveals with the "from" upstream node (farther hop for upstream inflow)
    // 汇入方向：边随上游 from 节点点亮（坤顺边先于解放东边）
    const edgeReveal = revealAt.get(link.from_id) ?? 0;

    let curve;
    try {
      curve = new THREE.CatmullRomCurve3(pts, false, 'chordal', 0.05);
    } catch {
      continue;
    }
    const tubular = Math.max(48, pts.length * 12);
    const cov = Number(link.coverage) || 40;
    const mainR = 0.7 + Math.sqrt(cov / 100) * 1.1;
    const glowR = mainR * 2.2;

    const glowMat = new THREE.MeshBasicMaterial({
      color: TRACE.glow,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mainMat = new THREE.MeshBasicMaterial({
      color: TRACE.core,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });

    const glowMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, glowR, 10, false), glowMat);
    glowMesh.renderOrder = 40;
    group.add(glowMesh);
    const mainMesh = new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, mainR, 10, false), mainMat);
    mainMesh.renderOrder = 41;
    group.add(mainMesh);

    edgeItems.push({
      revealAt: edgeReveal,
      glowMat,
      mainMat,
      baseGlow: 0.28,
      baseMain: 0.88,
    });

    const arrowCount = 4;
    for (let i = 0; i < arrowCount; i += 1) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: arrowTex,
          color: TRACE.arrow,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      sprite.scale.set(10, 10, 1);
      sprite.renderOrder = 55;
      group.add(sprite);
      arrowItems.push({
        revealAt: edgeReveal,
        sprite,
        pts,
        offset: i / arrowCount,
        speed: 0.18,
      });
    }
  }

  let startTime = null;
  let playing = false;
  let resolveDone = null;
  let donePromise = Promise.resolve();
  let doneSignaled = false;

  const totalRevealS = maxHop * CORRIDOR_HOP_REVEAL_DELAY_S + REVEAL_FADE_S + 0.35;

  const worldCenter = new THREE.Vector3(
    Number.isFinite(bounds.minX) ? (bounds.minX + bounds.maxX) / 2 : 0,
    0,
    Number.isFinite(bounds.minZ) ? (bounds.minZ + bounds.maxZ) / 2 : 0,
  );

  function play(at = performance.now() / 1000) {
    startTime = at;
    playing = true;
    doneSignaled = false;
    donePromise = new Promise((resolve) => {
      resolveDone = resolve;
    });
  }

  function stop() {
    playing = false;
  }

  function update(time) {
    if (!playing || startTime == null) return;
    const elapsed = time - startTime;

    for (const n of nodeItems) {
      const a = revealAlpha(elapsed, n.revealAt);
      n.glow.material.opacity = a * n.baseGlow;
      n.core.material.opacity = a * n.baseCore;
      if (n.isTarget && a > 0) {
        const pulse = 0.85 + 0.15 * Math.sin(time * 3.2);
        n.glow.scale.setScalar(28 * pulse);
      }
    }

    for (const e of edgeItems) {
      const a = revealAlpha(elapsed, e.revealAt);
      e.glowMat.opacity = a * e.baseGlow;
      e.mainMat.opacity = a * e.baseMain;
    }

    for (const ar of arrowItems) {
      const a = revealAlpha(elapsed, ar.revealAt);
      ar.sprite.material.opacity = a * 0.9;
      if (a <= 0) {
        ar.sprite.visible = false;
        continue;
      }
      ar.sprite.visible = true;
      const t = (ar.offset + (time - startTime) * ar.speed) % 1;
      const { pos, dir } = samplePath(ar.pts, t);
      ar.sprite.position.copy(pos);
      ar.sprite.position.y += 0.6;
      // face travel direction in XZ
      const angle = Math.atan2(dir.x, dir.z);
      ar.sprite.material.rotation = -angle + Math.PI / 2;
    }

    if (!doneSignaled && elapsed >= totalRevealS) {
      doneSignaled = true;
      resolveDone?.();
    }
  }

  function dispose() {
    stop();
    group.traverse((obj) => {
      obj.geometry?.dispose?.();
      if (obj.material) {
        obj.material.map?.dispose?.();
        obj.material.dispose?.();
      }
    });
    glowTex.dispose();
    arrowTex.dispose();
  }

  group.whenFullyRevealed = () => donePromise;
  group.play = play;
  group.stop = stop;
  group.update = update;
  group.dispose = dispose;
  group.bounds = bounds;
  group.worldCenter = worldCenter;
  group.totalRevealS = totalRevealS;

  return group;
}

export function estimateFlowTraceRevealSec(flowTrace) {
  let maxHop = 0;
  for (const n of flowTrace?.nodes || []) {
    if (n.role === 'target') continue;
    const hop = Number(n.hop ?? n.corridor_hop);
    if (Number.isFinite(hop) && hop > maxHop) maxHop = hop;
  }
  return maxHop * CORRIDOR_HOP_REVEAL_DELAY_S + REVEAL_FADE_S + 0.35;
}
