import { z } from "zod";

// The fields the adapter reads from a Slack event. Others are kept in the raw payload only.
const slackEventSchema = z.object({
  type: z.string(),
  subtype: z.string().optional(),
  bot_id: z.string().optional(),
  user: z.string().optional(),
  user_team: z.string().optional(),
  text: z.string().optional(),
  ts: z.string(),
  thread_ts: z.string().optional(),
  channel: z.string(),
  channel_type: z.string().optional(),
});

export interface SlackMessage {
  channel: string;
  ts: string;
  // The thread the message belongs to: its parent, or the message itself when it starts one.
  threadTs: string;
  user: string;
  text: string;
  // A mention or a direct message is addressed to the agent. Any other message is only handled
  // when it continues a thread the agent already follows.
  addressedToAgent: boolean;
  // False for a sender of another organization, such as in a Slack Connect channel.
  sameTeam: boolean;
}

// Removes the mention of the agent, so the classifier reads the request, not the bot name.
function withoutMention(text: string, botUserId: string): string {
  return text.replaceAll(`<@${botUserId}>`, "").trim();
}

// Reads a Slack event into a message for the agent, or undefined when the agent must ignore it:
// messages from bots including the agent itself, edits, deletions and other system messages.
export function parseSlackEvent(
  payload: unknown,
  context: { botUserId: string; teamId: string },
): SlackMessage | undefined {
  const parsed = slackEventSchema.safeParse(payload);
  if (!parsed.success) {
    return undefined;
  }
  const event = parsed.data;
  const isMessage = event.type === "message" || event.type === "app_mention";
  if (!isMessage || event.subtype !== undefined || event.bot_id !== undefined) {
    return undefined;
  }
  if (event.user === undefined || event.user === context.botUserId) {
    return undefined;
  }
  const text = withoutMention(event.text ?? "", context.botUserId);
  if (text === "") {
    return undefined;
  }
  return {
    channel: event.channel,
    ts: event.ts,
    threadTs: event.thread_ts ?? event.ts,
    user: event.user,
    text,
    addressedToAgent: event.type === "app_mention" || event.channel_type === "im",
    sameTeam: event.user_team === undefined || event.user_team === context.teamId,
  };
}
