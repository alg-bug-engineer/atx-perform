/**
 * 幕 2 地图动作（方案 A）：路口脉冲、问题路段强调、示意相位环、270 m 排队条。
 * 溢流拍在排队条旁标出排队比。
 */
import * as THREE from 'three';

const C_GREEN = 0x00cc44;
const C_AMBER = 0xf5a623;
const C_RED = 0xff1800;
const C_QUEUE = 0xff8a3a;
const C_CYAN = 0x00e5ff;
const METERS_PER_UNIT = 10;

function makeGlowTexture() {
  const sz = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = sz;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(sz / 2, sz / 2, 0, sz / 2, sz / 2, sz / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, sz, sz);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function toWorld(pos, y = 8) {
  return new THREE.Vector3(pos[0], y, -pos[1]);
}

function pathFromSouth(coords, lengthUnits) {
  if (!coords || coords.length < 2) return [];
  const pts = [];
  let remain = lengthUnits;
  pts.push(coords[coords.length - 1]);
  for (let i = coords.length - 1; i > 0; i -= 1) {
    const a = coords[i];
    const b = coords[i - 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue;
    if (remain <= len) {
      const t = remain / len;
      pts.push([a[0] + dx * t, a[1] + dy * t]);
      break;
    }
    pts.push(b);
    remain -= len;
  }
  return pts;
}

function makeQueueRatioSprite(ratio) {
  const title = '排队比已达';
  const value = Number(ratio).toFixed(1);
  const w = 220;
  const h = 92;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = 'rgba(18, 8, 4, 0.78)';
  ctx.strokeStyle = 'rgba(255, 138, 58, 0.85)';
  ctx.lineWidth = 2;
  const x = 6;
  const y = 6;
  const rw = w - 12;
  const rh = h - 12;
  const r = 10;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, rw, rh, r);
  } else {
    ctx.rect(x, y, rw, rh);
  }
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '500 18px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillStyle = 'rgba(255, 196, 140, 0.95)';
  ctx.fillText(title, w / 2, 30);
  ctx.font = '700 34px "DIN Alternate","PingFang SC",sans-serif';
  ctx.fillStyle = '#ff8a3a';
  ctx.shadowColor = 'rgba(255, 80, 20, 0.55)';
  ctx.shadowBlur = 10;
  ctx.fillText(value, w / 2, 62);
  ctx.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(22, 9.2, 1);
  spr.renderOrder = 62;
  spr.visible = false;
  spr.userData.disposeLabel = () => {
    tex.dispose();
    mat.dispose();
  };
  return spr;
}

function queueLabelAnchor(coords2d) {
  if (!coords2d || coords2d.length < 2) return null;
  const a = coords2d[0];
  const b = coords2d[coords2d.length - 1];
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [mx + (-dy / len) * 11, my + (dx / len) * 11];
}

function makeTube(coords2d, radius, color, y = 1.2) {
  if (!coords2d || coords2d.length < 2) return null;
  const pts = coords2d.map(([x, ny]) => new THREE.Vector3(x, y, -ny));
  const curve = new THREE.CatmullRomCurve3(pts, false, 'chordal', 0.05);
  const geo = new THREE.TubeGeometry(curve, Math.max(24, pts.length * 8), radius, 8, false);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 40;
  mesh.visible = false;
  return mesh;
}

function makeArcLine(radius, a0, a1, y, color) {
  const n = 28;
  const positions = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    const a = a0 + (a1 - a0) * t;
    positions.push(radius * Math.cos(a), y, radius * Math.sin(a));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.renderOrder = 55;
  line.visible = false;
  return line;
}

/**
 * @param {{
 *   via?: { pos: [number, number] },
 *   target?: { pos: [number, number] },
 *   problemRoad?: { coords: [number, number][] },
 *   queueM?: number,
 *   queueRatio?: number,
 *   hopTimes?: { pos: [number, number], revealAt: number, label: string }[],
 * }} opts
 */
export function createScene2MapAnnot({
  via,
  target,
  problemRoad,
  queueM = 270,
  queueRatio = 0.8,
  hopTimes = [],
} = {}) {
  const group = new THREE.Group();
  group.name = 'scene2MapAnnot';
  const glowTex = makeGlowTexture();
  const fades = [];

  function track(obj) {
    group.add(obj);
    return obj;
  }

  function fadeTo(obj, targetOpacity) {
    fades.push({ obj, targetOpacity });
  }

  const targetPos = target?.pos;
  const viaPos = via?.pos;

  const hopPulses = hopTimes.map((hop) => {
    const spr = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: hop.label === '经十' ? C_GREEN : C_AMBER,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    spr.position.copy(toWorld(hop.pos, 6));
    spr.scale.set(14, 14, 1);
    spr.renderOrder = 58;
    spr.visible = false;
    track(spr);
    return { ...hop, spr };
  });

  const linkGlow = makeTube(problemRoad?.coords, 1.35, C_CYAN, 0.9);
  if (linkGlow) track(linkGlow);

  const ringGroup = new THREE.Group();
  ringGroup.visible = false;
  if (targetPos) {
    ringGroup.position.set(targetPos[0], 0, -targetPos[1]);
    const arcs = [
      makeArcLine(9.5, -0.55, 0.55, 5.5, C_GREEN),
      makeArcLine(9.5, Math.PI - 0.55, Math.PI + 0.55, 5.5, C_GREEN),
      makeArcLine(9.5, Math.PI / 2 - 0.22, Math.PI / 2 + 0.22, 5.5, C_RED),
      makeArcLine(9.5, -Math.PI / 2 - 0.22, -Math.PI / 2 + 0.22, 5.5, C_RED),
    ];
    arcs.forEach((arc) => ringGroup.add(arc));
    ringGroup.userData.arcs = arcs;
  }
  track(ringGroup);

  const blockPulse = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: C_RED,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  if (targetPos) blockPulse.position.set(targetPos[0], 7, -(targetPos[1] + 10));
  blockPulse.scale.set(16, 16, 1);
  blockPulse.renderOrder = 59;
  blockPulse.visible = false;
  track(blockPulse);

  const queueLen = Math.max(4, queueM / METERS_PER_UNIT);
  const queuePts = pathFromSouth(problemRoad?.coords, queueLen);
  const queueTube = makeTube(queuePts, 1.15, C_QUEUE, 1.2);
  if (queueTube) track(queueTube);

  const ratioSpr = makeQueueRatioSprite(queueRatio);
  const ratioAnchor = queueLabelAnchor(queuePts);
  if (ratioAnchor) {
    ratioSpr.position.set(ratioAnchor[0], 14, -ratioAnchor[1]);
  }
  track(ratioSpr);

  const viaPulse = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: glowTex,
      color: C_RED,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  if (viaPos) viaPulse.position.copy(toWorld(viaPos, 7));
  viaPulse.scale.set(18, 18, 1);
  viaPulse.renderOrder = 59;
  viaPulse.visible = false;
  track(viaPulse);

  let beat = 'hidden';
  let beatAt = 0;
  let traceElapsed = 0;

  function applyBeat(name) {
    fades.length = 0;
    const showLink = name === 'supply';
    const showRing = name === 'signal';
    const showQueue = name === 'overflow';
    ringGroup.visible = showRing;

    if (linkGlow) fadeTo(linkGlow, showLink ? 0.55 : 0);
    fadeTo(viaPulse, showQueue ? 0.9 : 0);
    fadeTo(blockPulse, name === 'signal' ? 0.85 : 0);
    if (queueTube) fadeTo(queueTube, showQueue ? 0.85 : 0);
    fadeTo(ratioSpr, showQueue ? 1 : 0);
    const ringOn = showRing ? 0.95 : 0;
    for (const arc of ringGroup.userData.arcs || []) fadeTo(arc, ringOn);
  }

  group.setBeat = (name, at = performance.now() / 1000) => {
    beat = name;
    beatAt = at;
    applyBeat(name);
  };

  group.setTraceElapsed = (elapsed) => {
    traceElapsed = elapsed;
  };

  group.update = (time) => {
    for (const f of fades) {
      const mat = f.obj.material;
      if (!mat) continue;
      const cur = mat.opacity ?? 0;
      const next = cur + (f.targetOpacity - cur) * 0.12;
      mat.opacity = next;
      f.obj.visible = next > 0.02;
    }

    if (beat === 'trace') {
      for (const hop of hopPulses) {
        const dt = traceElapsed - (hop.revealAt ?? 0);
        if (dt < 0 || dt > 1.4) {
          hop.spr.visible = false;
          hop.spr.material.opacity = 0;
          continue;
        }
        const peak = dt < 0.25 ? dt / 0.25 : 1 - (dt - 0.25) / 1.15;
        hop.spr.visible = true;
        hop.spr.material.opacity = Math.max(0, peak) * 0.95;
        const s = 10 + peak * 16;
        hop.spr.scale.set(s, s, 1);
      }
    } else {
      for (const hop of hopPulses) {
        hop.spr.visible = false;
        hop.spr.material.opacity = 0;
      }
    }

    if (beat === 'signal') {
      const p = 0.55 + 0.45 * Math.sin(time * 5.2);
      blockPulse.material.opacity = Math.max(blockPulse.material.opacity, p * 0.7);
      const s = 12 + p * 10;
      blockPulse.scale.set(s, s, 1);
    }

    if (beat === 'overflow') {
      const p = 0.5 + 0.5 * Math.sin(time * 3.4);
      viaPulse.material.opacity = Math.max(0.35, p);
      const s = 14 + p * 10;
      viaPulse.scale.set(s, s, 1);
      if (queueTube) {
        const grow = Math.min(1, Math.max(0.25, (time - beatAt) / 1.1));
        queueTube.material.opacity = 0.4 + grow * 0.5;
        queueTube.visible = true;
      }
      if (ratioSpr) {
        const grow = Math.min(1, Math.max(0, (time - beatAt - 0.25) / 0.7));
        ratioSpr.material.opacity = grow;
        ratioSpr.visible = grow > 0.02;
        const bob = 1 + 0.04 * Math.sin(time * 3.2);
        ratioSpr.scale.set(22 * bob, 9.2 * bob, 1);
      }
    }
  };

  group.dispose = () => {
    glowTex.dispose();
    group.traverse((obj) => {
      obj.geometry?.dispose?.();
      obj.material?.dispose?.();
    });
  };

  applyBeat('hidden');
  return group;
}
