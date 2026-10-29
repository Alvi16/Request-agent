# 006 — Email connection

- Status: accepted
- Date: 2026-10-29

## Context

The agent watches a dedicated mailbox. For each email it identifies the project, the author and the type, keeps the original email, links the emails of a conversation, and avoids creating several requests for the same problem (brief, sections 3 and 4). Real company mailboxes must not be connected during the project, and everything runs on the development machine ([decision 002](002-runtime-and-database.md)). For real use, people must be able to write to the agent from their own mailbox, which a mail server on the development machine does not allow.

## Mailbox

| Option                         | Assessment                                                                                                                                                                                                             |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GreenMail 2.1.15 in Docker** | **Chosen** for development and the tests. A real SMTP and IMAP server, with no account, but only reachable from this machine. Tested: sending, reading, flags and IDLE notifications                                   |
| Mailpit                        | No IMAP, only POP3 and a web interface                                                                                                                                                                                 |
| **Gmail over IMAP**            | **Chosen** for real use, with an account dedicated to the agent. An app password needs 2-Step Verification. Google does not recommend app passwords, but they are the only way that does not need an OAuth application |
| Outlook.com over IMAP          | Microsoft retired password authentication for Outlook.com mail: OAuth is required                                                                                                                                      |
| Gmail API or Microsoft Graph   | An OAuth application to register, and code specific to one provider. A Google OAuth application in testing status gets refresh tokens that expire after 7 days                                                         |

## Gmail

- The agent has its own Gmail account: it handles and answers every email of its inbox, so a personal mailbox cannot be used.
- Since March 14, 2025, Google refuses the account password over IMAP and SMTP. An app password still works on a personal account with 2-Step Verification, and Google revokes it when the account password changes.
- Servers: `imap.gmail.com` on port 993 and `smtp.gmail.com` on port 465, both over TLS. IMAP access is always on in Gmail.
- Gmail closes an IMAP session after about 24 hours. The adapter opens the mailbox again 10 seconds after any closing. Tested with the network cut for 25 seconds: two attempts failed, and the third one reconnected. When nothing happens, `imapflow` breaks IDLE every 5 minutes with a NOOP, which also detects a dead connection.
- Gmail writes `Authentication-Results: mx.google.com; dkim=…; spf=…; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=…; dara=…`, checked on the emails received by the agent's account, so `EMAIL_TRUSTED_AUTHSERV_ID=mx.google.com` verifies the senders.
- A new Gmail account receives emails from `no-reply@google.com` and `no-reply@accounts.google.com`, recognized as automatic.
- Emails that Gmail puts in Spam are not in the inbox, so the agent does not read them.
- Gmail announces a new email over IDLE later than the local server: measured, the agent read two emails 34 and 43 seconds after Gmail received them, against about a second locally. The model then takes 2 to 4 minutes.
- Gmail keeps the Message-ID that the agent gives its answers, as found in its Sent folder, so a reply to an answer is attached to its conversation.

## Libraries

| Need                        | Options                                                                                                                | Choice                                                                                                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Watching the mailbox        | **`imapflow` 2.9** (MIT, updated 2026-10-22, TypeScript types, IDLE); `imap` and `imap-simple`, last released in 2022  | `imapflow`                                                                                                                                                        |
| Reading an email            | **`postal-mime` 4.1** (MIT-0, no dependency); `mailparser`, in maintenance mode, whose author recommends `postal-mime` | `postal-mime`                                                                                                                                                     |
| Sending answers             | **`nodemailer` 10.2** (MIT-0), the reference SMTP client for Node.js                                                   | `nodemailer`                                                                                                                                                      |
| Removing the quoted history | **`email-reply-parser` 2.3** (MIT, no dependency); a hand-written rule                                                 | `email-reply-parser`. Tested on Gmail replies in French and English, an Outlook reply in French and a signature, and it left a line containing `10 > 8` untouched |

## Verifying the sender

A test email carrying a forged `Authentication-Results: dmarc=pass` header arrived unchanged in the mailbox. A sender is therefore verified only by the first `Authentication-Results` header of the email, the one the receiving server adds, when its `authserv-id` is the configured one (`EMAIL_TRUSTED_AUTHSERV_ID`), DMARC passed, and the checked domain is the domain of the `From` address. Any other such header is ignored (RFC 8601, sections 5 and 7).

GreenMail checks no sender. For local tests, `EMAIL_TRUST_LOCAL_SENDERS=true` makes every sender verified, and the configuration refuses it when the mailbox is not on this machine.

## Automatic emails

Following RFC 3834, an email is neither handled nor answered when it has an `Auto-Submitted` header other than `no`, a `Precedence` of `bulk`, `junk` or `list`, a `List-*` header, an empty return path, a robot sender such as `mailer-daemon` or `no-reply`, also with a prefix like `billing-noreply`, or the agent's own address. It is still stored. The agent's answers carry `Auto-Submitted: auto-replied`, `In-Reply-To` and `References`. Their subject keeps `Re:` and adds the request reference, such as `Re: Portal error [REQ-0004]`, so mail clients and people follow the thread. RFC 3834 suggests `Auto:` for automatic answers, but these answers continue a conversation.

## Behavior

- At the first start, the unread emails are read. Then the agent reads every email that arrived after the last one it read, read or not, and every email still unread, then each new email about a second after it arrives. `imapflow` starts IDLE after 15 seconds of inactivity by default, and measured, a new email was then noticed after 13 seconds. The delay is set to 1 second, which its documentation allows when commands follow each other without pause.
- The last email read is found by its IMAP UID, kept in the `mailbox_cursors` table with the UIDVALIDITY of the mailbox, not by the `\Seen` flag. In Gmail, a person who opens an email marks it as read, and with `\Seen` alone the agent would never handle it. A new UIDVALIDITY means the UIDs were renumbered: the agent then reads the unread emails again, like at the first start.
- Each email is stored before it is marked as read and before the cursor moves past it, so a read email is never lost. One that cannot be stored stays unread and is read again. A repeated delivery is handled once, thanks to its unique Message-ID.
- A reply is attached to its conversation through `References`, or through the message named by `In-Reply-To` when a mail client keeps only that header.
- The model reads the new part of the email. The whole text, the headers and the description of the attachments are kept with the message.

## Consequences

- Checked with the real model and the agent's Gmail account: an email from a registered contact, verified by DMARC, was added to the open request about the same problem, the answer arrived in the sender's Gmail thread, and the reply "Où en êtes-vous ?" in that thread was added to the same request.
- Checked with the real model on the local mail server: an email became a request of the right project with its attachment, the answer arrived in the sender's mailbox in the same thread, a follow-up with only `In-Reply-To` was added to the same request, and an out-of-office reply was kept without being answered.
- `pnpm db:up` starts the mail server with the database, and the tests use a separate mailbox that they empty.
- Attachments are described but their content is not stored yet.

## Sources

- [GreenMail](https://greenmail-mail-test.github.io/greenmail/) and its [Docker image](https://hub.docker.com/r/greenmail/standalone)
- [Mailpit documentation](https://mailpit.axllent.org/docs/)
- [Google app passwords](https://support.google.com/mail/answer/185833) and [Gmail with other email clients](https://support.google.com/mail/answer/7126229)
- [Gmail IMAP and SMTP](https://developers.google.com/workspace/gmail/imap/imap-smtp): servers, ports and session lifetime
- [Transition from less secure apps to OAuth](https://knowledge.workspace.google.com/admin/sync/transition-from-less-secure-apps-to-oauth) and [refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration)
- [RFC 9051, IMAP4rev2](https://www.rfc-editor.org/rfc/rfc9051.html): UIDs and UIDVALIDITY
- [Outlook.com and Basic authentication](https://support.microsoft.com/en-us/office/f4202ebf-89c6-4a8a-bec3-3d60cf7deaef)
- [`imapflow`](https://imapflow.com/docs/), [`postal-mime`](https://github.com/postalsys/postal-mime), [`nodemailer`](https://nodemailer.com/), [`email-reply-parser`](https://github.com/crisp-oss/email-reply-parser)
- [RFC 3834, Recommendations for Automatic Responses to Electronic Mail](https://www.rfc-editor.org/rfc/rfc3834.html)
- [RFC 8601, Message Header Field for Indicating Message Authentication Status](https://www.rfc-editor.org/rfc/rfc8601.html)
