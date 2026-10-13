export const QUALITY_NAMES = Object.freeze(['low', 'standard', 'high']);

/**
 * Streaming settings for a share's chosen quality.
 *  - low:      smaller frames for slow connections
 *  - standard: full-size frames at the configured JPEG quality
 *  - high:     near-lossless JPEG; isolated shares also render at 2× density for crisp text
 * deviceScaleFactor only applies to isolated shares: a mirrored tab keeps the sharer's screen density.
 */
export function streamSettings(quality, mode, standardJpegQuality) {
  const presets = {
    low: { jpegQuality: 50, maxWidth: 1280, maxHeight: 800, deviceScaleFactor: 1 },
    standard: { jpegQuality: standardJpegQuality, deviceScaleFactor: 1 },
    high: { jpegQuality: 92, deviceScaleFactor: 2 },
  };
  const preset = presets[quality] ?? presets.standard;
  return Object.freeze({ ...preset, deviceScaleFactor: mode === 'isolated' ? preset.deviceScaleFactor : 1 });
}
