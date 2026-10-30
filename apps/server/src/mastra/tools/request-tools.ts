import type { ToolsInput } from "@mastra/core/agent";
import { createTool } from "@mastra/core/tools";
import {
  addMessageToRequest,
  type ClassifiedTurn,
  createRequest,
  createRequestInput,
  type Database,
  describeContact,
  describeProject,
  findRequest,
  findRequestInput,
  forwardToTeam,
  forwardToTeamInput,
  getRequestStatus,
  listContactRequests,
  listContactRequestsInput,
  listProjectRequests,
  listProjectRequestsInput,
  requestClarification,
  requestClarificationInput,
  requestReferenceInput,
  searchRequests,
  searchRequestsInput,
  updateRequest,
  updateRequestInput,
} from "@request-agent/core";
import { z } from "zod";

import { explainForModel } from "./explain";

const noInput = z.object({});

type ResultOf<F extends (...args: never[]) => Promise<unknown>> = Awaited<ReturnType<F>>;

// What a tool did, recorded by the tool itself. The answer to the sender and the end of the agent
// run are decided from this record, not from the text of the model.
export type ToolOutcome =
  | { tool: "create_request"; result: ResultOf<typeof createRequest> }
  | {
      tool: "request_clarification";
      question: string;
      result: ResultOf<typeof requestClarification>;
    }
  | { tool: "update_request"; result: ResultOf<typeof updateRequest> }
  | { tool: "find_request"; result: ResultOf<typeof findRequest> }
  | { tool: "list_project_requests"; result: ResultOf<typeof listProjectRequests> }
  | { tool: "get_request_status"; result: ResultOf<typeof getRequestStatus> }
  | { tool: "add_message_to_request"; result: ResultOf<typeof addMessageToRequest> }
  | { tool: "search_requests"; result: ResultOf<typeof searchRequests> }
  | { tool: "list_my_requests"; result: ResultOf<typeof listContactRequests> }
  | {
      tool: "forward_to_team";
      question: string;
      result: ResultOf<typeof forwardToTeam>;
    };

// Builds the tools for one message. The turn is captured here, out of reach of the model and of
// HTTP clients: the tools are never registered on the server, so its API cannot call them.
export function createRequestTools(
  db: Database,
  turn: ClassifiedTurn,
  outcomes: ToolOutcome[],
): ToolsInput {
  const identifyContact = createTool({
    id: "identify_contact",
    description:
      "Tells who sent the message being handled: name, role, organization and projects. " +
      "Returns status 'unverified' when the sender could not be verified.",
    inputSchema: noInput,
    execute: () => describeContact(db, turn),
  });

  const identifyProject = createTool({
    id: "identify_project",
    description:
      "Tells which project the message is about. Returns 'identified' with the project, " +
      "'ambiguous' with the candidate projects, or 'unknown'. Never pick a candidate at random.",
    inputSchema: noInput,
    execute: () => describeProject(db, turn),
  });

  const createRequestTool = createTool({
    id: "create_request",
    description:
      "Files the message being handled as a new request, with the type, texts and priority of " +
      "its classification, under the identified project. No argument is needed. A message is " +
      "filed only once: calling it again returns the existing request with created set to false. " +
      "Returns NOT_A_REQUEST for a message that is clearly not a request.",
    inputSchema: createRequestInput,
    execute: async (input) => {
      const result = await createRequest(db, turn, input);
      outcomes.push({ tool: "create_request", result });
      return explainForModel(result);
    },
  });

  const requestClarificationTool = createTool({
    id: "request_clarification",
    description:
      "Records a question to ask the sender when important information is missing or ambiguous, " +
      "such as which project the message is about. The question is sent to the sender, and the " +
      "request waits for the answer and for a human review.",
    inputSchema: requestClarificationInput,
    execute: async (input) => {
      const result = await requestClarification(db, turn, input);
      outcomes.push({ tool: "request_clarification", question: input.question, result });
      return explainForModel(result);
    },
  });

  const updateRequestTool = createTool({
    id: "update_request",
    description:
      "Changes the type, priority, title, summary, description or project of a request. " +
      "The status can only be changed by a person.",
    inputSchema: updateRequestInput,
    execute: async (input) => {
      const result = await updateRequest(db, turn, input);
      outcomes.push({ tool: "update_request", result });
      return explainForModel(result);
    },
  });

  const findRequestTool = createTool({
    id: "find_request",
    description:
      "Returns a request with its recent history. Without a reference, returns the request of " +
      "the current conversation, which a reply in the same thread usually follows up on.",
    inputSchema: findRequestInput,
    execute: async (input) => {
      const result = await findRequest(db, turn, input);
      outcomes.push({ tool: "find_request", result });
      return explainForModel(result);
    },
  });

  const listProjectRequestsTool = createTool({
    id: "list_project_requests",
    description: "Lists the requests of a project, most recent activity first.",
    inputSchema: listProjectRequestsInput,
    execute: async (input) => {
      const result = await listProjectRequests(db, turn, input);
      outcomes.push({ tool: "list_project_requests", result });
      return explainForModel(result);
    },
  });

  const getRequestStatusTool = createTool({
    id: "get_request_status",
    description: "Returns the status and priority of a request, with its last event.",
    inputSchema: requestReferenceInput,
    execute: async (input) => {
      const result = await getRequestStatus(db, turn, input);
      outcomes.push({ tool: "get_request_status", result });
      return explainForModel(result);
    },
  });

  const addMessageToRequestTool = createTool({
    id: "add_message_to_request",
    description:
      "Files the message being handled under an existing request, such as a follow-up or " +
      "additional information, instead of creating a new request.",
    inputSchema: requestReferenceInput,
    execute: async (input) => {
      const result = await addMessageToRequest(db, turn, input);
      outcomes.push({ tool: "add_message_to_request", result });
      return explainForModel(result);
    },
  });

  const searchRequestsTool = createTool({
    id: "search_requests",
    description:
      "Searches requests by words, best matches first. Use it to find a request the message " +
      "refers to, or an existing request about the same problem before creating a new one.",
    inputSchema: searchRequestsInput,
    execute: async (input) => {
      const result = await searchRequests(db, turn, input);
      outcomes.push({ tool: "search_requests", result });
      return explainForModel(result);
    },
  });

  const listMyRequestsTool = createTool({
    id: "list_my_requests",
    description:
      "Lists the requests the sender made or wrote in, most recent activity first. Use it when " +
      "the sender asks about their own requests.",
    inputSchema: listContactRequestsInput,
    execute: async (input) => {
      const result = await listContactRequests(db, turn, input);
      outcomes.push({ tool: "list_my_requests", result });
      return explainForModel(result);
    },
  });

  const forwardToTeamTool = createTool({
    id: "forward_to_team",
    description:
      "Passes to the team a question or a wish of the sender that the tools cannot answer or " +
      "do: a date, who handles a request, how to use the product, closing or escalating a " +
      "request. The request of the message then waits for a person, who reads the question.",
    inputSchema: forwardToTeamInput,
    execute: async (input) => {
      const result = await forwardToTeam(db, turn, input);
      outcomes.push({ tool: "forward_to_team", question: input.question, result });
      return explainForModel(result);
    },
  });

  // An unverified sender gets no access to existing requests: the agent can only file the message.
  if (turn.actor.kind === "anonymous") {
    return {
      identify_contact: identifyContact,
      identify_project: identifyProject,
      create_request: createRequestTool,
    };
  }
  return {
    identify_contact: identifyContact,
    identify_project: identifyProject,
    create_request: createRequestTool,
    request_clarification: requestClarificationTool,
    update_request: updateRequestTool,
    find_request: findRequestTool,
    list_project_requests: listProjectRequestsTool,
    get_request_status: getRequestStatusTool,
    add_message_to_request: addMessageToRequestTool,
    search_requests: searchRequestsTool,
    list_my_requests: listMyRequestsTool,
    forward_to_team: forwardToTeamTool,
  };
}
