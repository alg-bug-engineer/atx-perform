/**
 * 问题路段标红闪烁（效仿 agent-loop cityMonitorMapFx emphasized corridor）
 */
import * as THREE from 'three';
import { project } from '../geo/loader.js';

const CRITICAL_RED = 0xff4757;

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

function pathToCurve(path, y = 1.35) {
  if (!Array.isArray(path) || path.length < 2) return null;
  const pts = path.map(([lon, lat]) => {
    const [x, ny] = project(lon, lat);
    return new THREE.Vector3(x, y, -ny);
  });
  return new THREE.CatmullRomCurve3(pts, false, 'chordal', 0.05);
}

function emptyBounds() {
  return { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
}

function expandBounds(bounds, x, z) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

/**
 * @param {{ coordinates: number[][] }} geom GeoJSON LineString
 */
export function createProblemLinkAlert(geom) {
  const group = new THREE.Group();
  group.name = 'problemLinkAlert';
  group.visible = false;

  const path = geom?.coordinates;
  const curve = pathToCurve(path, 1.35);
  const bounds = emptyBounds();
  const worldCenter = new THREE.Vector3();

  if (!curve || !path?.length) {
    return {
      group,
      bounds,
      worldCenter,
      show() {},
      hide() {
        group.visible = false;
      },
      update() {},
      dispose() {},
    };
  }

  for (const [lon, lat] of path) {
    const [x, y] = project(lon, lat);
    expandBounds(bounds, x, -y);
  }
  worldCenter.set(
    (bounds.minX + bounds.maxX) / 2,
    0,
    (bounds.minZ + bounds.maxZ) / 2,
  );

  const spanX = bounds.maxX - bounds.minX;
  const spanZ = bounds.maxZ - bounds.minZ;
  const span = Math.max(spanX, spanZ, 1);
  const slim = span < 90;
  const glowR = slim ? 2.0 : 4.2;
  const mainR = slim ? 0.95 : 2.0;
  const coreR = slim ? 0.4 : 0.85;
  const tubular = Math.max(64, path.length * 14);

  const mats = [];
  try {
    const glowMat = new THREE.MeshBasicMaterial({
      color: CRITICAL_RED,
      transparent: true,
      opacity: slim ? 0.28 : 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mainMat = new THREE.MeshBasicMaterial({
      color: CRITICAL_RED,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
    });
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    mats.push(glowMat, mainMat, coreMat);

    const glowTube = new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, glowR, 12, false), glowMat);
    glowTube.renderOrder = 28;
    group.add(glowTube);

    const mainTube = new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, mainR, 12, false), mainMat);
    mainTube.renderOrder = 29;
    group.add(mainTube);

    const coreTube = new THREE.Mesh(new THREE.TubeGeometry(curve, tubular, coreR, 10, false), coreMat);
    coreTube.renderOrder = 30;
    group.add(coreTube);
  } catch (err) {
    console.warn('[problemLinkAlert] tube failed', err);
  }

  const glowTex = makeGlowTexture();
  const anims = [];
  const flowCount = 6;
  for (let i = 0; i < flowCount; i++) {
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color: CRITICAL_RED,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const dotSize = slim ? 7 : 14;
    sprite.scale.set(dotSize, dotSize, 1);
    sprite.renderOrder = 40;
    group.add(sprite);
    anims.push({
      kind: 'flowDot',
      obj: sprite,
      curve,
      offset: i / flowCount,
      speed: 0.22,
      baseScale: dotSize,
    });
  }

  return {
    group,
    bounds,
    worldCenter,
    show() {
      group.visible = true;
    },
    hide() {
      group.visible = false;
    },
    update(time) {
      if (!group.visible) return;
      const pulse = 0.55 + 0.45 * Math.sin(time * 6);
      for (const mat of mats) {
        if (mat.color?.getHex() === 0xffffff) {
          mat.opacity = 0.2 + 0.25 * pulse;
        } else if (mat.blending === THREE.AdditiveBlending) {
          mat.opacity = (slim ? 0.18 : 0.12) + 0.2 * pulse;
        } else {
          mat.opacity = 0.55 + 0.4 * pulse;
        }
      }
      for (const a of anims) {
        if (a.kind !== 'flowDot') continue;
        const t = (a.offset + time * a.speed) % 1;
        const p = a.curve.getPoint(t);
        a.obj.position.copy(p);
        const s = a.baseScale * (0.75 + 0.35 * pulse);
        a.obj.scale.set(s, s, 1);
        a.obj.material.opacity = 0.55 + 0.4 * pulse;
      }
    },
    dispose() {
      group.traverse((obj) => {
        obj.geometry?.dispose?.();
        if (obj.material) {
          obj.material.map?.dispose?.();
          obj.material.dispose?.();
        }
      });
      glowTex.dispose();
    },
  };
}
