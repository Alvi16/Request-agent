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
  min-height: 100vh;
  font: 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  color: var(--text-primary);
  background: var(--bg-app);
}
main { max-width: 72rem; margin: 0 auto; padding: 8px 16px 32px; }
a { color: var(--accent-purple); text-decoration: none; }
a:hover { text-decoration: underline; }
h1 { font-size: 22px; font-weight: 600; margin: 8px 0 20px; }
h2 { font-size: 15px; font-weight: 600; margin: 24px 0 12px; }
/* --text-muted is too faint for text on --bg-app: secondary text uses --text-secondary. */
.muted { color: var(--text-secondary); }

/* Sign-in: a glass card over soft violet orbs. */
body:has(.sign-in) {
  background:
    radial-gradient(600px circle at 15% 20%, rgba(108, 92, 231, 0.22), transparent 60%),
    radial-gradient(500px circle at 85% 80%, rgba(124, 93, 250, 0.16), transparent 60%),
    var(--bg-app);
}
body:has(.sign-in) main { min-height: 100vh; display: grid; place-items: center; }
.sign-in {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 32px;
  background: rgba(22, 22, 38, 0.5);
  backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
}
.sign-in h1 { margin: 0 0 8px; }
.sign-in button { padding: 10px 14px; }

/* Navigation: a rounded dark pill. */
header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  max-width: calc(72rem - 32px);
  margin: 16px auto;
  padding: 8px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border-color);
  border-radius: 16px;
}
@media (max-width: 72rem) {
  header { margin: 16px; }
}
header nav { display: flex; gap: 4px; flex: 1; }
header nav a {
  padding: 6px 14px;
  border-radius: 999px;
  color: var(--text-secondary);
  font-weight: 500;
  transition: background-color 0.15s ease, color 0.15s ease;
}
header nav a:hover { text-decoration: none; color: var(--text-primary); background: var(--bg-surface-hover); }
header nav a[aria-current="page"] { color: #ffffff; background: var(--primary); }
header .muted { padding-left: 12px; border-left: 1px solid var(--border-color); font-size: 13px; }
header form { margin: 0; }

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
.filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
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

/* Badges. */
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
@media (max-width: 900px) {
  .detail { grid-template-columns: 1fr; }
}
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
`;
