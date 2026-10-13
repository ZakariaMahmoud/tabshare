import { parseInputMessage } from './input.js';

const OPEN = 1;
const MAX_BUFFERED_BYTES = 2_000_000; // drop frames for slow viewers instead of queueing
const MAX_INPUTS_PER_SECOND = 120;
const MAX_QUEUED_INPUTS = 50;

const sendJson = (ws, payload) => {
  if (ws.readyState === OPEN) ws.send(JSON.stringify(payload));
};

function createInputLimiter(now) {
  let windowStart = now();
  let count = 0;
  return () => {
    const t = now();
    if (t - windowStart >= 1000) {
      windowStart = t;
      count = 0;
    }
    count += 1;
    return count <= MAX_INPUTS_PER_SECOND;
  };
}

/**
 * Fans one share's frames out to its viewers. Streaming runs only while someone is watching.
 * Dependencies are injected so this can be tested without a browser.
 */
export function createHub({ share, session, startStreamer, applyInput, quality, log, now = Date.now }) {
  const viewers = new Set();
  let streamer = null;
  let starting = null;
  let lastFrame = null;
  let admitted = 0;

  const broadcast = (frame) => {
    lastFrame = frame;
    for (const ws of viewers) {
      if (ws.readyState === OPEN && ws.bufferedAmount < MAX_BUFFERED_BYTES) ws.send(frame);
    }
  };

  async function ensureStreaming() {
    if (streamer) return;
    starting ??= startStreamer(session.page, { quality, onFrame: broadcast, log })
      .then((s) => {
        streamer = s;
      })
      .finally(() => {
        starting = null;
      });
    await starting;
  }

  async function stopStreaming() {
    if (starting) await starting.catch(() => {});
    const s = streamer;
    streamer = null;
    if (s) await s.stop();
  }

  const stopIfIdle = () => {
    if (viewers.size === 0) stopStreaming().catch((err) => log.warn(`[hub ${share.id}] stop failed: ${err.message}`));
  };

  function handleInput(ws, data, isBinary) {
    if (!share.allowControl || isBinary || !ws.allowInput()) return;
    const input = parseInputMessage(data.toString());
    if (!input) return;
    if (ws.queuedInputs >= MAX_QUEUED_INPUTS) return;
    ws.queuedInputs += 1;
    // Replay in order (mouse down must precede up); input may arrive before the first frame,
    // so fall back to the page viewport for coordinates.
    ws.inputChain = ws.inputChain
      .then(() => {
        const size = streamer?.getSize() ?? session.page.viewportSize?.() ?? { width: 0, height: 0 };
        return applyInput(session.page, size, input);
      })
      .catch((err) => log.warn(`[hub ${share.id}] input failed: ${err.message}`))
      .finally(() => {
        ws.queuedInputs -= 1;
      });
  }

  return Object.freeze({
    /** Returns 'ok', 'full' or 'link_used'. */
    async addViewer(ws) {
      if (share.oneTime && admitted > 0) return 'link_used';
      if (viewers.size >= share.maxViewers) return 'full';
      admitted += 1;
      viewers.add(ws);
      ws.allowInput = createInputLimiter(now);
      ws.inputChain = Promise.resolve();
      ws.queuedInputs = 0;
      ws.on('close', () => {
        viewers.delete(ws);
        stopIfIdle();
      });
      ws.on('message', (data, isBinary) => handleInput(ws, data, isBinary));
      sendJson(ws, { type: 'hello', title: share.tabTitle, allowControl: share.allowControl, expiresAt: share.expiresAt });
      if (lastFrame) ws.send(lastFrame);
      await ensureStreaming();
      stopIfIdle();
      return 'ok';
    },
    viewerCount: () => viewers.size,
    async close(reason) {
      for (const ws of viewers) {
        sendJson(ws, { type: 'ended', reason });
        ws.close(1000, reason);
      }
      viewers.clear();
      await stopStreaming();
      await session.close();
    },
  });
}
