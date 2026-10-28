import {
  type Database,
  isKnownConversation,
  storeInboundMessage,
  storeOutboundMessage,
  type TurnInput,
} from "@request-agent/core";

import type { HandledMessage } from "../mastra/agents/handle-message";
import { parseSlackEvent, type SlackMessage } from "./events";

// The parts of the Slack clients the adapter uses, so tests can replace them.
export interface SlackEventSource {
  on(
    type: "app_mention" | "message",
    listener: (args: { event: unknown; ack: () => Promise<void> }) => Promise<void>,
  ): void;
}

export interface SlackWebApi {
  postInThread(message: {
    channel: string;
    threadTs: string;
    text: string;
  }): Promise<{ ts: string }>;
  addReaction(reaction: { channel: string; ts: string; name: string }): Promise<void>;
}

export interface SlackAdapterLogger {
  info(message: string): void;
  error(message: string, error: unknown): void;
}

export interface SlackAdapterOptions {
  events: SlackEventSource;
  web: SlackWebApi;
  db: Database;
  // Runs the agent on a stored message: handleMessage, bound to the agent and the classifier.
  handle: (input: TurnInput) => Promise<HandledMessage>;
  botUserId: string;
  teamId: string;
  logger: SlackAdapterLogger;
}

// Sent when the agent could not handle a message, for example when the model is unavailable.
// Nothing retries the message yet, so the sender is asked to send it again.
export const unavailableReply =
  "Le service est momentanément indisponible et votre message n'a pas pu être traité. Merci de le renvoyer un peu plus tard.";

// The reaction that tells the sender the message was received and is being handled.
const receivedReaction = "eyes";

const conversationId = (message: SlackMessage) => `${message.channel}:${message.threadTs}`;
const messageId = (channel: string, ts: string) => `${channel}:${ts}`;

// Slack timestamps are seconds since the epoch, with microseconds after the dot.
const sentAt = (ts: string) => new Date(Number(ts) * 1000);

// Connects Slack to the agent. Each message is stored before Slack is acknowledged, so a message
// Slack considers delivered is stored, then handled one at a time, since the model runs on a CPU.
export function startSlackAdapter(options: SlackAdapterOptions): { idle: () => Promise<void> } {
  const { db, web, logger } = options;
  let queue = Promise.resolve();

  async function reply(message: SlackMessage, text: string): Promise<void> {
    const posted = await web.postInThread({
      channel: message.channel,
      threadTs: message.threadTs,
      text,
    });
    await storeOutboundMessage(db, {
      channel: "SLACK",
      conversationExternalId: conversationId(message),
      externalId: messageId(message.channel, posted.ts),
      sender: options.botUserId,
      bodyText: text,
      raw: { ts: posted.ts },
      sentAt: sentAt(posted.ts),
    });
  }

  async function process(message: SlackMessage, storedMessageId: string): Promise<void> {
    try {
      const handled = await options.handle({
        messageId: storedMessageId,
        trust: message.sameTeam ? "VERIFIED" : "UNVERIFIED",
        channelAddress: message.channel,
      });
      if (handled.reply !== null) {
        await reply(message, handled.reply);
      }
    } catch (error) {
      logger.error(`Slack message ${message.channel}:${message.ts} could not be handled`, error);
      await reply(message, unavailableReply).catch((replyError: unknown) => {
        logger.error("The unavailability reply could not be sent", replyError);
      });
    }
  }

  async function receive(event: unknown, ack: () => Promise<void>): Promise<void> {
    const message = parseSlackEvent(event, {
      botUserId: options.botUserId,
      teamId: options.teamId,
    });
    // A plain channel message is only kept when it continues a thread the agent follows: the
    // other messages of the channel are not stored.
    const relevant =
      message !== undefined &&
      (message.addressedToAgent ||
        (await isKnownConversation(db, "SLACK", conversationId(message))));
    if (!relevant) {
      await ack();
      return;
    }
    const stored = await storeInboundMessage(db, {
      channel: "SLACK",
      conversationExternalId: conversationId(message),
      externalId: messageId(message.channel, message.ts),
      sender: message.user,
      bodyText: message.text,
      raw: event,
      sentAt: sentAt(message.ts),
    });
    // A mention arrives both as a mention and as a channel message: only the first is handled. It
    // is queued before Slack is acknowledged, so a failed acknowledgement cannot leave it unhandled.
    if (stored.isNew) {
      queue = queue.then(() => process(message, stored.messageId));
    }
    await ack();
    if (stored.isNew) {
      await web
        .addReaction({ channel: message.channel, ts: message.ts, name: receivedReaction })
        .catch((error: unknown) => {
          logger.error("The reception reaction could not be added", error);
        });
    }
  }

  for (const type of ["app_mention", "message"] as const) {
    options.events.on(type, async ({ event, ack }) => {
      try {
        await receive(event, ack);
      } catch (error) {
        // Not acknowledged: Slack delivers the event again, and the stored message is not lost.
        logger.error(`Slack ${type} event could not be stored`, error);
      }
    });
  }
  logger.info("Slack adapter listening");
  return { idle: () => queue };
}
