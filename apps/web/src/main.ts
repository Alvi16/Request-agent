import { connectDatabase } from "@request-agent/core";

import { createWebApp } from "./app.ts";
import { loadWebEnv } from "./config.ts";
import { listen } from "./listen.ts";

const env = loadWebEnv();
const { db, close } = connectDatabase(env.APP_DATABASE_URL);
const app = createWebApp({
  db,
  timeZone: env.WEB_TIME_ZONE,
  attachmentsDir: env.ATTACHMENTS_DIR,
  onError: (error) => {
    console.error("Request failed:", error.message);
  },
});

const server = await listen(app.fetch, env.WEB_HOST, env.WEB_PORT).catch(async (error: Error) => {
  console.error(error.message);
  await close();
  process.exit(1);
});
console.info(`Web interface listening on http://${env.WEB_HOST}:${env.WEB_PORT}`);

// Stops accepting requests, then closes the database pool.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(() => {
      void close().then(() => process.exit(0));
    });
  });
}
