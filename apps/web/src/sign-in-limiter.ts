// Slows down password guessing (OWASP Authentication Cheat Sheet): after a few failures for an
// email, sign-in is refused for a while, whatever the password. Kept in memory: a restart clears
// it, which is acceptable for one server process.
export const maxFailures = 5;
export const lockDurationMs = 15 * 60 * 1000;
// Bounds the memory used when someone tries many invented emails: the oldest entries are dropped.
export const maxTrackedEmails = 10_000;

interface Attempts {
  failures: number;
  lockedUntil: number;
}

const key = (email: string) => email.trim().toLowerCase();

export function createSignInLimiter(now: () => number = Date.now) {
  const attempts = new Map<string, Attempts>();

  return {
    isLocked(email: string): boolean {
      const entry = attempts.get(key(email));
      if (entry === undefined || entry.lockedUntil === 0) {
        return false;
      }
      if (entry.lockedUntil <= now()) {
        attempts.delete(key(email));
        return false;
      }
      return true;
    },
    recordFailure(email: string): void {
      const entry = attempts.get(key(email)) ?? { failures: 0, lockedUntil: 0 };
      entry.failures += 1;
      if (entry.failures >= maxFailures) {
        entry.lockedUntil = now() + lockDurationMs;
      }
      attempts.delete(key(email));
      attempts.set(key(email), entry);
      const oldest = attempts.keys().next();
      if (attempts.size > maxTrackedEmails && oldest.done !== true) {
        attempts.delete(oldest.value);
      }
    },
    recordSuccess(email: string): void {
      attempts.delete(key(email));
    },
  };
}

export type SignInLimiter = ReturnType<typeof createSignInLimiter>;
