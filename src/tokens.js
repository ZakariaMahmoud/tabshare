import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** 192-bit URL-safe secret used in share links. */
export const newToken = () => randomBytes(24).toString('base64url');

/** Short opaque id (12 hex chars) for tabs and shares. */
export const newId = () => randomBytes(6).toString('hex');

const digest = (value) => createHash('sha256').update(value).digest();

/** Constant-time comparison that is safe for inputs of different lengths. */
export function tokensEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  return timingSafeEqual(digest(a), digest(b));
}
