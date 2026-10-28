import type { requestPriority, requestType } from "../db/schema.ts";

type RequestType = (typeof requestType.enumValues)[number];
type RequestPriority = (typeof requestPriority.enumValues)[number];

// What each type means. The same text is given to the model and shown in the documentation, so
// people and the model classify with the same rules.
export const requestTypeDefinitions: Record<RequestType, string> = {
  BUG: "Something does not work as it should: an error, a crash, wrong data, or a behavior that differs from what was delivered. The sender reports a defect.",
  FEATURE_REQUEST:
    "Asks for a capability the product does not offer at all yet, such as a new module, screen, integration, channel or kind of data.",
  CHANGE_REQUEST:
    "Asks to modify or replace something already decided or delivered: a business rule, a text, a value, a design, the scope or the schedule.",
  EVOLUTION:
    "Asks to improve a feature that already exists and works: add an option, a field, a filter, a sort or a column to it, show more, or make it faster or easier to use. Nothing is broken.",
  SUPPORT:
    "Asks for help to use, configure or access the product, or asks a question about how it works. No defect is reported.",
  FOLLOW_UP:
    "Refers to a problem or request already reported, for example with words such as again, still, as reported or regarding my request, to add information, insist or say the problem is still there, even if it also asks where things stand.",
  STATUS_REQUEST:
    "Only asks for the status or progress of a request already made, without adding anything else.",
  OTHER: "Anything else: thanks, greetings, meeting logistics, unrelated or unsolicited messages.",
};

export const requestPriorityDefinitions: Record<RequestPriority, string> = {
  CRITICAL:
    "The product is down, data is lost or exposed, or users cannot work at all, with no workaround.",
  HIGH: "An important feature is broken for many users, or a deadline is at risk, or the workaround is costly.",
  MEDIUM: "A limited problem with a workaround, or a normal request without urgency.",
  LOW: "A cosmetic issue, a minor improvement or an idea, with no impact on the work.",
};
