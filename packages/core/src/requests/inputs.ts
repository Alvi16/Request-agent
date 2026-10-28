import { z } from "zod";

import { requestPriority, requestStatus, requestType } from "../db/schema.ts";

// Inputs of the request operations, shared by every caller: agent tools, and later the web
// interface. Text sizes are bounded so a message cannot make the agent store or send huge values.
const reference = z
  .string()
  .regex(/^REQ-\d{1,9}$/i)
  .describe("Request reference, such as REQ-0042");
const projectKey = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/)
  .describe("Project key, such as SHOP");
const type = z.enum(requestType.enumValues);
const priority = z.enum(requestPriority.enumValues);
const title = z.string().trim().min(1).max(200);
const summary = z.string().trim().max(1000);
const description = z.string().trim().max(10_000);
const limit = z.int().min(1).max(20).default(10);

// The type, texts and confidence of a new request come from the classification of the message,
// computed before the agent runs. The agent only chooses the project when it was not identified.
export const createRequestInput = z.object({
  projectKey: projectKey
    .optional()
    .describe("Project key. Leave it out to use the project identified for the message"),
});

export const requestClarificationInput = z.object({
  question: z.string().trim().min(1).max(500).describe("The question to ask the sender"),
});

export const updateRequestInput = z.object({
  reference,
  changes: z.object({
    type: type.optional(),
    priority: priority.optional(),
    title: title.optional(),
    summary: summary.optional(),
    description: description.optional(),
    projectKey: projectKey.optional(),
  }),
});

export const requestReferenceInput = z.object({ reference });

export const findRequestInput = z.object({
  reference: reference
    .optional()
    .describe("Request reference. Leave it out to find the request of the current conversation"),
});

export const listProjectRequestsInput = z.object({
  projectKey,
  status: z.enum(requestStatus.enumValues).optional(),
  limit,
});

export const searchRequestsInput = z.object({
  query: z.string().trim().min(2).max(200),
  projectKey: projectKey.optional(),
  limit,
});

export type CreateRequestInput = z.infer<typeof createRequestInput>;
export type RequestClarificationInput = z.infer<typeof requestClarificationInput>;
export type UpdateRequestInput = z.infer<typeof updateRequestInput>;
export type RequestReferenceInput = z.infer<typeof requestReferenceInput>;
export type FindRequestInput = z.infer<typeof findRequestInput>;
export type ListProjectRequestsInput = z.infer<typeof listProjectRequestsInput>;
export type SearchRequestsInput = z.infer<typeof searchRequestsInput>;
