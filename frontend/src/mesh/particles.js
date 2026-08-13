import * as THREE from 'three';

const CLASS_COLOR = {
  express:   [1.0, 0.55, 0.05],
  arterial:  [0.05, 0.85, 1.0],
  collector: [0.15, 0.55, 0.95],
  local:     [0.05, 0.25, 0.55],
};

const CLASS_SIZE = { express: 2.8, arterial: 2.2, collector: 1.6, local: 1.2 };

/** 默认只挂主干，避免支路粒子落在「无路绘制」区域 */
const ALLOWED_CLASSES = new Set(['express', 'arterial']);

function makeDotTexture() {
  const s = 64;
  const cvs = document.createElement('canvas');
  cvs.width = cvs.height = s;
  const ctx = cvs.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.75)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(cvs);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * 车流粒子：严格沿路网折线运动，不做横向漂移
 */
export class FlowParticles {
  /**
   * @param {Array} roads
   * @param {number} maxParticles
   * @param {{
   *   allowedClasses?: string[],
   *   nearPoint?: { x:number, y:number },
   *   nearRadius?: number,
   *   speedScale?: number,
   * }} [opts]
   */
  constructor(roads, maxParticles = 6000, opts = {}) {
    this._flows = [];
    this._dotTex = makeDotTexture();
    this._allowed = new Set(opts.allowedClasses || [...ALLOWED_CLASSES]);
    this._nearPoint = opts.nearPoint || null;
    this._nearRadius = opts.nearRadius ?? Infinity;
    this._speedScale = opts.speedScale ?? 1;
    this._initFlows(roads, maxParticles);
    this._buildGeometry();
  }

  _roadNearFilter(road) {
    if (!this._nearPoint || !Number.isFinite(this._nearRadius)) return true;
    const mid = road.coords[Math.floor(road.coords.length / 2)];
    if (!mid) return false;
    const dx = mid[0] - this._nearPoint.x;
    const dy = mid[1] - this._nearPoint.y;
    return dx * dx + dy * dy <= this._nearRadius * this._nearRadius;
  }

  _initFlows(roads, maxParticles) {
    const sorted = [...roads]
      .filter((r) => this._allowed.has(r.roadClass))
      .filter((r) => this._roadNearFilter(r))
      .sort((a, b) => b.flow - a.flow);

    let total = 0;

    for (const road of sorted) {
      if (total >= maxParticles) break;
      const pts = road.coords;
      if (pts.length < 2) continue;

      const lenUnits = this._approxLen(pts);
      if (lenUnits < 0.5) continue;

      const lenM = road.props.distance_m || lenUnits * 10;
      const nParticles = Math.max(
        2,
        Math.min(12, Math.round(road.flow * lenM / 220)),
      );

      // 贴地折线；高度固定，禁止任何横向 offset
      const path3d = (road.inward ? pts : [...pts].reverse())
        .map(([x, y]) => new THREE.Vector3(x, 1.0, -y));

      const cum = [0];
      for (let i = 1; i < path3d.length; i++) {
        cum.push(cum[i - 1] + path3d[i].distanceTo(path3d[i - 1]));
      }
      const totalLen = cum[cum.length - 1];
      if (totalLen < 0.5) continue;

      // 可见流速：约 4–10s 跑完整段
      const baseSpeed = (0.0018 + road.flow * 0.0005) * this._speedScale;

      for (let i = 0; i < nParticles && total < maxParticles; i++) {
        this._flows.push({
          path: path3d,
          cum,
          totalLen,
          progress: (i / nParticles) + Math.random() * 0.08,
          speed: baseSpeed * (0.85 + Math.random() * 0.3),
          flow: road.flow,
          roadClass: road.roadClass,
        });
        total++;
      }
    }
  }

  _approxLen(coords) {
    let len = 0;
    for (let i = 1; i < coords.length; i++) {
      const dx = coords[i][0] - coords[i - 1][0];
      const dy = coords[i][1] - coords[i - 1][1];
      len += Math.sqrt(dx * dx + dy * dy);
    }
    return len;
  }

  _buildGeometry() {
    const n = this._flows.length;
    this._positions = new Float32Array(Math.max(n, 1) * 3);
    this._colors = new Float32Array(Math.max(n, 1) * 3);

    for (let i = 0; i < n; i++) {
      const f = this._flows[i];
      const [r, g, b] = CLASS_COLOR[f.roadClass] || CLASS_COLOR.arterial;
      const bright = 0.7 + 0.3 * Math.min(1, f.flow / 8);
      this._colors[i * 3]     = r * bright;
      this._colors[i * 3 + 1] = g * bright;
      this._colors[i * 3 + 2] = b * bright;
      const pos = this._interpolate(f, f.progress % 1);
      this._positions[i * 3]     = pos.x;
      this._positions[i * 3 + 1] = pos.y;
      this._positions[i * 3 + 2] = pos.z;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this._positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this._colors, 3));
    if (n === 0) {
      geo.setDrawRange(0, 0);
    }

    const mat = new THREE.PointsMaterial({
      map: this._dotTex,
      size: 2.4,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      // false：避免被渠化/底图深度挡住导致「看不见流动」
      depthTest: false,
      sizeAttenuation: true,
    });

    this.mesh = new THREE.Points(geo, mat);
    this.mesh.name = 'flowParticles';
    this.mesh.frustumCulled = false;
    this.mesh.visible = n > 0;
    this._geometry = geo;
  }

  _interpolate(flow, t) {
    const { path, cum, totalLen } = flow;
    if (path.length < 2) return path[0] || _tmp.set(0, 1, 0);
    const dist = Math.max(0, Math.min(1, t)) * totalLen;
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < dist) i++;
    const segLen = (cum[i + 1] - cum[i]) || 1e-6;
    const f = (dist - cum[i]) / segLen;
    return _tmp.lerpVectors(path[i], path[i + 1], f);
  }

  update() {
    if (!this._flows.length) return;
    for (let i = 0; i < this._flows.length; i++) {
      const flow = this._flows[i];
      flow.progress += flow.speed;
      if (flow.progress >= 1) flow.progress -= 1;

      const pos = this._interpolate(flow, flow.progress);
      this._positions[i * 3]     = pos.x;
      this._positions[i * 3 + 1] = pos.y;
      this._positions[i * 3 + 2] = pos.z;
    }
    this._geometry.attributes.position.needsUpdate = true;
  }

  setOpacity(op) {
    if (this.mesh?.material) {
      this.mesh.material.opacity = op;
      this.mesh.visible = op > 0.02 && this._flows.length > 0;
    }
  }

  setVisible(v) {
    if (this.mesh) this.mesh.visible = !!v && this._flows.length > 0;
  }

  dispose() {
    this._geometry?.dispose();
    this.mesh?.material?.map?.dispose();
    this.mesh?.material?.dispose();
    this._dotTex?.dispose();
  }

  get count() { return this._flows.length; }
}

const _tmp = new THREE.Vector3();
