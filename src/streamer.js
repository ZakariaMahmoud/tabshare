const SNAPSHOT_INTERVAL_MS = 200; // ~5 fps for high-density snapshots
const SNAPSHOT_RETRY_MS = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FALLBACK_SIZE = Object.freeze({ width: 1280, height: 800 });

/**
 * The page's real viewport in CSS pixels. Playwright's viewportSize() is only its own emulation
 * setting — for a mirrored real tab it reports 1280×800 whatever the window size is.
 */
export async function measureViewport(page) {
  try {
    const size = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
    return size.width > 0 && size.height > 0 ? size : FALLBACK_SIZE;
  } catch {
    return page.viewportSize?.() ?? FALLBACK_SIZE;
  }
}

/** Fast path: Chrome's screencast pushes frames as the page changes, at normal (1×) density. */
async function startScreencast(page, cdp, { jpegQuality, maxWidth, maxHeight, onFrame, log }) {
  let size = await measureViewport(page); // until the first frame reports the exact size
  const onScreencastFrame = ({ data, metadata, sessionId }) => {
    size = { width: metadata.deviceWidth, height: metadata.deviceHeight };
    onFrame(Buffer.from(data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch((err) => log.warn(`[stream] ack failed: ${err.message}`));
  };
  cdp.on('Page.screencastFrame', onScreencastFrame);
  // maxWidth/maxHeight are omitted from the JSON when undefined (full-size frames).
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: jpegQuality, maxWidth, maxHeight, everyNthFrame: 1 });
  return {
    getSize: () => size,
    async stop() {
      cdp.off('Page.screencastFrame', onScreencastFrame);
      await cdp.send('Page.stopScreencast').catch((err) => log.debug?.(`[stream] stop: ${err.message}`));
    },
  };
}

/**
 * Sharp path: the screencast always captures at 1× density, so for high-density pages take
 * full-resolution screenshots in a loop instead, sending a frame only when the picture changed.
 * Lower frame rate, much crisper text.
 */
function startSnapshots(page, cdp, { jpegQuality, deviceScaleFactor, onFrame, log }) {
  let stopped = false;
  let last = '';
  const loop = async () => {
    while (!stopped) {
      const started = Date.now();
      try {
        const { width, height } = page.viewportSize() ?? FALLBACK_SIZE;
        // Without an explicit clip scale Chrome returns 1× pixels even for a 2× page.
        const { data } = await cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: jpegQuality,
          optimizeForSpeed: true,
          clip: { x: 0, y: 0, width, height, scale: deviceScaleFactor },
        });
        if (!stopped && data !== last) {
          last = data;
          onFrame(Buffer.from(data, 'base64'));
        }
      } catch (err) {
        if (stopped) return;
        log.warn(`[stream] snapshot failed: ${err.message}`);
        await sleep(SNAPSHOT_RETRY_MS);
      }
      await sleep(Math.max(0, SNAPSHOT_INTERVAL_MS - (Date.now() - started)));
    }
  };
  const running = loop();
  return {
    // Input coordinates are in CSS pixels, i.e. the viewport — not the 2× frame size.
    // (Snapshots are only used for isolated pages, whose viewport Playwright sets exactly.)
    getSize: () => page.viewportSize() ?? FALLBACK_SIZE,
    async stop() {
      stopped = true;
      await running;
    },
  };
}

/**
 * Streams a page as JPEG frames. Uses the screencast at normal density and full-resolution
 * snapshots when the page renders at more than 1× (the "high" quality preset).
 */
export async function startStreamer(page, { jpegQuality, maxWidth, maxHeight, deviceScaleFactor = 1, onFrame, log }) {
  const cdp = await page.context().newCDPSession(page);
  const capture =
    deviceScaleFactor > 1
      ? startSnapshots(page, cdp, { jpegQuality, deviceScaleFactor, onFrame, log })
      : await startScreencast(page, cdp, { jpegQuality, maxWidth, maxHeight, onFrame, log });
  return Object.freeze({
    getSize: capture.getSize,
    async stop() {
      await capture.stop();
      await cdp.detach().catch((err) => log.debug?.(`[stream] detach: ${err.message}`));
    },
  });
}

/** Replays a validated input command (see input.js) onto the page. */
export async function applyInput(page, knownSize, input) {
  const size = knownSize ?? (await measureViewport(page));
  const x = Math.round((input.x ?? 0) * size.width);
  const y = Math.round((input.y ?? 0) * size.height);
  switch (input.type) {
    case 'mouse':
      await page.mouse.move(x, y);
      if (input.action === 'down') await page.mouse.down({ button: input.button });
      if (input.action === 'up') await page.mouse.up({ button: input.button });
      return;
    case 'wheel':
      await page.mouse.move(x, y);
      await page.mouse.wheel(input.dx, input.dy);
      return;
    case 'key':
      await page.keyboard.press(input.key === 'Space' ? ' ' : input.key);
      return;
    case 'text':
      await page.keyboard.insertText(input.text);
      return;
    default:
      throw new Error(`unknown input type: ${input.type}`);
  }
}
