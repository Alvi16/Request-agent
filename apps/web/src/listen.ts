import { type ServerType, serve } from "@hono/node-server";

type Fetch = Parameters<typeof serve>[0]["fetch"];

// Starts the server once it listens. A busy port is told in plain words: it is usually another web
// interface still running, often in a forgotten terminal.
export function listen(fetch: Fetch, hostname: string, port: number): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch, hostname, port }, () => {
      server.off("error", onError);
      resolve(server);
    });
    function onError(error: NodeJS.ErrnoException) {
      reject(
        error.code === "EADDRINUSE"
          ? new Error(
              `Port ${port} of ${hostname} is already in use, often by another web interface still running. Stop it, or choose another port with WEB_PORT in .env.`,
              { cause: error },
            )
          : error,
      );
    }
    server.once("error", onError);
  });
}
