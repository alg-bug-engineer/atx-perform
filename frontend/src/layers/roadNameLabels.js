/**
 * 路旁轻量道路名（对齐 agent-loop Act2 createRoadNameLabel）
 * 无重框，仅青字 + 微光 + 底部分隔细线，Sprite 始终朝向相机。
 */
import * as THREE from 'three';

export function createRoadNameLabel(text, { accent = '#7ee9ff' } = {}) {
  const fontSize = 26;
  const padX = 8;
  const padY = 6;
  const font = `500 ${fontSize}px "PingFang SC","Microsoft YaHei",sans-serif`;

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const tw = Math.ceil(measure.measureText(String(text || '')).width);

  const canvas = document.createElement('canvas');
  canvas.width = tw + padX * 2 + 8;
  canvas.height = fontSize + padY * 2 + 10;
  const ctx = canvas.getContext('2d');

  const cx = canvas.width / 2;
  const cy = canvas.height / 2 - 1;
  const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, canvas.width * 0.55);
  glow.addColorStop(0, 'rgba(0, 40, 60, 0.35)');
  glow.addColorStop(1, 'rgba(0, 20, 40, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(4, 14, 26, 0.75)';
  ctx.strokeText(text, cx, cy);
  ctx.fillStyle = accent;
  ctx.shadowColor = 'rgba(0, 212, 240, 0.55)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, cx, cy);
  ctx.shadowBlur = 0;

  ctx.strokeStyle = 'rgba(0, 212, 240, 0.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx - tw * 0.45, cy + fontSize * 0.55);
  ctx.lineTo(cx + tw * 0.45, cy + fontSize * 0.55);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    opacity: 1,
    depthWrite: false,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(mat);
  const scale = 0.22;
  sprite.scale.set(canvas.width * scale, canvas.height * scale, 1);
  sprite.frustumCulled = false;
  sprite.renderOrder = 60;
  sprite.center.set(0.5, 0.5);
  sprite.userData.disposeLabel = () => {
    tex.dispose();
    mat.dispose();
  };
  return sprite;
}

/**
 * @param {{ name: string, anchor: { x: number, y?: number, z: number }, accent?: string }[]} labels
 */
export function createRoadNameLabelLayer(labels) {
  const group = new THREE.Group();
  group.name = 'roadNameLabels';
  const items = [];

  for (const lab of labels || []) {
    if (!lab?.name || !lab.anchor) continue;
    const ns = lab.name.includes('奥体西');
    const spr = createRoadNameLabel(lab.name, {
      accent: lab.accent || (ns ? '#9aefff' : '#7ee9ff'),
    });
    spr.position.set(lab.anchor.x, lab.anchor.y ?? 10, lab.anchor.z);
    spr.userData.roadName = lab.name;
    group.add(spr);
    items.push(spr);
  }

  group.setVisibleNames = (names) => {
    if (!names) {
      items.forEach((spr) => {
        spr.visible = true;
      });
      return;
    }
    const keep = new Set(names);
    items.forEach((spr) => {
      spr.visible = keep.has(spr.userData.roadName);
    });
  };

  group.dispose = () => {
    items.forEach((spr) => spr.userData.disposeLabel?.());
  };

  return group;
}
