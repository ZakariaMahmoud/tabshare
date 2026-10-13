/**
 * Streams a page as JPEG frames using the DevTools screencast API and replays viewer input.
 */
export async function startStreamer(page, { quality, onFrame, log }) {
  const cdp = await page.context().newCDPSession(page);
  let size = page.viewportSize() ?? { width: 1280, height: 800 };

  const onScreencastFrame = ({ data, metadata, sessionId }) => {
    size = { width: metadata.deviceWidth, height: metadata.deviceHeight };
    onFrame(Buffer.from(data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId }).catch((err) => log.warn(`[stream] ack failed: ${err.message}`));
  };

  cdp.on('Page.screencastFrame', onScreencastFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, everyNthFrame: 1 });

  return Object.freeze({
    getSize: () => size,
    async stop() {
      cdp.off('Page.screencastFrame', onScreencastFrame);
      await cdp.send('Page.stopScreencast').catch((err) => log.debug?.(`[stream] stop: ${err.message}`));
      await cdp.detach().catch((err) => log.debug?.(`[stream] detach: ${err.message}`));
    },
  });
}

/** Replays a validated input command (see input.js) onto the page. */
export async function applyInput(page, size, input) {
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
