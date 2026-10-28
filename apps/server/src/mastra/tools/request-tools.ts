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
  getRequestStatus,
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

const noInput = z.object({});

// Builds the tools for one message. The turn is captured here, out of reach of the model and of
// HTTP clients: the tools are never registered on the server, so its API cannot call them.
export function createRequestTools(db: Database, turn: ClassifiedTurn): ToolsInput {
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
    execute: (input) => createRequest(db, turn, input),
  });

  const requestClarificationTool = createTool({
    id: "request_clarification",
    description:
      "Records a question to ask the sender when important information is missing or ambiguous, " +
      "such as which project the message is about. The request waits for the answer and for a " +
      "human review. Ask the same question in your reply.",
    inputSchema: requestClarificationInput,
    execute: (input) => requestClarification(db, turn, input),
  });

  const updateRequestTool = createTool({
    id: "update_request",
    description:
      "Changes the type, priority, title, summary, description or project of a request. " +
      "The status can only be changed by a person.",
    inputSchema: updateRequestInput,
    execute: (input) => updateRequest(db, turn, input),
  });

  const findRequestTool = createTool({
    id: "find_request",
    description:
      "Returns a request with its recent history. Without a reference, returns the request of " +
      "the current conversation, which a reply in the same thread usually follows up on.",
    inputSchema: findRequestInput,
    execute: (input) => findRequest(db, turn, input),
  });

  const listProjectRequestsTool = createTool({
    id: "list_project_requests",
    description: "Lists the requests of a project, most recent activity first.",
    inputSchema: listProjectRequestsInput,
    execute: (input) => listProjectRequests(db, turn, input),
  });

  const getRequestStatusTool = createTool({
    id: "get_request_status",
    description: "Returns the status and priority of a request, with its last event.",
    inputSchema: requestReferenceInput,
    execute: (input) => getRequestStatus(db, turn, input),
  });

  const addMessageToRequestTool = createTool({
    id: "add_message_to_request",
    description:
      "Files the message being handled under an existing request, such as a follow-up or " +
      "additional information, instead of creating a new request.",
    inputSchema: requestReferenceInput,
    execute: (input) => addMessageToRequest(db, turn, input),
  });

  const searchRequestsTool = createTool({
    id: "search_requests",
    description:
      "Searches requests by words, best matches first. Use it to find a request the message " +
      "refers to, or an existing request about the same problem before creating a new one.",
    inputSchema: searchRequestsInput,
    execute: (input) => searchRequests(db, turn, input),
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
  };
}
