import { describe, expect, it } from "vitest";

import {
  createSignInLimiter,
  lockDurationMs,
  maxFailures,
  maxTrackedEmails,
} from "./sign-in-limiter.ts";

function limiterAt(start: number) {
  let time = start;
  const limiter = createSignInLimiter(() => time);
  return { limiter, advance: (ms: number) => (time += ms) };
}

describe("createSignInLimiter", () => {
  it("locks an email after the maximum number of failures, whatever its case", () => {
    const { limiter } = limiterAt(0);

    for (let failure = 1; failure < maxFailures; failure += 1) {
      limiter.recordFailure("dana@team.example");
    }
    expect(limiter.isLocked("dana@team.example")).toBe(false);

    limiter.recordFailure(" Dana@Team.example ");

    expect(limiter.isLocked("dana@team.example")).toBe(true);
    expect(limiter.isLocked("other@team.example")).toBe(false);
  });

  it("unlocks after the lock duration", () => {
    const { limiter, advance } = limiterAt(0);
    for (let failure = 0; failure < maxFailures; failure += 1) {
      limiter.recordFailure("dana@team.example");
    }

    advance(lockDurationMs - 1);
    expect(limiter.isLocked("dana@team.example")).toBe(true);
    advance(1);
    expect(limiter.isLocked("dana@team.example")).toBe(false);
  });

  it("forgets the failures after a successful sign-in", () => {
    const { limiter } = limiterAt(0);
    for (let failure = 1; failure < maxFailures; failure += 1) {
      limiter.recordFailure("dana@team.example");
    }

    limiter.recordSuccess("dana@team.example");
    limiter.recordFailure("dana@team.example");

    expect(limiter.isLocked("dana@team.example")).toBe(false);
  });

  it("keeps a bounded number of emails, dropping the oldest", () => {
    const { limiter } = limiterAt(0);
    for (let failure = 0; failure < maxFailures; failure += 1) {
      limiter.recordFailure("dana@team.example");
    }

    for (let index = 0; index < maxTrackedEmails; index += 1) {
      limiter.recordFailure(`invented-${index}@team.example`);
    }

    expect(limiter.isLocked("dana@team.example")).toBe(false);
  });
});
