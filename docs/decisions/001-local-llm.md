# 001 — Local language model with Ollama

- Status: accepted
- Date: 2026-10-27

## Context

The agent needs a language model that can understand French messages and call tools (create a request, find a request, ask for a clarification, and so on). The development machine has no GPU and 15 GB of RAM. Real Slack messages and emails can contain confidential company data.

## Options considered

| Option                                | Cost                                  | Data stays on the machine | Quality and speed                    |
| ------------------------------------- | ------------------------------------- | ------------------------- | ------------------------------------ |
| Gemini API, free tier                 | Free, quotas not published            | No                        | Good and fast                        |
| Gemini API, paid tier                 | About $0.01 per request (estimate)    | No                        | Good and fast                        |
| Rented GPU server with an open model  | About $0.79 per hour for one L40S GPU | No                        | Good, but the server must be managed |
| **Ollama on the development machine** | **Free**                              | **Yes**                   | Lower, and slow on a CPU             |

The free Gemini tier was rejected because Google's terms state that content sent to it is used to improve their products, can be reviewed by humans, and must not include sensitive or personal information. They also require the paid tier to make an application available to users in the EEA. Paid options were rejected because the project has no budget.

## Model comparison

Three local models were tested on 10 French messages, each with the 8 tools of the future agent. A case passes when the model calls the expected tool with correct arguments.

| Model         | Passed | Ambiguous sender (2 possible projects) | Vague message                        | Average time per message |
| ------------- | ------ | -------------------------------------- | ------------------------------------ | ------------------------ |
| `llama3.2`    | 7/10   | Invents a project                      | Invents a project, invalid tool call | 8 s                      |
| `bonsai-2:9b` | 8/10   | Guesses a project                      | Asks for a clarification             | about 180 s              |
| `ornith:9b`   | 8/10   | Guesses a project                      | Asks for a clarification             | about 85 s               |

Settings: temperature 0, thinking disabled, 8192-token context.

## Decision

The agent uses **`ornith:9b` through Ollama**. It has the best score with `bonsai-2:9b` and is twice as fast. `llama3.2` is faster but was rejected because it invents projects, which would create wrong requests.

The model and the Ollama address are read from environment variables (`OLLAMA_MODEL`, `OLLAMA_BASE_URL`), so another model can be used without changing the code.

## Consequences

- No data leaves the machine and nothing is paid.
- Each answer takes from about 20 s to 90 s on the CPU. This is acceptable for asynchronous channels such as Slack and email.
- No model guessed correctly when a sender works on two projects. The project and the contact will therefore be identified in the code before the model is called, and an ambiguity will lead to a clarification question instead of a guess.
- A hosted model can be evaluated later with fictitious data only, by changing the provider in `apps/server/src/mastra/index.ts`.

## Sources

- [Gemini API Additional Terms of Service](https://ai.google.dev/gemini-api/terms)
- [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [RunPod GPU pricing](https://www.runpod.io/pricing)
- [Ollama provider for the AI SDK (`ollama-ai-provider-v2`)](https://github.com/nordwestt/ollama-ai-provider-v2)
