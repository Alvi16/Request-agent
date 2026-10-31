import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  conversationOrigin,
  type Database,
  listUnhandledMessages,
  readConversation,
  storeInboundMessage,
  storeOutboundMessage,
  type TurnInput,
} from "@request-agent/core";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { z } from "zod";

import type { HandledMessage } from "../mastra/agents/handle-message";
import { statusLabels } from "../mastra/agents/reply";
import { createSerialQueue, defaultRetryDelaysMs, handleReliably } from "../reliable-handling";
import { type AcceptedFile, acceptFiles, maxFileBytes, maxFiles } from "./files";
import { verifyIdentity } from "./identity";
import { widgetScript } from "./script";

export interface WidgetLogger {
  info(message: string): void;
  error(message: string, error: unknown): void;
}

export interface WidgetOptions {
  db: Database;
  // Runs the agent on a stored message: handleMessage, bound to the agent and the classifier.
  handle: (input: TurnInput) => Promise<HandledMessage>;
  // Origins of the applications allowed to embed the widget, such as https://portal.example.com.
  allowedOrigins: string[];
  // Shared with the applications to sign the identity of the person signed in. Without it, every
  // person is unverified.
  identitySecret: string | undefined;
  // Folder where the attached files are written, under random names.
  attachmentsDir: string;
  logger: WidgetLogger;
  // Waits before handling a failed message again, after the first and second failures.
  retryDelaysMs?: number[];
  now?: () => Date;
}

// Messages waiting for the agent beyond which the widget asks people to come back later: the
// model handles one message at a time, in minutes on a CPU.
export const maxWaitingMessages = 20;

// The files, and the fields of a form, fit in this size.
const maxBodyBytes = maxFiles * maxFileBytes + 64 * 1024;

// Sent as the subject of the message, which the classifier reads with the text.
const subjects = {
  QUESTION: "Question",
  BUG: "Signalement d'un bug",
  EVOLUTION: "Demande d'évolution",
} as const;

const text = z.string().trim().min(1).max(5000);
const newMessageForm = z.object({
  kind: z.enum(["QUESTION", "BUG", "EVOLUTION"]),
  text,
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  expires: z.coerce.number().int().optional(),
  signature: z.string().optional(),
  // Set by the application that embeds the widget: a project with a widget channel.
  project: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/)
    .optional(),
});
const replyForm = z.object({ text });

// A conversation is reached only with its token, which only the browser that opened it holds.
const conversationToken = z.string().regex(/^[\w-]{43}$/);

// Kept with each message, so a reply and a message handled again after a restart keep the trust
// and the project of the conversation.
const rawSchema = z.object({ verified: z.boolean(), project: z.string().nullable() });
type WidgetRaw = z.infer<typeof rawSchema>;

// Only a hash of the token is stored, so a copy of the database does not open the conversations.
const externalIdOf = (token: string) => createHash("sha256").update(token).digest("hex");

const invalidMessage = "Le message est incomplet, ou un fichier n'est pas accepté.";

function fail(c: Context, status: 400 | 404 | 413 | 503, error: string) {
  return c.json({ error }, status);
}

// The values of a form field that may be repeated, such as files.
function all(value: unknown): unknown[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

// The widget channel: an HTTP API for the script embedded in the applications. A message is stored,
// then handled by the agent one at a time, and the answer is read with the conversation.
export async function createWidgetApp(options: WidgetOptions) {
  const { db, logger } = options;
  const now = options.now ?? (() => new Date());
  const queue = createSerialQueue();

  async function reply(conversation: string, messageId: string, answer: string): Promise<void> {
    await storeOutboundMessage(db, {
      channel: "WIDGET",
      conversationExternalId: conversation,
      externalId: randomUUID(),
      sender: "agent",
      bodyText: answer,
      raw: {},
      sentAt: now(),
      inReplyTo: messageId,
    });
  }

  async function process(input: TurnInput, conversation: string, externalId: string) {
    try {
      const outcome = await handleReliably(
        db,
        options.handle,
        input,
        options.retryDelaysMs ?? defaultRetryDelaysMs,
      );
      if (outcome.kind === "retry") {
        logger.error(`Widget message ${externalId} will be handled again`, outcome.error);
        queue.later(outcome.delayMs, () => process(input, conversation, externalId));
        return;
      }
      if (outcome.reply !== null) {
        await reply(conversation, externalId, outcome.reply);
      }
    } catch (error) {
      // The message stays unhandled and is handled again when the server restarts.
      logger.error(`Widget message ${externalId} could not be handled`, error);
    }
  }

  async function saveFiles(files: AcceptedFile[]) {
    if (files.length > 0) {
      await mkdir(options.attachmentsDir, { recursive: true });
    }
    return Promise.all(
      files.map(async (file) => {
        const storageRef = randomUUID();
        await writeFile(join(options.attachmentsDir, storageRef), file.bytes, { flag: "wx" });
        return {
          filename: file.filename,
          contentType: file.contentType,
          sizeBytes: file.bytes.length,
          storageRef,
        };
      }),
    );
  }

  // Stores a message of the person and queues it for the agent, which takes minutes on a CPU.
  async function receive(
    c: Context,
    token: string,
    message: { text: string; subject: string | null; sender: string; raw: WidgetRaw },
    files: AcceptedFile[],
  ) {
    if ((await listUnhandledMessages(db, "WIDGET")).length >= maxWaitingMessages) {
      return fail(c, 503, "Le service reçoit beaucoup de demandes. Merci de réessayer plus tard.");
    }
    const conversation = externalIdOf(token);
    const externalId = randomUUID();
    const stored = await storeInboundMessage(db, {
      channel: "WIDGET",
      conversationExternalId: conversation,
      externalId,
      sender: message.sender,
      subject: message.subject,
      bodyText: message.text,
      raw: message.raw,
      sentAt: now(),
      attachments: await saveFiles(files),
    });
    const input: TurnInput = {
      messageId: stored.messageId,
      trust: message.raw.verified ? "VERIFIED" : "UNVERIFIED",
      channelAddress: message.raw.project,
    };
    queue.push(() => process(input, conversation, externalId));
    return c.json({ conversation: token }, 202);
  }

  const app = new Hono();
  app.use(
    "/widget/*",
    cors({ origin: options.allowedOrigins, allowMethods: ["GET", "POST"], maxAge: 600 }),
  );
  app.use(
    "/widget/*",
    bodyLimit({
      maxSize: maxBodyBytes,
      onError: (c) => fail(c, 413, "Les fichiers sont trop volumineux."),
    }),
  );

  app.get("/widget/widget.js", (c) =>
    c.body(widgetScript, 200, { "Content-Type": "text/javascript; charset=utf-8" }),
  );

  app.post("/widget/messages", async (c) => {
    const body = await c.req.parseBody({ all: true });
    const form = newMessageForm.safeParse(body);
    const files = await acceptFiles(all(body.files));
    if (!form.success || files === undefined) {
      return fail(c, 400, invalidMessage);
    }
    const { email, expires, signature } = form.data;
    // A person is verified only by a signature of the application: an email typed in the widget
    // proves nothing.
    const verified =
      options.identitySecret !== undefined &&
      expires !== undefined &&
      signature !== undefined &&
      verifyIdentity(options.identitySecret, { email, expires, signature }, now());
    return receive(
      c,
      randomBytes(32).toString("base64url"),
      {
        text: form.data.text,
        subject: subjects[form.data.kind],
        sender: email,
        raw: { verified, project: form.data.project ?? null },
      },
      files,
    );
  });

  app.post("/widget/conversations/:token/messages", async (c) => {
    const token = conversationToken.safeParse(c.req.param("token"));
    const origin = token.success
      ? await conversationOrigin(db, "WIDGET", externalIdOf(token.data))
      : undefined;
    const raw = rawSchema.safeParse(origin?.raw);
    if (!token.success || origin === undefined || !raw.success) {
      return fail(c, 404, "Cette conversation est introuvable.");
    }
    const body = await c.req.parseBody({ all: true });
    const form = replyForm.safeParse(body);
    const files = await acceptFiles(all(body.files));
    if (!form.success || files === undefined) {
      return fail(c, 400, invalidMessage);
    }
    // A reply keeps the person and the trust of the first message of the conversation.
    return receive(
      c,
      token.data,
      { text: form.data.text, subject: null, sender: origin.sender, raw: raw.data },
      files,
    );
  });

  app.get("/widget/conversations/:token", async (c) => {
    const token = conversationToken.safeParse(c.req.param("token"));
    const thread = token.success
      ? await readConversation(db, "WIDGET", externalIdOf(token.data))
      : undefined;
    if (thread === undefined) {
      return fail(c, 404, "Cette conversation est introuvable.");
    }
    return c.json({
      ...thread,
      requests: thread.requests.map((request) => ({
        reference: request.reference,
        title: request.title,
        status: statusLabels[request.status],
      })),
    });
  });

  // Messages stored before a restart but never handled are handled now, in their order.
  async function recoverUnhandled(): Promise<void> {
    const unhandled = await listUnhandledMessages(db, "WIDGET");
    for (const stored of unhandled) {
      const raw = rawSchema.safeParse(stored.raw);
      const input: TurnInput = {
        messageId: stored.messageId,
        trust: raw.success && raw.data.verified ? "VERIFIED" : "UNVERIFIED",
        channelAddress: raw.success ? raw.data.project : null,
      };
      queue.push(() => process(input, stored.conversationExternalId, stored.externalId));
    }
  }
  await recoverUnhandled().catch((error: unknown) => {
    logger.error("Unhandled widget messages could not be resumed", error);
  });

  logger.info("Widget listening");
  return { app, idle: queue.idle };
}
