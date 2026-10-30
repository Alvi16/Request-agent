# Demonstration

This guide runs the two scenarios of the brief, Email → Agent → Request and Slack → Agent → Request, on fictitious data, then checks the result in the web interface. Everything runs on this machine. Only the Slack scenario uses an online service: a test workspace, never a company one.

## Before you start

- The project is installed and configured as described in the [README](../README.md): `pnpm install`, `.env` created from `.env.example`, and the `ornith:9b` model pulled.
- For the email scenario, `.env` keeps the values of the local mail server, with `EMAIL_TRUST_LOCAL_SENDERS=true`, so the fictitious senders count as verified.
- For the Slack scenario, the Slack app is created and its two tokens are set in `.env`, as described in [Connecting Slack](../README.md#connecting-slack).

On a CPU, each answer of the agent takes 2 to 7 minutes. A computer that goes to sleep pauses the agent: keep it awake during the demonstration.

## 1. Prepare the data

```bash
pnpm db:up
pnpm db:migrate
pnpm db:seed
pnpm staff:add --email dana.support@team.example --name "Dana Support"
```

The demo data holds three projects and three contacts, described in [the data model](data-model.md#demo-data). Bruno Leroy works on the PORTAL project only. Alice Martin works on SHOP and CRM, so the project of her messages is ambiguous. The last command creates the account of a fictitious team member for the web interface, and asks for a password of at least 15 characters.

## 2. Start the services

Use three terminals, from the root of the project:

| Terminal | Command                                    | Ready when                                                             |
| -------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| 1        | `ollama serve`, unless Ollama already runs | `curl http://127.0.0.1:11434/api/version` answers                      |
| 2        | `pnpm dev`                                 | The log shows `Email adapter listening`, and `Slack adapter listening` |
| 3        | `pnpm web`                                 | The log shows `Web interface listening on http://127.0.0.1:4112`       |

Open `http://127.0.0.1:4112` in Chrome or Firefox, and sign in as `dana.support@team.example`.

## 3. Email → Agent → Request

In a fourth terminal, send a fictitious email from Bruno Leroy to the agent, and wait for its answer:

```bash
pnpm demo:email --subject "Mot de passe oublié" \
  --text "Bonjour, sur le portail client, le lien « mot de passe oublié » n'envoie plus aucun email de réinitialisation depuis ce matin."
```

The command only works with a mail server on this machine. It prints the answer of the agent. The model writes it, so its words vary from one run to the next, but it gives the reference of the request:

```
Answer received.
Subject: Re: Mot de passe oublié [REQ-0001]
Votre demande est enregistrée sous la référence REQ-0001 …
```

In the web interface, open the request. Expected, as observed with `ornith:9b`:

- type Bug, priority High, project PORTAL, found from Bruno's only project, source E-mail;
- author Bruno Leroy, of Globex, and a confidence close to 100 %;
- the email received and the answer of the agent under **Messages**;
- `Créée` and `Classée` under **Historique**, with the model, the confidence and the review threshold.

### Asking questions

Reply to the answer of the agent, in the same thread, with any question about the request, such as "Où en êtes-vous ?", "Qui s'en occupe ?" or "Quelles demandes ai-je en cours ?". The agent adds the reply to the request, looks up what the answer needs and answers. A question that the data cannot answer, such as "C'est prévu pour quand ?", or a wish, such as "Pouvez-vous la clôturer ?", is passed to the team: the answer says so, and the request appears under **À revoir** with the reason "Question transmise à l'équipe" and the question in its history.

### Variants

The brief's example of an uncertain project, from Alice Martin:

```bash
pnpm demo:email --from alice.martin@acme.example --subject "Bouton de validation" \
  --text "Depuis la dernière mise à jour, le bouton de validation ne fonctionne plus."
```

The agent does not choose a project: it answers "Ce message concerne-t-il le projet CRM (Acme customer relationship management) ou le projet SHOP (Acme online shop) ?". The request waits for information, and appears under **À revoir** with the reason "Plusieurs projets possibles".

A sender who is not a known contact:

```bash
pnpm demo:email --from nouveau.client@inconnu.example --subject "Facture introuvable" \
  --text "Bonjour, je ne trouve pas ma facture du mois d'octobre dans mon espace client."
```

The message is filed and waits for a review, with the reasons "Projet inconnu" and "Expéditeur non vérifié". The answer says that a person of the team will check it.

## 4. Slack → Agent → Request

The agent only gives rights to a Slack member who is a known contact. For the demonstration, link your Slack member ID to the fictitious contact Alice Martin, and your test channel to the SHOP project:

1. Find your member ID: in Slack, click your name, then **Profile**, the **⋮** button, and **Copy member ID**. It starts with `U`.
2. Find the channel ID: open the channel, click its name at the top, and read **Channel ID** at the bottom of the window. It starts with `C`.
3. Link them, with your two IDs in place of the examples. The command can be run again safely:

   ```bash
   docker compose exec -T postgres psql -U request_agent -d request_agent -v ON_ERROR_STOP=1 \
     -v slack_user=U0123456789 -v slack_channel=C0123456789 <<'SQL'
   UPDATE contacts SET slack_user_id = :'slack_user' WHERE email = 'alice.martin@acme.example';
   INSERT INTO project_channels (project_id, channel, external_id)
     SELECT id, 'SLACK', :'slack_channel' FROM projects WHERE key = 'SHOP'
     ON CONFLICT (channel, external_id) DO NOTHING;
   SQL
   ```

   It prints `UPDATE 1`, then `INSERT 0 1` the first time and `INSERT 0 0` afterwards.

4. In that channel, invite the bot once with `/invite @Request agent`, then send:

   ```
   @Request agent les paiements par carte sont refusés depuis ce matin
   ```

The agent adds 👀 to the message, then answers in its thread with the reference of the request, REQ-…. The channel identifies the SHOP project, although Alice works on two projects. In the web interface, the request shows the source Slack, the project SHOP, the author Alice Martin, the message and the answer.

5. Reply in the thread, with the reference of the answer: `@Request agent où en est la demande REQ-… ?`. The agent adds the message to the request instead of filing a new one, and answers with its status.

## 5. Validate a decision in the web interface

1. Open **À revoir**: Alice's email and the unknown sender's are listed, with their reasons.
2. Open Alice's request, choose the project SHOP under **Valider ou corriger**, and select **Valider la demande**.
3. The request leaves the queue. Its history ends with `Revue faite · Dana Support`, with the change of project.

**Changer le statut** follows a request over time, for instance to `En cours` then `Résolue`, and **Marquer comme doublon** closes a request that repeats another one. Both are recorded with the person who made them.

## Automated version

The same scenarios run without Ollama, Slack or the mail servers in `apps/server/src/scenarios.test.ts`, part of `pnpm test`. They use the real adapters, message handler, tools and database, with a model that plays a script.

## Troubleshooting

| Symptom                                               | Check                                                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm demo:email` prints `No answer after 10 minutes` | `pnpm dev` and Ollama run, and the log of `pnpm dev` shows no error. A computer that went to sleep pauses the agent: the answer comes after it wakes up |
| The agent does not answer in Slack                    | The bot is invited to the channel, the message mentions it, and the log of `pnpm dev` shows `Slack adapter listening`                                   |
| A Slack request waits for a review as unverified      | Your member ID is linked to a contact, step 4.3                                                                                                         |
| The web interface goes back to the sign-in page       | Use Chrome or Firefox: Safari keeps no session cookie over plain HTTP                                                                                   |
| Every email request waits for a review                | `EMAIL_TRUST_LOCAL_SENDERS=true` is set in `.env`, and `pnpm dev` was restarted after the change                                                        |

## Cleaning up

Stop the three commands with Ctrl+C, then stop the containers:

```bash
pnpm db:down
```

The local mail server keeps emails in memory only, so they are gone. The database keeps its data in a Docker volume, for the next demonstration.
