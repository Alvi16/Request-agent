# 004 — Classification and its confidence

- Status: accepted
- Date: 2026-10-28

## Context

The brief asks that the agent does not invent information when it is not certain: it must produce a confidence level, ask for a clarification or send the request to a human review. This requires a confidence that tells right answers from wrong ones. The model is `ornith:9b`, run locally on a CPU ([decision 001](001-local-llm.md)).

## How the confidence is measured

| Option                                                                            | Assessment                                                                                                                                                                  |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confidence written by the model in its answer                                     | **Rejected.** Studies find it overconfident (Xiong et al., 2024). Measured on our 40 working messages: only 3 different values, and an AUROC of 0.61, close to chance (0.5) |
| Agreement between several answers to the same message                             | Several times the cost of one classification, on a CPU where one already takes from 20 s to 60 s                                                                            |
| **Probability of the tokens of the chosen type, returned by Ollama (`logprobs`)** | **Chosen.** Measured on the same messages: 20 different values and an AUROC of 0.95. No extra call                                                                          |

Studies agree that no confidence measure is reliable on every task without being measured on it, so the choice comes from our own measurements, kept as a command: `pnpm eval:classification`.

## How the classification is run

| Option                                                                                | Assessment                                                                                                                                               |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The agent classifies while it calls the tools, and gives the type to `create_request` | The type and confidence would be chosen by the model, which a message can influence, and no token probability is available                               |
| **A separate classification call before the agent, with an imposed JSON schema**      | **Chosen.** The code keeps the type and the confidence, and the agent cannot change them. The agent still decides which tools to call, as the brief asks |

The Mastra provider for Ollama does not return token probabilities, and patching its requests would be fragile. The classifier therefore calls the documented Ollama API (`/api/chat`, with `format`, `logprobs` and `think: false`) directly, and validates the answer with zod. No dependency is added. The agent itself stays on Mastra.

The classifier only writes a title and a summary. A full description made its answers several times longer, and on a CPU each generated word costs time, for a text that mostly repeated the message. The description of a request is therefore the message itself, which is also more faithful.

## Review threshold

A request waits for a person when its confidence is below 0.8, when its project is ambiguous or unknown, or when its sender is unverified. The threshold can be changed with `CLASSIFICATION_REVIEW_THRESHOLD`.

Measured with `pnpm eval:classification` on two sets of 40 fictitious messages. The working set was used to adjust the type definitions. The control set was written before any adjustment and measured once, with the final instructions:

| Set     | Right type | Confidence AUROC | Handled without review | Right among them | Mistakes sent to review |
| ------- | ---------- | ---------------- | ---------------------- | ---------------- | ----------------------- |
| Working | 83 %       | 0.95             | 31 of 40               | 30 of 31         | 6 of 7                  |
| Control | 83 %       | 0.83             | 29 of 40               | 28 of 29         | 6 of 7                  |

With 0.8, about three quarters of the messages are handled without a person, and these are right in 97 % of the cases, against 83 % without the threshold. A higher threshold would send more right answers to review, a lower one would let more mistakes through. The only mistake let through on the control set is a follow-up classified as a bug with a confidence of 1.00: in the agent, the earlier messages of the conversation are given to the classifier to reduce this case.

## Consequences

- Each message costs one classification call and the agent's calls. Thinking mode is turned off for both.
- Mistakes between close types, mostly `EVOLUTION` and `FEATURE_REQUEST`, usually have a low confidence and go to review instead of being filed silently.
- The evaluation sets must be extended with real, anonymized messages before the threshold is trusted in production.

## Sources

- Xiong et al., [Can LLMs Express Their Uncertainty? An Empirical Evaluation of Confidence Elicitation in LLMs](https://arxiv.org/abs/2306.13063), ICLR 2024
- [Ollama chat API: `format`, `logprobs`, `think`](https://docs.ollama.com/api/chat)
- [Mastra `Agent.generate()` options: `system`, `providerOptions`, `toolsets`, `maxSteps`](https://mastra.ai/reference/agents/generate)
