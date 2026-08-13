import { shallowRef, ref } from 'vue';

export const selectedEntity = shallowRef(null);
export const activeSceneKey = shallowRef('traffic-origin');

// OD 区域叠加层是否可见（全域扫描完成后置 true）
export const odZonesVisible = ref(false);

export function showOdZones() {
  odZonesVisible.value = true;
}

export function setSelection(selection) {
  selectedEntity.value = selection;
}

export function clearSelection() {
  selectedEntity.value = null;
}

export function setActiveScene(key) {
  activeSceneKey.value = key;
  // 切换场景时清除上一个场景的选中态
  selectedEntity.value = null;
}
