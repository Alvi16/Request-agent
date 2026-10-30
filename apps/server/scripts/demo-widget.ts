// Demonstration of the widget: a page of a fictitious customer portal that embeds it, as an
// application would. Its server signs the identity of the person signed in with the secret it
// shares with the agent, so the agent knows who writes. The agent server must be running.
// Usage: pnpm demo:widget [--email bruno.leroy@globex.example] [--anonymous] [--port 4114]
import { createServer } from "node:http";
import { parseArgs } from "node:util";

import { loadWidgetEnv } from "../src/config.ts";
import { signIdentity } from "../src/widget/identity.ts";

const { values } = parseArgs({
  options: {
    email: { type: "string", default: "bruno.leroy@globex.example" },
    anonymous: { type: "boolean", default: false },
    port: { type: "string", default: "4114" },
    server: { type: "string", default: "http://localhost:4111" },
  },
});

const env = loadWidgetEnv();
const port = Number(values.port);
const origin = `http://localhost:${port}`;
if (env === undefined || !env.WIDGET_ALLOWED_ORIGINS.includes(origin)) {
  console.error(`Add ${origin} to WIDGET_ALLOWED_ORIGINS in .env, then restart the agent server.`);
  process.exit(1);
}
if (!values.anonymous && env.WIDGET_IDENTITY_SECRET === undefined) {
  console.error("Set WIDGET_IDENTITY_SECRET in .env, or run with --anonymous.");
  process.exit(1);
}

// Values are written in attributes: escaped so an email cannot end the attribute.
const attribute = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

function page(): string {
  const identity =
    values.anonymous || env?.WIDGET_IDENTITY_SECRET === undefined
      ? ""
      : (() => {
          const signed = signIdentity(env.WIDGET_IDENTITY_SECRET, values.email, new Date());
          return ` data-user-email="${attribute(signed.email)}" data-user-expires="${signed.expires}" data-user-signature="${signed.signature}"`;
        })();
  const who = values.anonymous ? "visiteur non connecté" : attribute(values.email);
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Portail client (démonstration)</title>
  </head>
  <body style="font-family: system-ui, sans-serif; margin: 40px; color: #1d1d29">
    <h1>Portail client</h1>
    <p>Page fictive d'une application cliente, connectée en tant que : <strong>${who}</strong>.</p>
    <p>Le bouton « Besoin d'aide ? », en bas à droite, ouvre le widget de l'agent.</p>
    <script src="${attribute(values.server)}/widget/widget.js" data-project="PORTAL"${identity} defer></script>
  </body>
</html>`;
}

const server = createServer((request, response) => {
  if (request.url !== "/") {
    response.writeHead(404).end();
    return;
  }
  // A new signature each time the page loads, like an application would.
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page());
});
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `Port ${port} is already in use: choose another with --port.`
      : error.message,
  );
  process.exit(1);
});
server.listen(port, "127.0.0.1", () => {
  console.info(`Demo page of the widget: ${origin} (stop it with Ctrl+C)`);
});
