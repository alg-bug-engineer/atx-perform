/**
 * Act1 首页：全市监控区域 / 干线 / 路口叠加（Three.js）
 * 交互对齐参考仓 city-demo：overview ↔ focused analysis
 * 路口/干线聚焦视觉：高德式贴地扁平色带、光晕节点、脉冲环、分析标签
 */
import * as THREE from 'three';
import { buildFlatBand } from './flatBand.js';

const STATUS_COLOR = {
  critical: 0xff4757,
  warning: 0xf5a623,
  optimizing: 0xa8a0f8,
  optimized: 0x2ed573,
  normal: 0x6b8cb0,
};
const SELECT_BLUE = 0x1a7fff;
const FLOW_TEAL = 0x00d4b4;

function statusColor(status) {
  return STATUS_COLOR[status] || STATUS_COLOR.normal;
}

function toShapePoint(project, [lon, lat]) {
  const [x, y] = project(lon, lat);
  return new THREE.Vector2(x, y);
}

function disposeObject(obj) {
  obj.traverse?.((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) {
      child.material.forEach((m) => {
        m.map?.dispose?.();
        m.dispose?.();
      });
    } else {
      child.material?.map?.dispose?.();
      child.material?.dispose?.();
    }
  });
}

function expandBounds(bounds, x, z) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.minZ = Math.min(bounds.minZ, z);
  bounds.maxZ = Math.max(bounds.maxZ, z);
}

function emptyBounds() {
  return {
    minX: Infinity,
    maxX: -Infinity,
    minZ: Infinity,
    maxZ: -Infinity,
  };
}

function boundsCenter(bounds) {
  if (!Number.isFinite(bounds.minX)) return null;
  return new THREE.Vector3(
    (bounds.minX + bounds.maxX) / 2,
    0,
    (bounds.minZ + bounds.maxZ) / 2,
  );
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function statusLabel(status) {
  return (
    {
      critical: '严重异常',
      warning: '预警',
      optimizing: '优化中',
      optimized: '已完成',
      normal: '运行中',
    }[status] || status || '—'
  );
}

/**
 * @param {{ project: (lon:number, lat:number) => [number, number] }} opts
 */
export function createCityMonitorMapFx({ project }) {
  const group = new THREE.Group();
  group.name = 'cityMonitorMapFx';
  group.visible = false;

  const overviewGroup = new THREE.Group();
  overviewGroup.name = 'monitorOverview';
  const regionGroup = new THREE.Group();
  regionGroup.name = 'monitorRegions';
  const corridorGroup = new THREE.Group();
  corridorGroup.name = 'monitorCorridors';
  const interGroup = new THREE.Group();
  interGroup.name = 'monitorIntersections';
  overviewGroup.add(regionGroup, corridorGroup, interGroup);

  const focusGroup = new THREE.Group();
  focusGroup.name = 'monitorFocus';

  group.add(overviewGroup, focusGroup);

  const glowTex = makeGlowTexture();
  /** @type {{ kind: string, obj: any, t0?: number }[]} */
  let anims = [];
  let demo = null;
  let selection = null;

  function clearChildren(g) {
    while (g.children.length) {
      const child = g.children.pop();
      disposeObject(child);
    }
  }

  function clearFocusVisuals() {
    clearChildren(focusGroup);
    anims = [];
  }

  function makeAnalysisLabel(title, sub, tone = 'normal') {
    const dpr = 2;
    const padX = 28;
    const padY = 14;
    const titleSize = 28;
    const subSize = 16;
    const gap = 8;
    // 中文字体 measureText 常偏窄，额外加余量避免首尾被裁切
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `bold ${titleSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
    const titleW = Math.ceil(measure.measureText(String(title || '')).width * 1.08);
    measure.font = `600 ${subSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
    const subW = sub ? Math.ceil(measure.measureText(String(sub)).width * 1.08) : 0;
    const contentW = Math.max(titleW, subW);
    const cssW = Math.max(240, contentW + padX * 2);
    const cssH = padY * 2 + titleSize + (sub ? gap + subSize : 0);
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(cssW * dpr);
    canvas.height = Math.ceil(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const border =
      tone === 'danger'
        ? 'rgba(255,71,87,0.55)'
        : tone === 'warn'
          ? 'rgba(245,166,35,0.5)'
          : 'rgba(26,127,255,0.45)';
    const titleColor =
      tone === 'danger' ? '#ffd7dc' : tone === 'warn' ? '#ffe3b0' : '#e8f0ff';

    ctx.fillStyle = 'rgba(6,12,24,0.94)';
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    roundRect(ctx, 1, 1, cssW - 2, cssH - 2, 10);
    ctx.fill();
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${titleSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
    ctx.fillStyle = titleColor;
    ctx.fillText(String(title || ''), cssW / 2, padY + titleSize / 2);

    if (sub) {
      ctx.font = `600 ${subSize}px "PingFang SC","Microsoft YaHei",sans-serif`;
      ctx.fillStyle = 'rgba(180,205,230,0.95)';
      ctx.fillText(String(sub), cssW / 2, padY + titleSize + gap + subSize / 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    // 世界尺度随画布宽高比变化，避免长标题被裁切
    const worldH = 16;
    sprite.scale.set(worldH * (cssW / cssH), worldH, 1);
    sprite.renderOrder = 45;
    sprite.userData.isLabel = true;
    return sprite;
  }

  function toneFromStatus(status) {
    if (status === 'critical') return 'danger';
    if (status === 'warning') return 'warn';
    return 'normal';
  }

  function addRegion(region, parent, { emphasized = false } = {}) {
    const ring = region.polygon;
    if (!Array.isArray(ring) || ring.length < 3) return null;

    const color = statusColor(region.status);
    const node = new THREE.Group();
    node.name = region.id;

    const fillMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: emphasized ? 0.18 : 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    const shape = new THREE.Shape(ring.map((p) => toShapePoint(project, p)));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = emphasized ? 0.35 : 0.2;
    mesh.renderOrder = emphasized ? 28 : 20;
    node.add(mesh);

    const linePositions = [];
    const bounds = emptyBounds();
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = project(ring[i][0], ring[i][1]);
      linePositions.push(x, emphasized ? 0.55 : 0.35, -y);
      expandBounds(bounds, x, -y);
    }
    const [x0, y0] = project(ring[0][0], ring[0][1]);
    linePositions.push(x0, emphasized ? 0.55 : 0.35, -y0);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    node.add(
      new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: emphasized ? 0.95 : 0.55,
          depthWrite: false,
        }),
      ),
    );

    parent.add(node);
    return bounds;
  }

  function pathToCurve(path, y = 1.4) {
    const pts = path.map(([lon, lat]) => {
      const [x, north] = project(lon, lat);
      return new THREE.Vector3(x, y, -north);
    });
    if (pts.length < 2) return null;
    // chordal + 低张力，减少对折线点位的“拉直”，更贴底图路形
    return new THREE.CatmullRomCurve3(pts, false, 'chordal', 0.05);
  }

  function addCorridor(corridor, parent, { emphasized = false } = {}) {
    const path = corridor.path;
    if (!Array.isArray(path) || path.length < 2) return null;

    const color = statusColor(corridor.status);
    const bounds = emptyBounds();
    for (const pt of path) {
      const [x, y] = project(pt[0], pt[1]);
      expandBounds(bounds, x, -y);
    }

    if (!emphasized) {
      const positions = [];
      for (const pt of path) {
        const [x, y] = project(pt[0], pt[1]);
        positions.push(x, 0.6, -y);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const line = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.62,
          depthWrite: false,
        }),
      );
      line.renderOrder = 22;
      parent.add(line);
      return bounds;
    }

    // —— 聚焦干线：高德式静态实色带（深色描边 + 圆头端帽，无光晕/无白核/无闪烁）——
    const curve = pathToCurve(path, 1.35);
    if (!curve) return bounds;

    const spanX = bounds.maxX - bounds.minX;
    const spanZ = bounds.maxZ - bounds.minZ;
    const span = Math.max(spanX, spanZ, 1);
    // 短廊道/窄路用更细带宽，避免「色块贴纸」盖住底图车道
    const slim = span < 90;
    // 高德式贴地扁平色带：宽度克制 + 末端楔形收细，无圆头/无光晕/无闪烁
    const casingColor = new THREE.Color(color).multiplyScalar(0.42);
    const band = buildFlatBand(curve, {
      halfWidth: slim ? 1.2 : 1.8,
      casing: 0.35,
      color,
      casingColor: casingColor.getHex(),
      y: 0.9,
      taper: 0.78,
    });
    parent.add(band.group);

    const hot = corridor.status === 'critical' || (corridor.saturation || 0) >= 0.85;

    const mid = curve.getPoint(0.5);
    const issueHint = corridor.issues?.[0]?.name || '';
    const sub = hot
      ? (issueHint ? `拥堵 · ${issueHint}` : `拥堵 · ${statusLabel(corridor.status)}`)
      : `干线 · ${statusLabel(corridor.status)}`;
    const label = makeAnalysisLabel(
      corridor.name || corridor.id,
      sub,
      toneFromStatus(corridor.status),
    );
    label.position.set(mid.x, 22, mid.z);
    parent.add(label);

    return bounds;
  }

  function addIntersectionMarker(inter, parent, { emphasized = false } = {}) {
    const lng = inter.lng ?? inter.center?.[0];
    const lat = inter.lat ?? inter.center?.[1];
    if (lng == null || lat == null) return null;

    const color = statusColor(inter.status);
    const [x, y] = project(lng, lat);
    const z = -y;
    const bounds = emptyBounds();
    expandBounds(bounds, x, z);

    if (!emphasized) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(2.2, 10, 10),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
      );
      mesh.position.set(x, 1.8, z);
      mesh.renderOrder = 23;
      parent.add(mesh);
      return { bounds, worldPos: new THREE.Vector3(x, 0, z) };
    }

    // —— 聚焦路口：光晕 + 白边核心 + 脉冲环 + 标签 ——
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.position.set(x, 4, z);
    halo.scale.set(48, 48, 1);
    halo.renderOrder = 33;
    parent.add(halo);
    anims.push({ kind: 'haloPulse', obj: halo, base: 48, amp: 10 });

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(5.5, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(x, 1.2, z);
    disc.renderOrder = 34;
    parent.add(disc);

    const rim = new THREE.Mesh(
      new THREE.RingGeometry(5.5, 7.2, 40),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(x, 1.25, z);
    rim.renderOrder = 35;
    parent.add(rim);

    // 选择态蓝环（参考 selectedHighlight）
    const selectRing = new THREE.Mesh(
      new THREE.RingGeometry(12, 14.5, 48),
      new THREE.MeshBasicMaterial({
        color: SELECT_BLUE,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    selectRing.rotation.x = -Math.PI / 2;
    selectRing.position.set(x, 0.8, z);
    selectRing.renderOrder = 32;
    parent.add(selectRing);

    // 涟漪环 ×2
    for (let i = 0; i < 2; i++) {
      const ripple = new THREE.Mesh(
        new THREE.RingGeometry(8, 9.2, 48),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.55,
          side: THREE.DoubleSide,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        }),
      );
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.set(x, 0.9, z);
      ripple.renderOrder = 31;
      parent.add(ripple);
      anims.push({
        kind: 'ripple',
        obj: ripple,
        phase: i * 0.5,
        duration: 2.2,
      });
    }

    const label = makeAnalysisLabel(
      inter.name || inter.id,
      `路口 · ${statusLabel(inter.status)}`,
      toneFromStatus(inter.status),
    );
    label.position.set(x, 28, z);
    parent.add(label);

    // 关联干线弱显示（仅装饰，不参与镜头包围盒，避免镜头飞到走廊中点）
    const related = (demo?.corridors || []).filter((c) =>
      (c.intersectionIds || []).includes(inter.id),
    );
    related.slice(0, 2).forEach((c) => {
      if (!c.path?.length) return;
      try {
        const curve = pathToCurve(c.path, 1.1);
        if (!curve) return;
        const tube = new THREE.Mesh(
          new THREE.TubeGeometry(curve, Math.max(24, c.path.length * 4), 1.4, 6, false),
          new THREE.MeshBasicMaterial({
            color: statusColor(c.status),
            transparent: true,
            opacity: 0.35,
            depthWrite: false,
          }),
        );
        tube.renderOrder = 26;
        parent.add(tube);
      } catch (err) {
        console.warn('[cityMonitor] related corridor failed', c.id, err);
      }
    });

    // 镜头包围盒只围路口近域（对齐参考仓 setZoomAndCenter）
    expandBounds(bounds, x - 55, z - 55);
    expandBounds(bounds, x + 55, z + 55);
    return { bounds, worldPos: new THREE.Vector3(x, 0, z) };
  }

  function addRegionSelectHighlight(region, parent) {
    const ring = region.polygon;
    if (!Array.isArray(ring) || ring.length < 3) return;

    const fillMat = new THREE.MeshBasicMaterial({
      color: SELECT_BLUE,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      depthTest: false,
    });
    const shape = new THREE.Shape(ring.map((p) => toShapePoint(project, p)));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), fillMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.45;
    mesh.renderOrder = 29;
    parent.add(mesh);

    const linePositions = [];
    for (let i = 0; i < ring.length; i++) {
      const [x, y] = project(ring[i][0], ring[i][1]);
      linePositions.push(x, 0.7, -y);
    }
    const [x0, y0] = project(ring[0][0], ring[0][1]);
    linePositions.push(x0, 0.7, -y0);
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));
    parent.add(
      new THREE.Line(
        lineGeo,
        new THREE.LineBasicMaterial({
          color: SELECT_BLUE,
          transparent: true,
          opacity: 1,
          depthWrite: false,
        }),
      ),
    );
  }

  function buildOverview() {
    clearChildren(regionGroup);
    clearChildren(corridorGroup);
    clearChildren(interGroup);
    // 监控区域默认不上屏：仅当左侧点击对应区域时由 setSelection 画到 focusGroup
    (demo?.corridors || []).forEach((c) => {
      if (c.status === 'normal') return;
      addCorridor(c, corridorGroup, { emphasized: false });
    });
    (demo?.intersections || []).forEach((i) => {
      if (
        i.status === 'critical' ||
        i.status === 'warning' ||
        i.status === 'optimizing'
      ) {
        addIntersectionMarker(i, interGroup, { emphasized: false });
      }
    });
  }

  /**
   * @returns {null | { worldPos: THREE.Vector3, type: string, bounds: object }}
   */
  function setSelection(type, id) {
    selection = type && id ? { type, id } : null;
    clearFocusVisuals();

    if (!selection || !demo) {
      overviewGroup.visible = true;
      return null;
    }

    overviewGroup.visible = false;

    let bounds = emptyBounds();
    let worldPos = null;

    try {
      if (type === 'region') {
        const region = (demo.regions || []).find((r) => r.id === id);
        if (!region) {
          overviewGroup.visible = true;
          return null;
        }
        const b = addRegion(region, focusGroup, { emphasized: true });
        if (b) bounds = b;
        addRegionSelectHighlight(region, focusGroup);
        if (region.center) {
          const [x, y] = project(region.center[0], region.center[1]);
          worldPos = new THREE.Vector3(x, 0, -y);
          const label = makeAnalysisLabel(
            region.name || region.id,
            `区域 · ${statusLabel(region.status)}`,
            toneFromStatus(region.status),
          );
          label.position.set(x, 22, -y);
          focusGroup.add(label);
        } else {
          worldPos = boundsCenter(bounds);
        }
      } else if (type === 'corridor') {
        const corridor = (demo.corridors || []).find((c) => c.id === id);
        if (!corridor) {
          overviewGroup.visible = true;
          return null;
        }
        const b = addCorridor(corridor, focusGroup, { emphasized: true });
        if (b) bounds = b;
        worldPos = boundsCenter(bounds);
        if (!worldPos && corridor.path?.length) {
          const mid = corridor.path[Math.floor(corridor.path.length / 2)];
          const [x, y] = project(mid[0], mid[1]);
          worldPos = new THREE.Vector3(x, 0, -y);
        }
      } else if (type === 'intersection') {
        const inter = (demo.intersections || []).find((i) => i.id === id);
        if (!inter) {
          overviewGroup.visible = true;
          return null;
        }
        const result = addIntersectionMarker(inter, focusGroup, { emphasized: true });
        if (result?.bounds) bounds = result.bounds;
        // 路口镜头必须对准路口本身，不能被关联干线包围盒带偏
        worldPos = result?.worldPos || null;
        if (!worldPos) {
          const lng = inter.lng ?? inter.center?.[0];
          const lat = inter.lat ?? inter.center?.[1];
          if (lng != null && lat != null) {
            const [x, y] = project(lng, lat);
            worldPos = new THREE.Vector3(x, 0, -y);
            bounds = emptyBounds();
            expandBounds(bounds, x - 55, -y - 55);
            expandBounds(bounds, x + 55, -y + 55);
          }
        }
      }
    } catch (err) {
      console.warn('[cityMonitor] setSelection failed', type, id, err);
      overviewGroup.visible = true;
      clearFocusVisuals();
      return null;
    }

    if (!worldPos) return null;
    return {
      worldPos,
      type,
      bounds: Number.isFinite(bounds.minX) ? bounds : null,
    };
  }

  function setData(nextDemo) {
    demo = nextDemo;
    clearFocusVisuals();
    if (!demo) {
      clearChildren(regionGroup);
      clearChildren(corridorGroup);
      clearChildren(interGroup);
      group.visible = false;
      return null;
    }
    buildOverview();
    group.visible = true;
    overviewGroup.visible = !selection;
    if (selection) return setSelection(selection.type, selection.id);
    return null;
  }

  function update(time = performance.now() / 1000) {
    for (const a of anims) {
      if (a.kind === 'flowDot' && a.curve && a.obj) {
        const t = (time * a.speed + a.offset) % 1;
        const p = a.curve.getPoint(t);
        a.obj.position.copy(p);
        a.obj.position.y += 1.2;
        const pulse = 0.75 + Math.sin(time * 6 + a.offset * 8) * 0.25;
        a.obj.scale.setScalar(12 * pulse);
      } else if (a.kind === 'ripple' && a.obj) {
        const u = ((time / a.duration) + a.phase) % 1;
        const s = 1 + u * 2.2;
        a.obj.scale.set(s, s, s);
        a.obj.material.opacity = (1 - u) * 0.55;
      } else if (a.kind === 'haloPulse' && a.obj) {
        const s = a.base + Math.sin(time * 2.4) * a.amp;
        a.obj.scale.set(s, s, 1);
        a.obj.material.opacity = 0.72 + Math.sin(time * 2.4) * 0.18;
      }
    }
  }

  function clear() {
    selection = null;
    clearFocusVisuals();
    clearChildren(regionGroup);
    clearChildren(corridorGroup);
    clearChildren(interGroup);
    overviewGroup.visible = true;
    group.visible = false;
  }

  function dispose() {
    clear();
    glowTex.dispose();
    demo = null;
  }

  return {
    group,
    setData,
    setSelection,
    update,
    clear,
    dispose,
  };
}
