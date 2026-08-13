/**
 * Act1 首页：全市信控监控演示数据（静态 JSON，不走参考仓 API）
 */

let _cache = null;
let _loading = null;

/** 背景方案置顶：奥体西路廊道绝对首位；关联路口次之 */
const PIN_FIRST_IDS = new Set(['INT-JN-OTX-JFD', 'INT-JN-OTX-JS']);
/** 首页扫描结束后默认聚焦的拥堵廊道（奥体西路 解放东→经十 北向南） */
export const HOME_FOCUS_CORRIDOR_ID = 'COR-AOTIXI-JFD-JS';
/** 数据版本：指标字段补齐后递增，避免旧缓存缺 flow/imbalanceIndex */
const DEMO_DATA_VERSION = 5;

function pinRank(obj) {
  if (!obj) return 9;
  if (obj.id === HOME_FOCUS_CORRIDOR_ID) return 0;
  if (obj.pinFirst || PIN_FIRST_IDS.has(obj.id)) return 1;
  return 2;
}

export async function loadCityMonitorDemo() {
  if (_cache?.__v === DEMO_DATA_VERSION) return _cache;
  if (_loading) return _loading;
  _loading = fetch(`/data/city-monitor-demo.json?v=${DEMO_DATA_VERSION}`)
    .then((res) => {
      if (!res.ok) throw new Error(`city-monitor-demo.json HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      _cache = {
        __v: DEMO_DATA_VERSION,
        overview: data.cityOverview || {},
        regions: data.regions || [],
        corridors: data.corridors || [],
        intersections: data.intersections || [],
      };
      return _cache;
    })
    .finally(() => {
      _loading = null;
    });
  return _loading;
}

export function getCityMonitorDemoSync() {
  return _cache;
}

/**
 * 对齐参考仓 city-demo classify：
 * optimized → completed；optimizing → optimizing；
 * dynamic_ issues → dynIssue；signal_/static_ → bgIssue
 */
export function classifyMonitorQueue(demo) {
  const bgIssue = [];
  const dynIssue = [];
  const optimizing = [];
  const completed = [];

  function classify(obj, type) {
    const issues = obj.issues || [];
    const hasDynamic = issues.some((i) => String(i.id || '').startsWith('dynamic_'));
    const hasStatic = issues.some(
      (i) =>
        String(i.id || '').startsWith('signal_') ||
        String(i.id || '').startsWith('static_'),
    );
    if (obj.status === 'optimized') {
      completed.push({ obj, type });
    } else if (obj.status === 'optimizing') {
      optimizing.push({ obj, type });
    } else if (hasDynamic) {
      dynIssue.push({ obj, type });
    } else if (hasStatic) {
      bgIssue.push({ obj, type });
    }
  }

  (demo?.regions || []).forEach((r) => classify(r, 'region'));
  (demo?.corridors || []).forEach((c) => classify(c, 'corridor'));
  (demo?.intersections || []).forEach((i) => classify(i, 'intersection'));

  // 严重异常 > 预警 > 其他；背景方案：奥体西路廊道首位，关联路口次之
  const STATUS_RANK = {
    critical: 0,
    warning: 1,
    optimizing: 2,
    optimized: 3,
    normal: 4,
  };

  function sortIssueList(list, { pinFirst = false } = {}) {
    list.sort((a, b) => {
      if (pinFirst) {
        const ap = pinRank(a.obj);
        const bp = pinRank(b.obj);
        if (ap !== bp) return ap - bp;
      }
      const as = STATUS_RANK[a.obj?.status] ?? 9;
      const bs = STATUS_RANK[b.obj?.status] ?? 9;
      if (as !== bs) return as - bs;
      return (Number(b.obj?.saturation) || 0) - (Number(a.obj?.saturation) || 0);
    });
  }

  sortIssueList(bgIssue, { pinFirst: true });
  sortIssueList(dynIssue, { pinFirst: false });

  return { bgIssue, dynIssue, optimizing, completed };
}

export function typeLabel(type) {
  return { region: '区域', corridor: '干线', intersection: '路口' }[type] || type;
}

export function statusLabel(status) {
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

/** 简单稳定伪随机（对齐参考仓 mppSeededRand） */
function seededRand(seed, min, max) {
  let h = 0;
  const s = String(seed || '');
  for (let i = 0; i < s.length; i += 1) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return min + (Math.abs(h) % (max - min + 1));
}

/**
 * 路口实时指标：饱和度 / 实时流量 / 失衡指数
 * 字段对齐参考仓 mppRealtimeMetricDefs
 */
export function resolveIntersectionMetrics(target) {
  if (!target) return null;
  const sat = Number(
    target.saturation ??
      target.profile?.demand?.saturation ??
      target.profile?.state?.saturation ??
      0,
  );
  const flow = Number(
    target.flow ??
      target.profile?.demand?.peakHourFlow ??
      target.inFlow ??
      seededRand(`${target.id || ''}flowNow`, 1200, 2600),
  );
  let imbalance = Number(
    target.imbalanceIndex ??
      target.phaseImbalanceIndex ??
      target.profile?.state?.imbalanceIndex,
  );
  if (!Number.isFinite(imbalance)) {
    imbalance = Math.min(0.99, Math.max(0.12, (sat || 0.5) * 0.78));
  }

  const satColor = sat >= 0.88 ? '#ff4757' : sat >= 0.7 ? '#f5a623' : '#2ed573';
  const imbalanceColor =
    imbalance >= 0.7 ? '#ff4757' : imbalance >= 0.45 ? '#f5a623' : '#2ed573';

  return {
    name: target.name || target.id,
    status: target.status,
    kind: 'intersection',
    items: [
      {
        key: 'saturation',
        label: '实时饱和度',
        value: sat ? `${Math.round(sat * 100)}%` : '—',
        color: satColor,
      },
      {
        key: 'flow',
        label: '实时流量',
        value: flow ? `${Number(flow).toLocaleString()} pcu/h` : '—',
        color: '#1a7fff',
      },
      {
        key: 'imbalance',
        label: '失衡指数',
        value: Number.isFinite(imbalance) ? imbalance.toFixed(2) : '—',
        color: imbalanceColor,
      },
    ],
  };
}

/**
 * 干线实时指标：与路口卡同三项（饱和度 / 流量 / 失衡指数）
 * 奥体西路·解放东→经十：固定展示 Case C step 口径演示值
 */
export function resolveCorridorMetrics(target) {
  if (!target) return null;

  // 奥体西廊道：128% = 周一 step 208 经十北进口直行饱和度 1.2795
  if (target.id === HOME_FOCUS_CORRIDOR_ID) {
    return {
      name: target.name || target.id,
      status: target.status,
      kind: 'corridor',
      stepIndex: 208,
      stepLabel: 'step 208 · 17:20–17:25',
      items: [
        { key: 'saturation', label: '实时饱和度', value: '128%', color: '#ff4757' },
        { key: 'flow', label: '实时流量', value: '824 pcu/h', color: '#1a7fff' },
        { key: 'imbalance', label: '失衡指数', value: '0.8', color: '#ff4757' },
      ],
    };
  }

  const sat = Number(target.saturation ?? 0);
  const flow = Number(target.flow ?? seededRand(`${target.id || ''}flowNow`, 1200, 2600));
  let imbalance = Number(target.imbalanceIndex);
  if (!Number.isFinite(imbalance)) {
    imbalance = Math.min(0.99, Math.max(0.12, (sat || 0.5) * 0.78));
  }
  const satColor = sat >= 0.88 ? '#ff4757' : sat >= 0.7 ? '#f5a623' : '#2ed573';
  const imbalanceColor =
    imbalance >= 0.7 ? '#ff4757' : imbalance >= 0.45 ? '#f5a623' : '#2ed573';

  return {
    name: target.name || target.id,
    status: target.status,
    kind: 'corridor',
    items: [
      {
        key: 'saturation',
        label: '实时饱和度',
        value: sat ? `${Math.round(sat * 100)}%` : '—',
        color: satColor,
      },
      {
        key: 'flow',
        label: '实时流量',
        value: flow ? `${Number(flow).toLocaleString()} pcu/h` : '—',
        color: '#1a7fff',
      },
      {
        key: 'imbalance',
        label: '失衡指数',
        value: Number.isFinite(imbalance) ? imbalance.toFixed(2) : '—',
        color: imbalanceColor,
      },
    ],
  };
}

/** 路口 / 干线统一解析指标卡数据 */
export function resolveMonitorMetrics(type, target) {
  if (type === 'intersection') return resolveIntersectionMetrics(target);
  if (type === 'corridor') return resolveCorridorMetrics(target);
  return null;
}

export function findMonitorObject(demo, type, id) {
  if (!demo || !type || !id) return null;
  if (type === 'region') return (demo.regions || []).find((r) => r.id === id) || null;
  if (type === 'corridor') return (demo.corridors || []).find((c) => c.id === id) || null;
  if (type === 'intersection') {
    return (demo.intersections || []).find((i) => i.id === id) || null;
  }
  return null;
}
