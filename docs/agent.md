# How the agent handles a message

This page describes what happens to a message received by the agent, how it is classified, when a person must check the result, and how the classification is measured. The security rules of the tools are described in [decision 003](decisions/003-agent-tools-security.md), and the choice of the confidence measure in [decision 004](decisions/004-classification-confidence.md).

## Steps

1. **The channel adapter stores the message**, with its conversation, and tells whether the channel verified its sender.
2. **The code identifies the sender and the project**, with fixed rules: a channel dedicated to a project, then a project key written in the message, then the only project of the sender. When several projects remain possible, the project is ambiguous.
3. **The classifier reads the message** and the last 4 messages of its conversation. In one call to the model, without tools, it gives the type, the priority, a title and a one-sentence summary. Its confidence is read from the probabilities of the tokens of the type, not written by the model. If this step fails, nothing is written.
4. **The agent decides what to do.** It receives the facts computed by the code (sender, project, classification, request already linked to the conversation) and calls the tools: file the message, add it to an existing request, give a status or ask a question. It stops as soon as the message is filed, added to a request or answered by a question.
5. **The code makes sure no message is lost.** If the agent ends without filing or answering the message, and the message is not clearly `OTHER`, the code files it for a review, with the reason `UNHANDLED`.
6. **The code writes the answer to the sender** from what the tools did: the reference of the request, the message added to a request, the status, the clarification question or the requests found. The text written by the model is never sent: a small local model mixes its reasoning with its answer, and can promise actions that nobody performed. No answer is sent for a message that is clearly `OTHER`, such as thanks, which also avoids loops of automatic replies by email.

The agent makes at most 5 calls to the model per message. Thinking mode is turned off, because it more than triples the answer time on a CPU. Answers are written in French.

## Request types

| Type              | Meaning                                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BUG`             | Something does not work as it should: an error, a crash, wrong data, or a behavior that differs from what was delivered. The sender reports a defect.                                                                                     |
| `FEATURE_REQUEST` | Asks for a capability the product does not offer at all yet, such as a new module, screen, integration, channel or kind of data.                                                                                                          |
| `CHANGE_REQUEST`  | Asks to modify or replace something already decided or delivered: a business rule, a text, a value, a design, the scope or the schedule.                                                                                                  |
| `EVOLUTION`       | Asks to improve a feature that already exists and works: add an option, a field, a filter, a sort or a column to it, show more, or make it faster or easier to use. Nothing is broken.                                                    |
| `SUPPORT`         | Asks for help to use, configure or access the product, or asks a question about how it works. No defect is reported.                                                                                                                      |
| `FOLLOW_UP`       | Refers to a problem or request already reported, for example with words such as again, still, as reported or regarding my request, to add information, insist or say the problem is still there, even if it also asks where things stand. |
| `STATUS_REQUEST`  | Only asks for the status or progress of a request already made, without adding anything else.                                                                                                                                             |
| `OTHER`           | Anything else: thanks, greetings, meeting logistics, unrelated or unsolicited messages.                                                                                                                                                   |

The model receives these definitions word for word. They are defined once, in [`packages/core/src/classification/taxonomy.ts`](../packages/core/src/classification/taxonomy.ts).

## Priorities

| Priority   | Meaning                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `CRITICAL` | The product is down, data is lost or exposed, or users cannot work at all, with no workaround.        |
| `HIGH`     | An important feature is broken for many users, or a deadline is at risk, or the workaround is costly. |
| `MEDIUM`   | A limited problem with a workaround, or a normal request without urgency.                             |
| `LOW`      | A cosmetic issue, a minor improvement or an idea, with no impact on the work.                         |

The priority stays empty when the message does not tell enough to estimate it.

## Human review

A new request waits for a person (`needs_review`) when at least one of these is true:

| Reason              | When                                                                        |
| ------------------- | --------------------------------------------------------------------------- |
| `LOW_CONFIDENCE`    | The confidence of the classification is below the threshold, 0.8 by default |
| `PROJECT_AMBIGUOUS` | Several projects are possible                                               |
| `PROJECT_UNKNOWN`   | No project could be identified                                              |
| `UNVERIFIED_SENDER` | The channel could not verify who sent the message                           |

The threshold is set with `CLASSIFICATION_REVIEW_THRESHOLD`, between 0 and 1. The code decides the review, never the model.

A message classified `OTHER` with a confidence above the threshold, such as thanks or an advertisement, is not filed as a request, and the agent is not run, which saves its calls. The message stays stored with its conversation. Below the threshold, it is filed for a person to check.

## What the agent does

| Classification                   | Action                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FOLLOW_UP` or `STATUS_REQUEST`  | Finds the request it is about: the one linked to the conversation, a reference written in the message, then a search. Adds the message to it, and gives the status for a status request |
| Another type, project identified | Files the message as a new request                                                                                                                                                      |
| Another type, project not clear  | `create_request` refuses to guess (`PROJECT_AMBIGUOUS`), and the agent asks the sender which project, with `request_clarification`                                                      |
| `OTHER`, confident               | Nothing: the agent is not run, nothing is filed and no answer is sent                                                                                                                   |
| Unverified sender                | Only files the message, which waits for a review                                                                                                                                        |

When `create_request` files a message, the type, priority, title and summary come from the classification, and the description is the message itself. The agent cannot change them: it only chooses the project when none was identified.

## Clarification requests

`request_clarification` records the question in the history of the request (`CLARIFICATION_REQUESTED`), sets its status to `WAITING_FOR_INFO` and sends it to review. The question is the answer sent to the sender.

When the requester answers in the same conversation, the agent adds the answer to the request, and the status goes back to `NEW`. If the answer names a project the requester may use, such as "c'est le SHOP", a request filed without a project gets it, and the change is recorded in its history. Only an answer from the requester does that. The agent asks at most 2 questions per request: after that, the request is left to a person.

## Decision history

Each new request gets a `CLASSIFIED` event that records how the decision was made:

```json
{
  "type": "BUG",
  "priority": "HIGH",
  "confidence": 0.93,
  "threshold": 0.8,
  "reviewReasons": [],
  "model": "ornith:9b",
  "promptVersion": "e5beee2e39b3"
}
```

`promptVersion` identifies the instructions given to the classifier, so decisions made with different instructions can be told apart.

## Measuring the classifier

Two sets of fictitious French messages, labeled with their expected type, are in [`packages/core/eval/`](../packages/core/eval/):

- `classification-dev.json`, 40 messages, used to write and adjust the definitions;
- `classification-holdout.json`, 40 other messages, written before any adjustment and never used to change anything. They give the expected quality on new messages.

The command runs the real classifier on both sets. It needs Ollama, and takes about 30 to 60 minutes on a CPU:

```bash
pnpm eval:classification            # both sets
pnpm eval:classification holdout    # one set
```

It reports the share of right types, how well the confidence separates right from wrong answers (AUROC: 0.5 is chance, 1 is perfect), and what the threshold lets through.

Latest results, with `ornith:9b` and a threshold of 0.8:

| Set                        | Right type | Confidence AUROC | Handled without review | Right among them | Mistakes sent to review |
| -------------------------- | ---------- | ---------------- | ---------------------- | ---------------- | ----------------------- |
| Working messages (dev)     | 83 %       | 0.95             | 31 of 40               | 30 of 31         | 6 of 7                  |
| Control messages (holdout) | 83 %       | 0.83             | 29 of 40               | 28 of 29         | 6 of 7                  |

Most mistakes are follow-ups taken for new requests: without the earlier messages of the conversation, "still broken this morning" reads like a new bug. In the agent, the classifier sees the earlier messages of the conversation, which the evaluation messages mostly lack. A classification takes about 1 minute per message on the development machine (median 58 s, measured while another model was running on the same CPU; about 20 s without it).

## Limits

- The evaluation messages are fictitious and few: 80 in all. The threshold is a starting point, to check again with real messages.
- The boundary between `EVOLUTION` and `FEATURE_REQUEST` is the most frequent mistake. These mistakes usually have a low confidence, so they go to review.
- A message classified without its conversation can look like a new request when it is a follow-up: the conversation context reduces this, but only when the earlier messages were received by the agent.
