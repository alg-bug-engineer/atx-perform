import * as THREE from 'three';
import { loadGeoData } from '../../geo/loader.js';
import { createDecorations } from '../../mesh/decorations.js';
import { createRoadMeshes } from '../../mesh/roads.js';

export async function createJinanBaseMapLayer({ showRoads = true } = {}) {
  const { roads, intersections, bounds } = await loadGeoData();

  const group = new THREE.Group();
  group.name = 'jinanBaseMap';

  const decorations = createDecorations(intersections);
  group.add(decorations);

  const roadMeshGroup = createRoadMeshes(roads);
  roadMeshGroup.traverse((obj) => {
    if (obj.material) obj.userData.origOpacity = obj.material.opacity;
  });
  if (showRoads) group.add(roadMeshGroup);

  function update(time) {
    decorations.update?.(time);
  }

  function dispose() {
    group.traverse((obj) => {
      obj.geometry?.dispose();
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else obj.material?.dispose?.();
    });
  }

  return {
    group,
    roads,
    intersections,
    bounds,
    roadMeshGroup,
    update,
    dispose,
  };
}
