// People and the agent name a request by its number, such as REQ-0042, never by its internal ID.
const referencePattern = /^REQ-(\d{1,9})$/;

export function formatReference(requestNumber: number): string {
  return `REQ-${String(requestNumber).padStart(4, "0")}`;
}

// Returns the request number, or undefined when the text is not a well-formed reference.
export function parseReference(reference: string): number | undefined {
  const match = referencePattern.exec(reference.trim().toUpperCase());
  return match?.[1] === undefined ? undefined : Number(match[1]);
}
