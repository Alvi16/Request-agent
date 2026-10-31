# 008 — Web interface of the team

- Status: accepted
- Date: 2026-10-29

## Context

The brief asks for a simple web interface to consult the requests (category, project, author, status, priority, source, history, related messages), to search them, and to check that the automatic decisions of the agent are right, with a human validation when the agent is unsure (brief, section 6, P1). The interface shows every request and the full text of the messages, so only members of the team may use it, and the history must tell which person validated or changed a request.

## Where the interface runs

| Option                                                                        | Assessment                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Custom routes of the Mastra server                                            | One process, but the pages would share the server of the agent, its API and Mastra Studio, which has no authentication (decision 003), and their configuration                                                                                                                                                                                                                                                     |
| A React single-page application with a JSON API                               | A build step, a client bundle and an API to protect, for a few pages of tables and forms                                                                                                                                                                                                                                                                                                                           |
| A full-stack framework, such as Next.js                                       | Dozens of dependencies, and its own server and build to maintain                                                                                                                                                                                                                                                                                                                                                   |
| **A separate `apps/web` package, with Hono and pages rendered on the server** | **Chosen.** Hono 4.13.14 is already installed with Mastra, at the same version. Its `html` templates escape every value (tested with `<script>` and quotes), so the text of senders cannot run in a page. The pages work without JavaScript: one short script of the site only updates the list as a person types or chooses a filter. Node.js runs the TypeScript directly: no build step. The agent is untouched |

The interface reads and changes the data through the business core only. Only `@hono/node-server` 2.1.5, the official Node.js adapter of Hono, is added.

## Who may sign in

| Option                                               | Assessment                                                                                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One shared password (HTTP Basic authentication)      | The history could not name who validated a request, there is no sign-out, and the password must be shared                                                     |
| Sign-in with Slack or Google (OpenID Connect)        | The best for a company, but it needs an application registered with the provider and a public HTTPS address to come back to, which a local demo does not have |
| **A personal account and a session in the database** | **Chosen.** Each action is recorded with the person who made it, a session can be ended, and nothing outside the project is needed                            |

An account belongs to a contact (`staff_accounts`), so the history names the person. Accounts are created with `pnpm staff:add`, which reads the password without showing it, never from the command line. Following the OWASP cheat sheets:

- Passwords have at least 15 characters (NIST SP 800-63B, for a password used alone). They are stored as Argon2id hashes with the minimum OWASP parameters (19 MiB, 2 passes, 1 lane), computed by Node.js itself (`crypto.argon2`, added in Node.js 24.7). No dependency is added.
- An unknown email and a wrong password get the same answer, in the same time, so the answer does not tell which emails have an account.
- After 5 failures for an email, signing in with it is refused for 15 minutes.
- A session is a 256-bit random token (OWASP asks for at least 64 bits of entropy) in a cookie that is `HttpOnly`, `Secure` and `SameSite=Lax`. Only its SHA-256 hash is stored, so a copy of the database does not give access. A session ends after 8 hours, the upper bound OWASP gives for a full-day office application, or when the person signs out. The application role cannot delete rows, so signing out marks the session as revoked.
- A disabled account cannot sign in, and its open sessions stop working.

Browsers keep `Secure` cookies over HTTPS. Over plain HTTP, Chrome and Firefox keep them on `localhost` only, and Safari never does (MDN): checked with Chrome 155 on `http://127.0.0.1`. Locally, the interface is therefore used with Chrome or Firefox. It listens on this machine only by default, and must only be opened to the network behind HTTPS.

## Protection of the pages

- **Forged requests (CSRF):** a form is accepted only when the `Origin` or `Sec-Fetch-Site` header shows that it comes from the interface itself (Hono `csrf` middleware), on top of the `SameSite=Lax` cookie.
- **Content Security Policy:** only the script and stylesheet served by the interface itself: no inline script or style, no resource from another site, and no framing of the pages. The script may only fetch pages of the interface. The other OWASP secure headers are set by Hono's `secureHeaders`.
- **Caching:** the pages are sent with `Cache-Control: no-store`, since they show private data.
- **Inputs:** filters and forms are validated with the same Zod schemas as the business core. An unknown value is refused.

## What the interface offers

- The list of requests, a page of 50 at a time, with a search and filters by project, status, type, source and review. As in the search box of a website, the results follow what is typed, a quarter of a second after the last key, and each filter applies as soon as it is chosen: only the results are replaced, so the search field keeps what is being typed. Without JavaScript, a button applies them.
- The search finds each word typed in the reference, title, summary, description or requester, even as a part of a word, whatever its accents and case: "paie" finds "Paiement", "echec" finds "échec", and "0013" finds REQ-0013. It also finds French words in other forms, such as "factures" for "facture". The requests whose words match best come first, then the titles closest to the search.
- The review queue, oldest first, with the reasons of each review.
- The page of a request: its fields, the requester and their organization, the confidence of the agent, a possible duplicate, the messages with their attachments and the answers of the agent, and the full history, with the person behind each human action.
- Three actions, each recorded in the history as done by the signed-in person: validate a request with corrections (type, priority, project, status), change its status, mark it as a duplicate of another request.

Members of the team see every request: the access rule of decision 003 protects the requests from senders, not from the team.

To show the answers of the agent, which are stored in the conversation, a request lists the answers sent to its own messages, through `in_reply_to`. Slack answers now record it too, like emails already did.

## Consequences

- One more process to start, `pnpm web`, next to the agent server.
- The sign-in limit is kept in memory: a restart clears it, and it tracks at most 10,000 emails, dropping the oldest. It is enough for one process. Several processes would need a shared store.
- Slack answers sent before this change are not tied to their message, and are not shown on the request page.
- The workspace tests now run one package after the other, since the server and the interface share the test database.

## Sources

- [Hono `html` helper](https://hono.dev/docs/helpers/html), [CSRF middleware](https://hono.dev/docs/middleware/builtin/csrf), [Secure Headers middleware](https://hono.dev/docs/middleware/builtin/secure-headers), [Cookie helper](https://hono.dev/docs/helpers/cookie)
- [Node.js 26 `crypto.argon2`](https://nodejs.org/docs/latest-v26.x/api/crypto.html#cryptoargon2algorithm-parameters-callback)
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html), [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html), [Cross-Site Request Forgery Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
- [NIST SP 800-63B-4, section 3.1.1.2, password length](https://pages.nist.gov/800-63-4/sp800-63b.html)
- [MDN, Using HTTP cookies: `Secure` and localhost](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
