export {
  connectDatabase,
  type Database,
  type DatabaseConnection,
  type Transaction,
} from "./db/client.ts";
export * from "./db/schema.ts";
export {
  classificationPromptVersion,
  createOllamaClassifier,
  type Classification,
  type ClassificationInput,
  type Classifier,
} from "./classification/classifier.ts";
export {
  createOllamaDuplicateJudge,
  type DuplicateCandidate,
  type DuplicateJudge,
  type DuplicateJudgement,
} from "./classification/duplicate-judge.ts";
export { requestPriorityDefinitions, requestTypeDefinitions } from "./classification/taxonomy.ts";
export {
  loadAppDatabaseEnv,
  loadClassifierEnv,
  loadDatabaseEnv,
  loadKnowledgeEnv,
  type AppDatabaseEnv,
  type ClassifierEnv,
  type DatabaseEnv,
  type KnowledgeEnv,
} from "./env.ts";
export {
  articleInput,
  knowledgeResultCount,
  saveArticle,
  searchKnowledge,
  type ArticleInput,
  type KnowledgeHit,
} from "./knowledge/articles.ts";
export {
  createOllamaEmbedder,
  type Embedder,
  type OllamaEmbedderOptions,
} from "./knowledge/embedder.ts";
export {
  classifyTurn,
  conversationContext,
  isNotARequest,
  reviewReasons,
  unclassifiedTurn,
  type ClassifiedTurn,
  type PossibleDuplicate,
  type ReviewReason,
} from "./requests/classified-turn.ts";
export {
  addMessageToRequest,
  createRequest,
  fileUnhandledMessage,
  forwardToTeam,
  maxClarifications,
  requestClarification,
  updateRequest,
  type CreatedRequest,
} from "./requests/commands.ts";
export * from "./requests/inputs.ts";
export {
  describeContact,
  describeProject,
  findRequest,
  getRequestStatus,
  isMessageFiled,
  listContactRequests,
  listProjectRequests,
  searchRequests,
  type ContactDescription,
  type HistoryEntry,
  type ProjectDescription,
  type RequestDetails,
  type RequestStatus,
} from "./requests/queries.ts";
export { formatReference, parseReference } from "./requests/reference.ts";
export {
  prepareTurn,
  type Actor,
  type ProjectIdentification,
  type Trust,
  type Turn,
  type TurnInput,
} from "./requests/turn.ts";
export type { RequestView, Result } from "./requests/views.ts";
export { wrapUntrusted } from "./untrusted.ts";
export {
  conversationOfMessage,
  isKnownConversation,
  storeInboundMessage,
  storeOutboundMessage,
  type ChannelMessage,
  type StoredMessage,
} from "./messages/inbox.ts";
export {
  listUnhandledMessages,
  markHandled,
  maxHandlingAttempts,
  recordFailedAttempt,
  type UnhandledMessage,
} from "./messages/handling.ts";
export {
  getMailboxCursor,
  type MailboxCursor,
  saveMailboxCursor,
} from "./messages/mailbox-cursor.ts";
export { assessDuplicate, findDuplicateCandidates } from "./requests/duplicates.ts";
export {
  listReviewQueue,
  markDuplicate,
  markDuplicateInput,
  reviewRequest,
  reviewRequestInput,
  type MarkDuplicateInput,
  type ReviewItem,
  type Reviewer,
  type ReviewRequestInput,
} from "./requests/review.ts";
export {
  changeRequestStatus,
  changeStatusInput,
  consolePageSize,
  getRequestRecord,
  listProjects,
  listRequests,
  listRequestsInput,
  type ChangeStatusInput,
  type ConsoleRequest,
  type ListRequestsInput,
  type RequestRecord,
} from "./requests/console.ts";
export {
  authenticateStaff,
  minPasswordLength,
  saveStaffAccount,
  staffAccountInput,
  type StaffAccountInput,
  type StaffMember,
} from "./staff/accounts.ts";
export { closeSession, findSession, openSession, sessionDurationMs } from "./staff/sessions.ts";
