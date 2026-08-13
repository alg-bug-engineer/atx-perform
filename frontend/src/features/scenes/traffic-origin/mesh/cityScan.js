import * as THREE from 'three';

function createScanTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 32;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, 0);

  gradient.addColorStop(0.00, 'rgba(0, 255, 255, 0)');
  gradient.addColorStop(0.38, 'rgba(0, 255, 255, 0.12)');
  gradient.addColorStop(0.50, 'rgba(255, 255, 255, 0.95)');
  gradient.addColorStop(0.62, 'rgba(0, 255, 255, 0.18)');
  gradient.addColorStop(1.00, 'rgba(0, 255, 255, 0)');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createCityScan(bounds) {
  const group = new THREE.Group();
  group.name = 'cityScan';

  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const padding = Math.max(width, height) * 0.08;
  const bandWidth = Math.max(60, width * 0.045);
  const centerNorth = (bounds.minY + bounds.maxY) / 2;

  const texture = createScanTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  });

  const geometry = new THREE.PlaneGeometry(bandWidth, height + padding * 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(bounds.minX - padding, 1.2, -centerNorth);
  mesh.visible = false;
  group.add(mesh);

  let startTime = -Infinity;
  const duration = 3.2;
  const startX = bounds.minX - padding;
  const endX = bounds.maxX + padding;

  group.trigger = (time = performance.now() / 1000) => {
    startTime = time;
    mesh.visible = true;
  };

  group.update = (time) => {
    const progress = (time - startTime) / duration;
    if (progress < 0 || progress > 1) {
      mesh.visible = false;
      material.opacity = 0;
      return;
    }

    mesh.position.x = startX + (endX - startX) * progress;
    material.opacity = Math.sin(progress * Math.PI) * 0.75;
  };

  group.dispose = () => {
    geometry.dispose();
    texture.dispose();
    material.dispose();
  };

  return group;
}
