import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";

import type { SlackEventSource, SlackWebApi } from "./adapter";

export interface SlackConnection {
  events: SlackEventSource;
  web: SlackWebApi;
  botUserId: string;
  teamId: string;
  start: () => Promise<void>;
}

// Opens the Socket Mode connection: the server connects to Slack, so no public address is needed.
// Events arrive on a connection authenticated by the app token, so their sender is the Slack user.
export async function connectSlack(tokens: {
  appToken: string;
  botToken: string;
}): Promise<SlackConnection> {
  const client = new WebClient(tokens.botToken);
  const identity = await client.auth.test();
  if (identity.user_id === undefined || identity.team_id === undefined) {
    throw new Error("Slack did not return the identity of the bot");
  }
  const socket = new SocketModeClient({ appToken: tokens.appToken });
  return {
    botUserId: identity.user_id,
    teamId: identity.team_id,
    events: {
      on: (type, listener) => {
        socket.on(type, listener);
      },
    },
    web: {
      postInThread: async ({ channel, threadTs, text }) => {
        // This is the Slack Web API method, not the browser's window.postMessage the rule is about.
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        const posted = await client.chat.postMessage({ channel, thread_ts: threadTs, text });
        if (posted.ts === undefined) {
          throw new Error("Slack did not return the timestamp of the posted message");
        }
        return { ts: posted.ts };
      },
      addReaction: async ({ channel, ts, name }) => {
        await client.reactions.add({ channel, timestamp: ts, name });
      },
    },
    start: async () => {
      await socket.start();
    },
  };
}
