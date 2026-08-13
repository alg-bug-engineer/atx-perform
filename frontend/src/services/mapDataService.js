let MAP_JSON_URL = '/jinan-full2.json';
let _cache = null;
let _loading = null;

export function setMapUrl(url) {
  MAP_JSON_URL = url;
  _cache = null;
}

export function getMapUrl() {
  return MAP_JSON_URL;
}

export async function getMapData() {
  if (_cache) return _cache;
  if (_loading) return _loading;

  _loading = fetch(MAP_JSON_URL)
    .then((res) => {
      if (!res.ok) throw new Error(`[mapDataService] 加载失败: ${res.status} ${MAP_JSON_URL}`);
      return res.json();
    })
    .then((data) => {
      _cache = data;
      _loading = null;
      return data;
    })
    .catch((err) => {
      _loading = null;
      throw err;
    });

  return _loading;
}
