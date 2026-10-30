import type { IMastraLogger } from "@mastra/core/logger";
import { type ApiRoute, registerApiRoute } from "@mastra/core/server";

import type { ChannelHandler } from "../channel-handler";
import { loadWidgetEnv } from "../config";
import { createWidgetApp } from "./adapter";

// The widget app once started. Requests that arrive before, or without a widget, are not found.
let widget: { fetch: (request: Request) => Response | Promise<Response> } | undefined;

// Origins the applications embedding the widget run on. A wrong configuration allows none here,
// and is reported when the widget starts, without stopping the rest of the server.
function allowedOrigins(): string[] {
  try {
    return loadWidgetEnv()?.WIDGET_ALLOWED_ORIGINS ?? [];
  } catch {
    return [];
  }
}

// The routes of the widget on the Mastra server, under /widget. They need no Mastra session: the
// widget is used by people of other applications, and checks who they are itself. Their CORS rule
// replaces the default rule of the server, which allows every site.
export function widgetRoutes(): ApiRoute[] {
  return [
    registerApiRoute("/widget/*", {
      method: "ALL",
      requiresAuth: false,
      cors: { origin: allowedOrigins(), allowMethods: ["GET", "POST"] },
      handler: (c) =>
        widget === undefined ? c.json({ error: "Not found" }, 404) : widget.fetch(c.req.raw),
    }),
  ];
}

// Starts the widget when the origins of the applications that embed it are configured. Returns
// false otherwise, so the server keeps running without it.
export async function startWidgetIfConfigured(
  handler: () => ChannelHandler,
  logger: IMastraLogger,
): Promise<boolean> {
  const env = loadWidgetEnv();
  if (env === undefined) {
    logger.info("The widget is not configured: set WIDGET_ALLOWED_ORIGINS and ATTACHMENTS_DIR");
    return false;
  }
  if (env.WIDGET_IDENTITY_SECRET === undefined) {
    logger.warn("WIDGET_IDENTITY_SECRET is not set: every person of the widget is unverified");
  }
  const { db, handle } = handler();
  const started = await createWidgetApp({
    db,
    handle,
    allowedOrigins: env.WIDGET_ALLOWED_ORIGINS,
    identitySecret: env.WIDGET_IDENTITY_SECRET,
    attachmentsDir: env.ATTACHMENTS_DIR,
    logger: {
      info: (message) => {
        logger.info(message);
      },
      error: (message, error) => {
        logger.error(message, { error: error instanceof Error ? error.message : String(error) });
      },
    },
  });
  widget = started.app;
  return true;
}
