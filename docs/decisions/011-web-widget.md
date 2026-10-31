# 011 — A web widget, as a third channel of the agent

- Status: accepted
- Date: 2026-10-31

## Context

The P2 bonus of the brief asks for a widget that the client applications embed at the bottom right of their pages. People send a request, report a bug or ask for an evolution, attach a file or a capture of their screen, get a reference, and follow their request later. The widget must have no business logic of its own: like Slack and email, it is an input channel in front of the same agent.

## Options

| Question                                 | Options compared                                                                                                                                                                                        | Chosen                                                                                                                                                                         |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where the API of the widget runs         | A separate process, which would need the agent and its queue; or routes of the Mastra server, next to the Slack and email adapters                                                                      | **Routes of the Mastra server** (`server.apiRoutes`, `registerApiRoute` of Mastra 1.79). The widget is an adapter like the others, with the same handler, retries and recovery |
| How the agent knows who writes           | Every person unverified; a login of the widget itself, which people would not have; or the application, where the person is already signed in, signs their email with a secret it shares with the agent | **Signed identity**: HMAC-SHA256 of the email and an expiry, valid at most 24 hours. Without a signature, the person is unverified, as an unknown email sender                 |
| How a person finds their request again   | The reference and an email address, which anyone could type; or a random token of the conversation, kept by the browser that sent it                                                                    | **Conversation token**: 32 random bytes. Only a hash of it is stored, so a copy of the database opens no conversation                                                          |
| How the screen is captured               | A library that redraws the page, such as html2canvas: a new dependency that misses parts of a page; or the screen capture API of the browser, `getDisplayMedia`, which asks the person what to share    | **`getDisplayMedia`**, with no dependency. The button only appears where the browser offers it; a file can always be attached                                                  |
| How the answer reaches the widget        | A WebSocket or server-sent events, to push the answer; or the widget asks every 5 seconds while a message waits                                                                                         | **Polling every 5 seconds**, only while the agent works. The answer takes minutes on a CPU, so a push gains nothing                                                            |
| How the widget stays apart from the page | An iframe, which needs its own page and messages between frames; or a shadow root, which keeps the styles of the page and of the widget apart                                                           | **Shadow root**, in one script with no dependency                                                                                                                              |

## How it works

1. The application adds one script tag to its pages, with its project and, for a person signed in, their signed identity. See [`docs/widget.md`](../widget.md).
2. A message is stored with its files, then queued for the agent, like a Slack message. The answer `202` gives the conversation token at once.
3. The agent handles it one message at a time, with the retries and the recovery after a restart of the other channels. Its answer is stored in the conversation.
4. The widget shows the conversation: the messages, the answers of the agent, and the requests its messages created with their status. A request the message was only added to, such as the request of another person that it repeats, is not shown: it is not theirs.
5. A reply in the same conversation keeps the person and the trust of its first message.

## Protections

- **Origins.** The routes answer the browsers of the allowed applications only, `WIDGET_ALLOWED_ORIGINS`. Their CORS rule replaces the default rule of the Mastra server, which allows every site.
- **Files** ([OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)): at most 3 files of 5 MB. The type is read from the first bytes of the file, never from what the browser declares: PNG, JPEG, PDF or UTF-8 text without null bytes. Files are written under random names in `ATTACHMENTS_DIR`, outside the code. The team downloads them from the web interface, behind its sign-in, always as a download and never shown in a page.
- **Load.** Beyond 20 messages waiting for the agent, the widget asks people to come back later, since the model handles one message at a time.
- **Text.** The widget sets every text with `textContent`, so nothing the server returns can run in the page.

## Consequences

- The client applications get a support entry point without a business logic of their own.
- A person not signed in can write, but the agent treats them as an unverified sender: the message is filed for a review, and they see the reference and status of the request their message created.
- The conversations of a person are kept by their browser: another browser or cleared storage does not list them.
- The Mastra server must be reachable from the browsers of the applications. For now it listens on this machine only: opening it needs HTTPS and an authentication of the rest of its API, as the README says.

## Measures

The whole path was run in headless Chrome on the demo page (`pnpm demo:widget`), signed in as Bruno Leroy, with the real model and the Mastra server:

- The widget opened from its button, without an email field since the person was signed in. A PNG file was attached, and the message was sent as a bug report.
- After 380 seconds, the widget showed the answer of the agent and the request REQ-0013, "Bouton Valider inactif sur la page Commandes", with its status.
- The request was stored as a `BUG` of the PORTAL project, from the widget of the portal, with Bruno Leroy as verified author, the source `WIDGET`, and the file stored with its type read from its content.
- Through the Mastra server, a preflight request from the demo page got its origin back, and one from another site got none.

## Sources

- Mastra 1.79, custom routes: `registerApiRoute`, `server.apiRoutes` and the `cors` of a route in `@mastra/core/dist/server`. Checked on the running server: the CORS rule of the route replaces the default rule
- [MDN, `MediaDevices.getDisplayMedia()`](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia): secure context and a user action required
- [MDN, using shadow DOM](https://developer.mozilla.org/en-US/docs/Web/API/Web_components/Using_shadow_DOM)
- [RFC 2104, HMAC](https://www.rfc-editor.org/rfc/rfc2104)
- [OWASP File Upload Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [RFC 6266, `Content-Disposition`](https://www.rfc-editor.org/rfc/rfc6266)
