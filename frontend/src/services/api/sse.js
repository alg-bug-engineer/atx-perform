/**
 * SSE over fetch（POST + ReadableStream）。
 * 后端 /agent/run/stream 为 POST + text/event-stream，EventSource（仅 GET）不适用。
 */

const MAX_RETRY = 3;

/**
 * @typedef {'connecting'|'open'|'closed'|'error'} StreamStatus
 * @typedef {{ event: string, data: unknown }} StreamEvent
 * @typedef {{
 *   onStatus?: (s: StreamStatus, attempt: number) => void,
 *   onEvent?: (ev: StreamEvent) => void,
 *   onFail?: (reason: string) => void,
 *   onDone?: () => void,
 * }} StreamHandlers
 * @typedef {{ close: () => void }} StreamController
 */

/** @param {string} block */
function parseFrame(block) {
  let event = 'message';
  const dataLines = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (!dataLines.length) return null;
  const raw = dataLines.join('\n');
  try {
    return { event, data: JSON.parse(raw) };
  } catch {
    return { event, data: raw };
  }
}

/**
 * 发起可重连的 POST SSE 流。收到 pipeline_complete/error 后不再重连。
 * @param {string} url
 * @param {unknown} body
 * @param {StreamHandlers} handlers
 * @returns {StreamController}
 */
export function streamPost(url, body, handlers) {
  let attempt = 0;
  let stopped = false;
  let terminal = false;
  const ctrl = new AbortController();

  const connectOnce = async () => {
    handlers.onStatus?.('connecting', attempt);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) throw new Error(`http_${res.status}`);
    handlers.onStatus?.('open', attempt);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const ev = parseFrame(block);
        if (!ev) continue;
        if (ev.event === 'pipeline_complete' || ev.event === 'error') terminal = true;
        handlers.onEvent?.(ev);
      }
    }
  };

  const run = async () => {
    while (!stopped) {
      try {
        await connectOnce();
        handlers.onDone?.();
        handlers.onStatus?.('closed', attempt);
        return;
      } catch (e) {
        if (stopped || (e instanceof DOMException && e.name === 'AbortError')) return;
        if (terminal) {
          handlers.onDone?.();
          return;
        }
        attempt += 1;
        handlers.onStatus?.('error', attempt);
        if (attempt > MAX_RETRY) {
          handlers.onFail?.(e instanceof Error ? e.message : String(e));
          handlers.onStatus?.('closed', attempt);
          return;
        }
        await new Promise((r) => setTimeout(r, 700 * attempt));
      }
    }
  };
  void run();

  return {
    close() {
      stopped = true;
      ctrl.abort();
    },
  };
}
