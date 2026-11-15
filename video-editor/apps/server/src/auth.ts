import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT = randomBytes(16);

/** Hash the configured password once at startup; compare in constant time. */
export class PasswordCheck {
  private readonly expected: Buffer;
  constructor(password: string) {
    this.expected = scryptSync(password, SALT, 32);
  }
  verify(candidate: string): boolean {
    if (typeof candidate !== 'string' || candidate.length > 1024) return false;
    return timingSafeEqual(scryptSync(candidate, SALT, 32), this.expected);
  }
}

export const newSessionToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

/**
 * Simple in-memory login throttling: after `max` failures within `windowMs`
 * a key (IP) is blocked until the window has passed.
 */
export class LoginLimiter {
  private failures = new Map<string, { count: number; first: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  constructor(max = 5, windowMs = 15 * 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }

  blocked(key: string): boolean {
    const f = this.failures.get(key);
    if (!f) return false;
    if (Date.now() - f.first > this.windowMs) {
      this.failures.delete(key);
      return false;
    }
    return f.count >= this.max;
  }

  fail(key: string) {
    const f = this.failures.get(key);
    if (!f || Date.now() - f.first > this.windowMs) this.failures.set(key, { count: 1, first: Date.now() });
    else f.count++;
  }

  succeed(key: string) {
    this.failures.delete(key);
  }
}
