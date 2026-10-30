// Served as a file, since the content security policy allows no inline style or script.
export const stylesheet = `
:root {
  /* Palette Dark Violet / Night */
  --bg-app: #0e0e18;
  --bg-surface: #161626;
  --bg-surface-hover: #1f1f35;
  --bg-card: #1a1a2e;
  --border-color: rgba(255, 255, 255, 0.08);
  --border-focus: #7c5dfa;

  /* Accent & Actions */
  --primary: #6c5ce7;
  --primary-hover: #5b4bc4;
  --accent-purple: #7c5dfa;

  /* Typographie */
  --text-primary: #f0f0f8;
  --text-secondary: #9a9ab0;
  --text-muted: #64647a;

  /* Badges & Statuts */
  --badge-blue-bg: rgba(108, 92, 231, 0.15);
  --badge-blue-txt: #a29bfe;
  --badge-green-bg: rgba(46, 213, 115, 0.15);
  --badge-green-txt: #2ed573;
  --badge-yellow-bg: rgba(255, 171, 0, 0.15);
  --badge-yellow-txt: #ffab00;
  --badge-red-bg: rgba(255, 71, 87, 0.15);
  --badge-red-txt: #ff4757;
  --badge-gray-bg: rgba(255, 255, 255, 0.08);
  --badge-gray-txt: #9a9ab0;
}

/* Native controls, such as the lists of the selects, follow the dark palette. */
html { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 0;
  background-color: #0e0e18;
  color: #f0f0f8;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  display: flex;
  min-height: 100vh;
}
a { color: var(--accent-purple); text-decoration: none; }
a:hover { text-decoration: underline; }
h1 { font-size: 22px; font-weight: 600; margin: 0 0 20px; }
h2 { font-size: 15px; font-weight: 600; margin: 24px 0 12px; }
/* --text-muted is too faint for text on --bg-app: secondary text uses --text-secondary. */
.muted { color: var(--text-secondary); }

/* Navigation: a vertical sidebar fixed on the left. Only the header: the nav inside it and the
   pagination must stay where they are. */
header {
  width: 260px;
  min-width: 260px;
  height: calc(100vh - 32px);
  margin: 16px;
  padding: 20px;
  background-color: #161626;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  gap: 16px;
  box-sizing: border-box;
  position: fixed;
  left: 0;
  top: 0;
}
header nav { display: flex; flex-direction: column; gap: 4px; }
header nav a {
  padding: 8px 14px;
  border-radius: 999px;
  color: var(--text-secondary);
  font-weight: 500;
  transition: background-color 0.15s ease, color 0.15s ease;
}
header nav a:hover { text-decoration: none; color: var(--text-primary); background: var(--bg-surface-hover); }
header nav a[aria-current="page"] { color: #ffffff; background: var(--primary); }
/* The signed-in person and the sign-out button sit at the bottom of the sidebar. */
header .muted { margin-top: auto; padding-top: 16px; border-top: 1px solid var(--border-color); font-size: 13px; }
header form { margin: 0; }
header form button { width: 100%; }

/* Content, to the right of the sidebar. */
main {
  margin-left: 290px;
  flex: 1;
  padding: 24px 32px;
  max-width: calc(100vw - 320px);
}

/* Feedback after an action. */
.notice, .error { padding: 8px 12px; border-radius: 8px; font-size: 13px; }
.notice { color: var(--badge-green-txt); background: var(--badge-green-bg); }
.error { color: var(--badge-red-txt); background: var(--badge-red-bg); }

/* Forms. */
label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-secondary); }
input, select, button { font: inherit; font-size: 13px; border-radius: 8px; }
input, select {
  padding: 7px 10px;
  color: var(--text-primary);
  background: var(--bg-app);
  border: 1px solid var(--border-color);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
input::placeholder { color: var(--text-muted); }
input:focus, select:focus {
  outline: none;
  border-color: var(--border-focus);
  box-shadow: 0 0 0 3px rgba(124, 93, 250, 0.25);
}
button {
  padding: 7px 14px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  cursor: pointer;
  transition: background-color 0.15s ease;
}
button:hover { background: var(--bg-surface-hover); }
button.primary { color: #ffffff; background: var(--primary); border-color: var(--primary); }
button.primary:hover { background: var(--primary-hover); border-color: var(--primary-hover); }
button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(124, 93, 250, 0.4); }

/* Sign-in: a large frosted glass card over dark 3D spheres, drawn in CSS. After the generic
   form rules, which would otherwise win over these ones. */
body:has(.sign-in) {
  min-height: 100vh;
  width: 100vw;
  margin: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  background-color: #08080a;
  position: relative;
  overflow: hidden;
}
/* No sidebar on this page: the content is centered, above the spheres. */
body:has(.sign-in) main {
  position: relative;
  z-index: 10;
  flex: 0 1 auto;
  width: 100%;
  max-width: 512px;
  margin: 0;
  padding: 16px;
}
.sign-in {
  position: relative;
  z-index: 10;
  width: 100%;
  max-width: 480px;
  padding: 48px 40px;
  background: rgba(255, 255, 255, 0.03) !important;
  backdrop-filter: blur(20px) saturate(180%) !important;
  -webkit-backdrop-filter: blur(20px) saturate(180%) !important;
  border: 1px solid rgba(255, 255, 255, 0.18) !important;
  border-radius: 4px !important;
  box-shadow: 0 30px 60px rgba(0, 0, 0, 0.8), inset 0 0 0 1px rgba(255, 255, 255, 0.05);
}
.sign-in h1 {
  font-size: 22px;
  font-weight: 500;
  color: #ffffff;
  margin-bottom: 28px;
  letter-spacing: -0.3px;
}
.sign-in input {
  width: 100%;
  background: rgba(0, 0, 0, 0.4) !important;
  border: 1px solid rgba(255, 255, 255, 0.15) !important;
  color: #ffffff !important;
  padding: 12px 16px;
  border-radius: 6px;
  margin-bottom: 16px;
  box-sizing: border-box;
}
.sign-in button {
  width: 100%;
  background: #ffffff !important;
  color: #000000 !important;
  font-weight: 600;
  padding: 12px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  margin-top: 10px;
}
body:has(.sign-in)::before, body:has(.sign-in)::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  z-index: 1;
}
/* Large sphere, on the right. */
body:has(.sign-in)::before {
  width: 380px;
  height: 380px;
  right: 22%;
  top: 25%;
  background: radial-gradient(circle at 35% 25%, #44444a 0%, #151518 50%, #050506 100%);
  box-shadow:
    inset -15px -15px 30px rgba(0, 0, 0, 0.9),
    inset 10px 10px 20px rgba(255, 255, 255, 0.25),
    0 20px 50px rgba(0, 0, 0, 0.8);
}
/* Smaller sphere, bottom left. */
body:has(.sign-in)::after {
  width: 260px;
  height: 260px;
  left: 25%;
  bottom: 18%;
  background: radial-gradient(circle at 35% 25%, #3a3a40 0%, #111114 50%, #020203 100%);
  box-shadow:
    inset -12px -12px 25px rgba(0, 0, 0, 0.95),
    inset 8px 8px 15px rgba(255, 255, 255, 0.2),
    0 15px 40px rgba(0, 0, 0, 0.9);
}

/* Filters: a dark card above the table. */
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  margin-bottom: 16px;
  padding: 16px;
  background: #161626;
  border: 1px solid var(--border-color);
  border-radius: 12px;
}
.filters > a { padding: 7px 4px; font-size: 13px; }

/* Tables of requests. */
.table {
  overflow-x: auto;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
}
table { width: 100%; border-collapse: separate; border-spacing: 0; border-radius: 12px; font-size: 13px; }
th, td { padding: 10px 12px; text-align: left; vertical-align: middle; border-bottom: 1px solid var(--border-color); }
th {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: var(--text-secondary);
  background: var(--bg-surface);
}
tbody tr { transition: background-color 0.15s ease; }
tbody tr:hover { background: var(--bg-surface-hover); }
tbody tr:last-child td { border-bottom: none; }
td:first-child { white-space: nowrap; }
td:first-child a { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; font-weight: 400; }
.pages { display: flex; gap: 12px; align-items: center; margin-top: 16px; font-size: 13px; }
.pages a { padding: 6px 12px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 8px; }

/* Badges: colored pills. */
.badge, span.review {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.badge-red, span.review { color: var(--badge-red-txt); background: var(--badge-red-bg); }
.badge-yellow { color: var(--badge-yellow-txt); background: var(--badge-yellow-bg); }
.badge-green { color: var(--badge-green-txt); background: var(--badge-green-bg); }
.badge-blue { color: var(--badge-blue-txt); background: var(--badge-blue-bg); }
.badge-gray { color: var(--badge-gray-txt); background: var(--badge-gray-bg); }
h1 span.review { vertical-align: middle; margin-left: 8px; }
p.review { padding: 8px 12px; border-radius: 8px; font-size: 13px; color: var(--badge-red-txt); background: var(--badge-red-bg); }

/* Page of a request: the conversation and its history, then the side column of cards. */
.detail { display: grid; grid-template-columns: 1fr 340px; gap: 24px; align-items: start; }
.detail-main { min-width: 0; }
.detail-main > h2:first-child { margin-top: 0; }
.detail-side { display: flex; flex-direction: column; gap: 16px; }
.card { padding: 16px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 12px; }
.card h2 { margin: 0 0 12px; font-size: 14px; }
.card form { display: flex; flex-direction: column; gap: 12px; }
.card form button { align-self: flex-start; }
.card input, .card select { width: 100%; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 8px 16px; margin: 0; font-size: 13px; }
dt { color: var(--text-secondary); }
dd { margin: 0; overflow-wrap: anywhere; }

/* Conversation thread. */
.message {
  margin: 0 32px 12px 0;
  padding: 14px 16px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: 12px;
}
.message.outbound { margin: 0 0 12px 32px; background: var(--badge-blue-bg); border-color: rgba(124, 93, 250, 0.3); }
.message .muted { font-size: 12px; }
.message strong { display: block; margin-top: 6px; }
.message pre { margin: 8px 0 0; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }

/* Activity timeline. */
.history { position: relative; margin: 0; padding: 0; list-style: none; font-size: 13px; }
.history::before {
  content: "";
  position: absolute;
  top: 6px;
  bottom: 6px;
  left: 4px;
  width: 1px;
  background: var(--border-color);
}
.history li { position: relative; padding: 0 0 14px 24px; }
.history li::before {
  content: "";
  position: absolute;
  top: 5px;
  left: 0;
  width: 9px;
  height: 9px;
  border: 2px solid var(--accent-purple);
  border-radius: 50%;
  background: var(--bg-app);
}
.history .muted { margin-top: 2px; font-size: 12px; }

/* Narrower screens: with the sidebar, the request page has room for one column only. */
@media (max-width: 1200px) {
  .detail { grid-template-columns: 1fr; }
}
/* Phones: the sidebar would leave no room for the content, so it becomes a bar at the top. */
@media (max-width: 900px) {
  body { flex-direction: column; }
  header {
    position: static;
    width: auto;
    min-width: 0;
    height: auto;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
  }
  header nav { flex-direction: row; flex: 1; }
  header .muted { margin-top: 0; padding-top: 0; border-top: none; }
  header form button { width: auto; }
  main { margin-left: 0; max-width: none; padding: 8px 16px 32px; }
}
`;
