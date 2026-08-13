/**
 * 幕 2 地图动作（方案 A）：路口脉冲、问题路段强调、示意相位环、270 m 排队条。
 * 数字不进地图，由侧栏按拍展示。
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
 *   hopTimes?: { pos: [number, number], revealAt: number, label: string }[],
 * }} opts
 */
export function createScene2MapAnnot({
  via,
  target,
  problemRoad,
  queueM = 270,
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
  const queueTube = makeTube(pathFromSouth(problemRoad?.coords, queueLen), 1.15, C_QUEUE, 1.2);
  if (queueTube) track(queueTube);

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
