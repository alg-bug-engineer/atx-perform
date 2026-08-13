import * as THREE from 'three';
import { project } from '../geo/loader.js';

function toShapePoint([lon, lat]) {
  const [x, y] = project(lon, lat);
  return new THREE.Vector2(x, y);
}

function toLinePositions(ring, y = 0.04) {
  const positions = [];
  for (let i = 0; i < ring.length; i++) {
    const [x, north] = project(ring[i][0], ring[i][1]);
    positions.push(x, y, -north);
  }
  return positions;
}

function createPolygonMesh(polygon, fillMaterial) {
  if (!polygon.length || polygon[0].length < 3) return null;

  const shape = new THREE.Shape(polygon[0].map(toShapePoint));
  for (let i = 1; i < polygon.length; i++) {
    if (polygon[i].length < 3) continue;
    shape.holes.push(new THREE.Path(polygon[i].map(toShapePoint)));
  }

  const geometry = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geometry, fillMaterial);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.08;
  return mesh;
}

function createBoundaryLines(polygons, lineMaterial) {
  const group = new THREE.Group();

  for (const polygon of polygons) {
    for (const ring of polygon) {
      if (ring.length < 2) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(toLinePositions(ring), 3));
      group.add(new THREE.LineLoop(geometry, lineMaterial));
    }
  }

  return group;
}

function getPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function createDistrictLabel(name, lonlat) {
  if (!name || !lonlat) return null;

  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 80, 200, 0.9)';
  ctx.shadowBlur = 14;
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0, 20, 60, 0.9)';
  ctx.strokeText(name, canvas.width / 2, canvas.height / 2);
  ctx.fillStyle = '#7ec8f5'; // 科技青蓝
  ctx.fillText(name, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: false,
  });

  const [x, y] = project(lonlat[0], lonlat[1]);
  const sprite = new THREE.Sprite(material);
  sprite.name = `${name}_label`;
  sprite.position.set(x, 8, -y);
  sprite.scale.set(85, 32, 1);
  return sprite;
}

export async function createDistrictLayer(url = '/jinan.geojson') {
  const resp = await fetch(url);
  const geojson = await resp.json();

  const group = new THREE.Group();
  group.name = 'districts';

  const fillMaterial = new THREE.MeshBasicMaterial({
    color: 0x041a38, // 科技深蓝填充
    transparent: true,
    opacity: 0.30,   // 降低至 30%，让 OSM 底图透出来
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false,
  });

  const lineMaterial = new THREE.LineBasicMaterial({
    color: 0x1a6fc4, // 科技蓝边界线
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    depthTest: false,
  });

  for (const feature of geojson.features || []) {
    const polygons = getPolygons(feature.geometry);
    const district = new THREE.Group();
    district.name = feature.properties?.name || 'district';

    for (const polygon of polygons) {
      const mesh = createPolygonMesh(polygon, fillMaterial);
      if (mesh) district.add(mesh);
    }
    district.add(createBoundaryLines(polygons, lineMaterial));

    const label = createDistrictLabel(
      feature.properties?.name,
      feature.properties?.centroid || feature.properties?.center,
    );
    if (label) district.add(label);

    group.add(district);
  }

  group.dispose = () => {
    group.traverse(obj => {
      obj.geometry?.dispose();
      obj.material?.map?.dispose();
      obj.material?.dispose();
    });
    fillMaterial.dispose();
    lineMaterial.dispose();
  };

  return group;
}
