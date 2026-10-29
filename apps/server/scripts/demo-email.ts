// Demonstration of the Email → Agent → Request scenario on the local mail server: sends a
// fictitious email to the agent, then waits for its answer and prints it. The agent server must be
// running (pnpm dev). Only allowed with a mail server on this machine, so it never sends a real
// email.
// Usage: pnpm demo:email [--from bruno.leroy@globex.example] [--subject "..."] [--text "..."]
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { ImapFlow } from "imapflow";
import { createTransport } from "nodemailer";
import PostalMime from "postal-mime";

import { loadEmailEnv } from "../src/config.ts";

const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);
// The agent answers in 2 to 4 minutes on a CPU: the classification, the duplicate check, the agent.
const answerTimeoutMs = 10 * 60 * 1000;
const pollDelayMs = 5000;

const { values } = parseArgs({
  options: {
    from: { type: "string", default: "bruno.leroy@globex.example" },
    subject: { type: "string", default: "Export des rapports" },
    text: {
      type: "string",
      default:
        "Bonjour, l'export PDF des rapports mensuels du portail génère un fichier vide depuis hier.",
    },
  },
});

const loaded = loadEmailEnv();
if (loaded === undefined) {
  throw new Error("The agent's mailbox is not configured: set the EMAIL_* variables of .env");
}
const env = loaded;
if (!localHosts.has(env.EMAIL_SMTP_HOST) || !localHosts.has(env.EMAIL_IMAP_HOST)) {
  throw new Error("The demonstration only sends emails through a mail server on this machine");
}

const transport = createTransport({
  host: env.EMAIL_SMTP_HOST,
  port: env.EMAIL_SMTP_PORT,
  secure: false,
});
const sent = await transport.sendMail({
  from: values.from,
  to: env.EMAIL_ADDRESS,
  subject: values.subject,
  text: values.text,
});
console.info(`Sent ${sent.messageId} from ${values.from} to ${env.EMAIL_ADDRESS}.`);
console.info("Waiting for the answer of the agent, usually 2 to 4 minutes on a CPU...");

interface Answer {
  subject: string;
  text: string;
}

// The local mail server creates the mailbox of a sender when it receives their first email, whose
// login and password are the address. Until the agent answers, signing in can fail: each check
// signs in again.
async function findAnswer(): Promise<Answer | undefined> {
  const mailbox = new ImapFlow({
    host: env.EMAIL_IMAP_HOST,
    port: env.EMAIL_IMAP_PORT,
    secure: false,
    auth: { user: values.from, pass: values.from },
    logger: false,
  });
  await mailbox.connect();
  try {
    await mailbox.mailboxOpen("INBOX");
    const uids = await mailbox.search({ header: { "in-reply-to": sent.messageId } }, { uid: true });
    const [uid] = Array.isArray(uids) ? uids : [];
    if (uid === undefined) {
      return undefined;
    }
    const message = await mailbox.fetchOne(String(uid), { source: true }, { uid: true });
    if (message === false || message.source === undefined) {
      return undefined;
    }
    const email = await PostalMime.parse(message.source);
    return { subject: email.subject ?? "", text: email.text?.trim() ?? "" };
  } finally {
    await mailbox.logout();
  }
}

const deadline = Date.now() + answerTimeoutMs;
let answer: Answer | undefined;
let lastError: unknown;
while (answer === undefined && Date.now() < deadline) {
  // One check at a time, spaced out, while the agent works.
  // oxlint-disable-next-line no-await-in-loop
  await sleep(pollDelayMs);
  try {
    // oxlint-disable-next-line no-await-in-loop
    answer = await findAnswer();
  } catch (error) {
    lastError = error;
  }
}
if (answer === undefined) {
  const reason = lastError instanceof Error ? ` Last mailbox error: ${lastError.message}.` : "";
  console.error(`No answer after 10 minutes. Check that pnpm dev and Ollama are running.${reason}`);
  process.exitCode = 1;
} else {
  console.info(`Answer received.\nSubject: ${answer.subject}\n${answer.text}`);
}
