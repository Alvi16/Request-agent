import type { Trust } from "@request-agent/core";

import type { ParsedEmail } from "./parse";

export interface TrustSettings {
  // authserv-id of the receiving mail server, such as mx.google.com, or undefined when none is
  // trusted.
  trustedAuthservId: string | undefined;
  // Local tests only: every sender counts as verified.
  trustAllSenders: boolean;
}

const header = (email: ParsedEmail, key: string) =>
  email.headers.find((field) => field.key.toLowerCase() === key)?.value;

const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

// Reads "authserv-id; method=result property=value; …" (RFC 8601), without comments.
function parseAuthenticationResults(value: string) {
  const [first = "", ...methods] = value
    .replaceAll(/\([^)]*\)/g, " ")
    .replaceAll(/\s+/g, " ")
    .split(";")
    .map((part) => part.trim());
  const authservId = first.split(" ")[0]?.toLowerCase() ?? "";
  const dmarc = methods.find((method) => method.toLowerCase().startsWith("dmarc="));
  const result = dmarc?.split(" ")[0]?.slice("dmarc=".length).toLowerCase();
  const headerFrom = dmarc?.match(/header\.from=([^\s;]+)/i)?.[1]?.toLowerCase();
  return { authservId, result, headerFrom };
}

// A sender is verified only by the Authentication-Results header that the receiving server added,
// which is the first one of the message: anyone can write such headers in the email they send.
// DMARC must pass for the domain of the From address.
export function senderTrust(email: ParsedEmail, settings: TrustSettings): Trust {
  if (settings.trustAllSenders) {
    return "VERIFIED";
  }
  const added = header(email, "authentication-results");
  if (settings.trustedAuthservId === undefined || added === undefined) {
    return "UNVERIFIED";
  }
  const results = parseAuthenticationResults(added);
  const fromOurServer = results.authservId === settings.trustedAuthservId.toLowerCase();
  const aligned = results.headerFrom === domainOf(email.from);
  return fromOurServer && results.result === "pass" && aligned ? "VERIFIED" : "UNVERIFIED";
}

// Robot addresses. The "no reply" ones are also recognized with a prefix, such as
// billing-noreply@example.com, which many services use.
const automaticSenders =
  /^((mailer-daemon|postmaster|bounces?)|([^@]*[._-])?(no-?reply|do-?not-?reply))(\+[^@]*)?@/i;

// Whether the email was sent by a program: an automatic reply, a mailing list or a bounce. The
// agent neither handles nor answers it, which also prevents loops of automatic replies (RFC 3834).
export function isAutomatic(email: ParsedEmail, ownAddress: string): boolean {
  const autoSubmitted = header(email, "auto-submitted")?.trim().toLowerCase();
  const precedence = header(email, "precedence")?.trim().toLowerCase();
  const fromList = email.headers.some((field) => field.key.toLowerCase().startsWith("list-"));
  return (
    (autoSubmitted !== undefined && autoSubmitted !== "no") ||
    precedence === "bulk" ||
    precedence === "junk" ||
    precedence === "list" ||
    fromList ||
    header(email, "return-path")?.trim() === "<>" ||
    automaticSenders.test(email.from) ||
    email.from === ownAddress.toLowerCase()
  );
}
