import { serve } from "@hono/node-server";
import { connectDatabase } from "@request-agent/core";

import { createWebApp } from "./app.ts";
import { loadWebEnv } from "./config.ts";

const env = loadWebEnv();
const { db, close } = connectDatabase(env.APP_DATABASE_URL);
const app = createWebApp({
  db,
  timeZone: env.WEB_TIME_ZONE,
  onError: (error) => {
    console.error("Request failed:", error.message);
  },
});

const server = serve({ fetch: app.fetch, hostname: env.WEB_HOST, port: env.WEB_PORT }, (info) => {
  console.info(`Web interface listening on http://${info.address}:${info.port}`);
});

// Stops accepting requests, then closes the database pool.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void close().then(() => process.exit(0));
    });
  });
}
