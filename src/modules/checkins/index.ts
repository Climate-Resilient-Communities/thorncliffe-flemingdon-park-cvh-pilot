// The check-in rounds module's public interface (AD-2). S08.01 gives the Ambassador's home the one question it asks of a round; S08.05 the
// requests (E07's ports `withdrawRequest`, `locationChanging` and `deleteForSubscriber`, the edit page's and YES's request, `joinActiveRounds`),
// the round rows and their tally, and the `ensureRound` an approval calls (S08.06); S08.07 the round page's reads and the marks; S08.08 the
// close's tally, the escalations' text, list and handling.
export { NO_OPEN_ROUNDS, type RoundAssignment, type RoundSummary, type RoundSummaryReader } from "./application/roundSummary";
export {
  createCheckinRequests,
  type CheckinRequests,
  type CheckinRequestsDeps,
  type CheckinWithdrawal,
  type RequestEdit,
  type RequestEditDone,
  type RequestPlaces,
} from "./application/requests";
export type { CoversFloor, RequestStore, RoundThread, RoundThreads } from "./application/ports";
// S09.03's access request reads the rows that still name a subscriber (subscriptions' lookup, in its read-only transaction).
export { type SubscriberCheckinRow } from "./adapters/checkinStore";
export { subscriberCheckinRows } from "./application/requests";
export { isRoundThread, lockOrder, placeKept, planRequestChange, roundMatches, type CheckinRequest, type RequestPlace, type SavedPlace, type WantedRequest } from "./domain/requests";
// S08.07: "My round" (A-04) reads the live rows and a mark's place; a mark is one use case, whose escalation S08.08 follows up through its seam.
export { type LiveRoundRow, type NewEscalation } from "./adapters/markStore";
export { liveRoundRows, roundRowPlace } from "./application/round";
export {
  NO_ESCALATION_FOLLOW_UP,
  createMarks,
  type EscalationFollowUp,
  type MarkActor,
  type MarkInput,
  type MarkRefusal,
  type MarkResult,
  type Marks,
  type MarksAudit,
  type MarksDeps,
} from "./application/marks";
export { MARK_IDS_KEPT, STUB_LIFETIME_HOURS, decideMark, type MarkDecision, type MarkTarget } from "./domain/marks";
// S08.08: a thread's close tallies its round (alerting's `closeAlert` calls `closeRound`), an escalation texts the on-duty Admin (the marks' seam), the Hub
// lists the escalations and an Admin marks one handled.
export { type EscalatedRow, type EscalationRow, type RoundClosed } from "./adapters/escalationStore";
export {
  ESCALATIONS_LISTED,
  HANDLED_SHOWN_MS,
  closeRound,
  createEscalationHandling,
  createEscalationTexts,
  escalationList,
  escalationOf,
  subscriberEscalations,
  type EscalationHandling,
  type EscalationHandlingDeps,
  type EscalationPlace,
  type EscalationRecipients,
  type EscalationTextsDeps,
  type HandleOutcome,
} from "./application/escalations";
export {
  HANDLED_NOTE_MAX_CHARS,
  KEPT_ROW_HOURS,
  keptAtClose,
  outcomeAtClose,
  parseHandledNote,
  residentShown,
  type EscalationStatus,
  type HandleRefusal,
} from "./domain/escalations";
