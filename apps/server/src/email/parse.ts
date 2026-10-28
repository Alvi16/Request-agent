import { createHash } from "node:crypto";

import EmailReplyParser from "email-reply-parser";
import PostalMime from "postal-mime";

export interface EmailAttachment {
  filename: string;
  contentType: string;
  sizeBytes: number;
}

export interface ParsedEmail {
  messageId: string;
  inReplyTo: string | null;
  // Message-IDs of the earlier messages of the thread, oldest first.
  references: string[];
  from: string;
  // Every recipient, in To then Cc, lowercased.
  recipients: string[];
  subject: string | null;
  sentAt: Date;
  // The new part of the message, without the quoted history and the signature.
  text: string;
  // The whole text, kept with the original message.
  fullText: string;
  // Header fields in the order of the message: the first ones were added by the last server.
  headers: { key: string; value: string }[];
  attachments: EmailAttachment[];
}

// A plain text version of an HTML-only email, good enough for the classifier to read.
function htmlToText(html: string): string {
  return html
    .replaceAll(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replaceAll(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replaceAll(/<[^>]+>/g, "")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

// Without the earlier messages quoted in a reply, the classifier reads what the sender just wrote.
function newPart(text: string): string {
  const visible = new EmailReplyParser().read(text).getVisibleText().trim();
  return visible === "" ? text.trim() : visible;
}

function messageIds(value: string | undefined): string[] {
  return value?.match(/<[^<>\s]+>/g) ?? [];
}

export async function parseEmail(source: Uint8Array): Promise<ParsedEmail> {
  const email = await PostalMime.parse(source);
  const from = email.from?.address?.toLowerCase();
  if (from === undefined || from === "") {
    throw new Error("The email has no sender address");
  }
  const fullText = email.text ?? (email.html === undefined ? "" : htmlToText(email.html));
  const recipients = [...(email.to ?? []), ...(email.cc ?? [])]
    .map((recipient) => recipient.address?.toLowerCase() ?? "")
    .filter((address) => address !== "");
  return {
    // A message without Message-ID still needs a stable identity, so a repeated delivery is
    // recognized: its content gives one.
    messageId:
      email.messageId ?? `<${createHash("sha256").update(source).digest("hex")}@no-message-id>`,
    inReplyTo: messageIds(email.inReplyTo)[0] ?? null,
    references: messageIds(email.references),
    from,
    recipients,
    subject: email.subject ?? null,
    sentAt: email.date === undefined ? new Date() : new Date(email.date),
    text: newPart(fullText),
    fullText,
    headers: email.headers.map(({ key, value }) => ({ key, value })),
    attachments: email.attachments.map((attachment) => ({
      filename: attachment.filename ?? "unnamed",
      contentType: attachment.mimeType,
      sizeBytes:
        typeof attachment.content === "string"
          ? Buffer.byteLength(attachment.content)
          : attachment.content.byteLength,
    })),
  };
}
