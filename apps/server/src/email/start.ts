import type { IMastraLogger } from "@mastra/core/logger";

import type { ChannelHandler } from "../channel-handler";
import { loadEmailEnv } from "../config";
import { startEmailAdapter } from "./adapter";
import { imapMailbox, smtpSender } from "./connect";

// Connects the agent to its mailbox when one is configured. Returns false otherwise, so the server
// keeps running without email.
export async function startEmailIfConfigured(
  handler: () => ChannelHandler,
  logger: IMastraLogger,
): Promise<boolean> {
  const env = loadEmailEnv();
  if (env === undefined) {
    logger.info("Email is not configured: set EMAIL_IMAP_HOST and the other EMAIL_ variables");
    return false;
  }
  if (env.EMAIL_TRUST_LOCAL_SENDERS) {
    logger.warn("Every email sender is trusted: only for tests with the local mail server");
  }
  const settings = {
    user: env.EMAIL_USER,
    password: env.EMAIL_PASSWORD,
    address: env.EMAIL_ADDRESS,
    imapHost: env.EMAIL_IMAP_HOST,
    imapPort: env.EMAIL_IMAP_PORT,
    smtpHost: env.EMAIL_SMTP_HOST,
    smtpPort: env.EMAIL_SMTP_PORT,
    secure: env.EMAIL_SECURE,
  };
  const errorLogger = {
    error: (message: string, error: unknown) => {
      logger.error(message, { error: error instanceof Error ? error.message : String(error) });
    },
  };
  const { db, handle } = handler();
  await startEmailAdapter({
    mailbox: imapMailbox(settings, errorLogger),
    sender: smtpSender(settings),
    db,
    handle,
    address: env.EMAIL_ADDRESS,
    trust: {
      trustedAuthservId: env.EMAIL_TRUSTED_AUTHSERV_ID,
      trustAllSenders: env.EMAIL_TRUST_LOCAL_SENDERS,
    },
    logger: {
      info: (message) => {
        logger.info(message);
      },
      ...errorLogger,
    },
  });
  return true;
}
