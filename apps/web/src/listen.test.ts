import type { ServerType } from "@hono/node-server";
import { afterEach, describe, expect, it } from "vitest";

import { listen } from "./listen";

const host = "127.0.0.1";
const app = () => new Response("ok");
const servers: ServerType[] = [];

async function start(port: number): Promise<number> {
  const server = await listen(app, host, port);
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The server listens on no TCP port");
  }
  return address.port;
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))),
  );
});

describe("listen", () => {
  it("serves the app once it listens", async () => {
    // Port 0 lets the system choose a free port.
    const port = await start(0);

    expect(await (await fetch(`http://${host}:${port}/`)).text()).toBe("ok");
  });

  it("says in plain words that the port is busy and how to choose another one", async () => {
    const port = await start(0);

    await expect(listen(app, host, port)).rejects.toThrow(
      `Port ${port} of ${host} is already in use, often by another web interface still running. Stop it, or choose another port with WEB_PORT in .env.`,
    );
  });
});
