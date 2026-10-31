import { createHmac, timingSafeEqual } from "node:crypto";

// Longest validity of a signed identity, so a copied one soon stops working.
export const maxIdentityLifetimeSeconds = 24 * 60 * 60;

export interface SignedIdentity {
  email: string;
  // Unix time, in seconds, after which the signature is refused.
  expires: number;
  signature: string;
}

function sign(secret: string, email: string, expires: number): string {
  return createHmac("sha256", secret).update(`${email}\n${expires}`).digest("hex");
}

// Computed by the server of the application that embeds the widget, for the person signed in:
// the widget then tells the agent who writes, and the person cannot change it.
export function signIdentity(secret: string, email: string, now: Date): SignedIdentity {
  const normalized = email.trim().toLowerCase();
  const expires = Math.floor(now.getTime() / 1000) + maxIdentityLifetimeSeconds;
  return { email: normalized, expires, signature: sign(secret, normalized, expires) };
}

// True for a signature of this email, made with the secret, and still valid.
export function verifyIdentity(secret: string, identity: SignedIdentity, now: Date): boolean {
  const seconds = Math.floor(now.getTime() / 1000);
  if (identity.expires <= seconds || identity.expires > seconds + maxIdentityLifetimeSeconds) {
    return false;
  }
  const expected = Buffer.from(sign(secret, identity.email, identity.expires), "hex");
  const given = Buffer.from(identity.signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
