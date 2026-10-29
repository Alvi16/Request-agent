// Served as a file, since the content security policy allows no inline style or script.
export const stylesheet = `
:root {
  color-scheme: light dark;
  --text: #1d2125;
  --muted: #5e6670;
  --background: #ffffff;
  --surface: #f4f5f7;
  --border: #d5d9de;
  --accent: #0b5cad;
  --warning: #8a4b00;
  --warning-surface: #fff4e0;
  --success-surface: #e6f4ea;
  --error-surface: #fde8e8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --text: #e3e6ea;
    --muted: #a0a8b2;
    --background: #16191d;
    --surface: #20242a;
    --border: #3a4049;
    --accent: #7db4f0;
    --warning: #f2b45c;
    --warning-surface: #3a2a12;
    --success-surface: #173322;
    --error-surface: #3d1a1a;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--text);
  background: var(--background);
}
header {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  align-items: center;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}
header nav { display: flex; gap: 1rem; flex: 1; }
header form { margin: 0; }
main { max-width: 72rem; margin: 0 auto; padding: 1rem; }
a { color: var(--accent); }
h1 { font-size: 1.4rem; margin: 0.5rem 0 1rem; }
h2 { font-size: 1.1rem; margin: 1.5rem 0 0.5rem; }
.muted { color: var(--muted); }
.notice { padding: 0.5rem 0.75rem; border-radius: 4px; background: var(--success-surface); }
.error { padding: 0.5rem 0.75rem; border-radius: 4px; background: var(--error-surface); }
.review { color: var(--warning); background: var(--warning-surface); padding: 0 0.4rem; border-radius: 4px; white-space: nowrap; }
.filters, .actions form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: end; margin-bottom: 1rem; }
label { display: flex; flex-direction: column; font-size: 0.85rem; color: var(--muted); gap: 0.2rem; }
input, select, button {
  font: inherit;
  color: var(--text);
  background: var(--background);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.3rem 0.5rem;
}
button { cursor: pointer; background: var(--surface); }
button.primary { background: var(--accent); color: var(--background); border-color: var(--accent); }
.table { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; }
td:first-child { white-space: nowrap; }
th { font-size: 0.85rem; color: var(--muted); font-weight: 600; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 0.3rem 1rem; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; }
.message { border: 1px solid var(--border); border-radius: 4px; padding: 0.5rem 0.75rem; margin-bottom: 0.5rem; }
.message pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; margin: 0.5rem 0 0; }
.outbound { background: var(--surface); }
.history li { margin-bottom: 0.3rem; }
.pages { display: flex; gap: 1rem; margin-top: 1rem; }
.sign-in { max-width: 22rem; margin: 4rem auto; display: flex; flex-direction: column; gap: 0.75rem; }
`;
