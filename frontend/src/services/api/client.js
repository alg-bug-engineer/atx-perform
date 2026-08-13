/**
 * 统一 HTTP 客户端：非 2xx / 网络错误规整为 { ok: false }，不抛裸异常。
 */

const BASE = '/api/v1';

/**
 * @typedef {{ ok: false, reason: string, detail?: unknown }} ApiError
 */

/** @param {unknown} x */
export function isApiError(x) {
  return !!x && typeof x === 'object' && /** @type {ApiError} */ (x).ok === false;
}

/**
 * @template T
 * @param {string} path
 * @param {unknown} [body]
 * @param {AbortSignal} [signal]
 * @returns {Promise<T | ApiError>}
 */
export async function postJSON(path, body, signal) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
      signal,
    });
    if (!res.ok) {
      let detail = null;
      try {
        detail = await res.json();
      } catch {
        /* ignore */
      }
      return { ok: false, reason: `http_${res.status}`, detail };
    }
    return /** @type {T} */ (await res.json());
  } catch (e) {
    const reason = e instanceof DOMException && e.name === 'AbortError' ? 'aborted' : 'network_error';
    return { ok: false, reason, detail: String(e) };
  }
}

/**
 * @template T
 * @param {string} path
 * @param {Record<string, string|number|undefined>} [params]
 * @returns {Promise<T | ApiError>}
 */
export async function getJSON(path, params) {
  try {
    const qs = params
      ? `?${Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')}`
      : '';
    const res = await fetch(`${BASE}${path}${qs}`);
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return /** @type {T} */ (await res.json());
  } catch (e) {
    return { ok: false, reason: 'network_error', detail: String(e) };
  }
}
