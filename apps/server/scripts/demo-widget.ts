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

// Fictitious orders of the portal, so the page looks like the application a client would use.
const orders = [
  ["CMD-1042", "Licences annuelles x 25", "4 850,00 €", "À valider"],
  ["CMD-1041", "Support premium", "1 200,00 €", "À valider"],
  ["CMD-1039", "Formation équipe", "2 400,00 €", "Validée"],
  ["CMD-1036", "Module export PDF", "980,00 €", "Livrée"],
  ["CMD-1033", "Extension stockage 500 Go", "360,00 €", "Livrée"],
] as const;

const styles = `
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1c2434; background: #f4f6fa; }
.demo { padding: 8px 16px; background: #fff7e0; color: #6b5200; font-size: 13px; text-align: center; }
.bar { display: flex; align-items: center; gap: 32px; padding: 0 32px; height: 64px; background: #0f2a4a; color: #fff; }
.logo { font-size: 20px; font-weight: 800; letter-spacing: .5px; }
.logo span { color: #4cc3ff; }
nav { display: flex; gap: 4px; flex: 1; }
nav a { padding: 8px 14px; border-radius: 8px; color: #c7d4e6; text-decoration: none; font-size: 14px; }
nav a[aria-current] { background: rgba(255,255,255,.12); color: #fff; }
.user { display: flex; align-items: center; gap: 10px; margin-left: auto; font-size: 14px; }
.avatar { display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; background: #4cc3ff; color: #0f2a4a; font-weight: 700; }
main { max-width: 1100px; margin: 0 auto; padding: 32px; }
h1 { margin: 0 0 4px; font-size: 26px; }
.lead { margin: 0 0 24px; color: #5b6578; }
.cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 24px; }
.card { padding: 18px 20px; background: #fff; border: 1px solid #e3e8f0; border-radius: 12px; }
.card p { margin: 0; color: #5b6578; font-size: 13px; }
.card strong { display: block; margin-top: 6px; font-size: 26px; }
.table { background: #fff; border: 1px solid #e3e8f0; border-radius: 12px; overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th { padding: 12px 16px; text-align: left; color: #5b6578; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; background: #f8fafc; }
td { padding: 14px 16px; border-top: 1px solid #edf1f6; }
.status { padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; background: #e8f5ec; color: #1d7a3e; }
.status.todo { background: #fff3dc; color: #8a5a00; }
.validate { padding: 7px 14px; border: none; border-radius: 8px; background: #0f6fde; color: #fff; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
.validate:disabled { background: #c9d3e0; cursor: not-allowed; }
@media (max-width: 760px) {
  .bar { gap: 12px; padding: 0 16px; } nav, .user span { display: none; }
  main { padding: 20px 16px; } .cards { grid-template-columns: 1fr; }
}
`;

function page(): string {
  const identity =
    values.anonymous || env?.WIDGET_IDENTITY_SECRET === undefined
      ? ""
      : (() => {
          const signed = signIdentity(env.WIDGET_IDENTITY_SECRET, values.email, new Date());
          return ` data-user-email="${attribute(signed.email)}" data-user-expires="${signed.expires}" data-user-signature="${signed.signature}"`;
        })();
  const who = values.anonymous ? "Visiteur" : attribute(values.email);
  const rows = orders
    .map(
      ([reference, label, amount, status]) => `<tr>
          <td><strong>${reference}</strong></td><td>${label}</td><td>${amount}</td>
          <td><span class="status${status === "À valider" ? " todo" : ""}">${status}</span></td>
          <td><button class="validate" type="button"${status === "À valider" ? "" : " disabled"}>Valider</button></td>
        </tr>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Globex · Portail client (démonstration)</title>
    <style>${styles}</style>
  </head>
  <body>
    <div class="demo">Démonstration : application fictive d'un client, qui intègre le widget de l'agent (bulle en bas à droite).</div>
    <header class="bar">
      <div class="logo">GLOBEX<span>.</span></div>
      <nav>
        <a href="/">Tableau de bord</a>
        <a href="/" aria-current="page">Commandes</a>
        <a href="/">Factures</a>
        <a href="/">Paramètres</a>
      </nav>
      <div class="user"><span>${who}</span><div class="avatar">${values.anonymous ? "?" : "BL"}</div></div>
    </header>
    <main>
      <h1>Commandes</h1>
      <p class="lead">Suivez et validez les commandes de votre organisation.</p>
      <section class="cards">
        <div class="card"><p>Commandes à valider</p><strong>2</strong></div>
        <div class="card"><p>Livrées ce mois-ci</p><strong>14</strong></div>
        <div class="card"><p>Montant du mois</p><strong>9 790 €</strong></div>
      </section>
      <div class="table">
        <table>
          <thead><tr><th>Commande</th><th>Article</th><th>Montant</th><th>Statut</th><th></th></tr></thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </main>
    <script src="${attribute(values.server)}/widget/widget.js" data-project="PORTAL"${identity} defer></script>
  </body>
</html>`;
}

const server = createServer((request, response) => {
  // The portal has no icon: browsers ask for one, and get an empty answer instead of an error.
  if (request.url === "/favicon.ico") {
    response.writeHead(204).end();
    return;
  }
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
