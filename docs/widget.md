# Web widget

The widget lets the people of a client application write to the agent from the application itself: ask a question, report a bug or ask for an evolution, with files or a capture of their screen. They see the answer of the agent, the reference of their request and its status, and can reply in the same conversation. The choices behind it are recorded in [decision 011](decisions/011-web-widget.md).

The widget has no business logic: it sends what the person writes to the agent server, and shows what the server answers. The agent handles a widget message like a Slack message or an email.

## Configuration of the agent server

| Variable                 | Role                                                                                                                                                        | Example value                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `WIDGET_ALLOWED_ORIGINS` | Origins of the applications that embed the widget, separated by commas. Without it, the server runs without the widget                                      | `https://portal.example.com`          |
| `WIDGET_IDENTITY_SECRET` | Optional. Secret shared with the applications, at least 32 characters, to sign the identity of the person signed in. Without it, every person is unverified | Generated with `openssl rand -hex 32` |
| `ATTACHMENTS_DIR`        | Absolute path of the folder where the files people attach are written. The web interface of the team reads the same folder to download them                 | `/var/lib/request-agent/attachments`  |

Restart the agent server after changing them. The log shows `Widget listening`.

## Embedding the widget

Add one script tag to the pages of the application:

```html
<script
  src="https://agent.example.com/widget/widget.js"
  data-project="PORTAL"
  data-user-email="bruno.leroy@globex.example"
  data-user-expires="1793489724"
  data-user-signature="…"
  defer
></script>
```

- `data-project` is the key of the project of the application. It identifies the project of the messages when the project has a widget channel (`project_channels`, channel `WIDGET`, the project key as external ID).
- The three `data-user-` attributes tell who is signed in. Leave them out for a visitor who is not signed in: the widget then asks for their email address, and the agent treats them as unverified.

## Signing the identity of the person

The server of the application, never the browser, computes the signature for the person signed in, each time it renders a page:

- `email`: the address of the person, in lower case;
- `expires`: a Unix time in seconds, at most 24 hours ahead;
- `signature`: the HMAC-SHA256, in hexadecimal, of the email, a line break and the expiry, with `WIDGET_IDENTITY_SECRET`.

In Node.js:

```js
import { createHmac } from "node:crypto";

const email = user.email.trim().toLowerCase();
const expires = Math.floor(Date.now() / 1000) + 24 * 60 * 60;
const signature = createHmac("sha256", process.env.WIDGET_IDENTITY_SECRET)
  .update(`${email}\n${expires}`)
  .digest("hex");
```

The agent then recognizes the person as a verified contact, with their organization and projects, as for an email that passed DMARC. A signature that is missing, wrong or expired makes the person unverified: their message is filed for a review.

## What the person can do

- **Send a message**, choosing "Poser une question", "Signaler un bug" or "Demander une évolution". The choice is the subject of the message, which the classifier reads.
- **Attach files**, chosen or dropped on the form: at most 3 files of 5 MB, PNG, JPEG, PDF or plain text. The type is checked from the content of the file.
- **Capture the screen**, where the browser offers it: the browser asks which screen, window or tab to share, and the widget keeps one image. The page must be served over HTTPS, or from `localhost`.
- **Follow the conversation**: the answer of the agent arrives after a few minutes, and the widget shows it, with the reference and status of the request, which stay in sight while the messages scroll. "Mes demandes" lists the conversations sent from this browser.
- **Reply** in the same conversation, as in an email thread.

## API

The script uses these routes of the agent server. They need no Mastra session, and only answer the browsers of `WIDGET_ALLOWED_ORIGINS`.

| Route                                        | Role                                                                                                                                                                            |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /widget/widget.js`                      | The script of the widget                                                                                                                                                        |
| `POST /widget/messages`                      | A new message, as `multipart/form-data`: `kind`, `text`, `email`, optional `expires`, `signature`, `project` and `files`. Answers `202` with the conversation token             |
| `GET /widget/conversations/:token`           | The messages, the answers of the agent, the requests created with their status as a sentence (`status`) and as a code (`statusCode`), and whether a message waits for the agent |
| `POST /widget/conversations/:token/messages` | A reply: `text` and optional `files`. It keeps the person of the conversation                                                                                                   |

The token is the only key to a conversation: the widget keeps it in the storage of the browser.

## Trying it locally

1. Set the three variables in `.env`, with `http://localhost:4114` as allowed origin, then start the agent server with `pnpm dev`.
2. Start the demo page, a fictitious customer portal signed in as Bruno Leroy:

   ```bash
   pnpm demo:widget
   ```

   Use `--email` for another contact, or `--anonymous` for a visitor who is not signed in.

3. Open `http://localhost:4114` in Chrome or Firefox and click "Besoin d'aide ?".
4. The request appears in the web interface of the team with the source "Widget", and its files can be downloaded from its page.

## Limits

- The Mastra server listens on this machine only. To embed the widget in an application on another machine, the server must be served over HTTPS, and the rest of its API protected, as the README says.
- The conversations of a person are known to the browser that sent them: another browser or cleared storage does not list them.
- Screen capture is not available on phones: a file can be attached instead.
