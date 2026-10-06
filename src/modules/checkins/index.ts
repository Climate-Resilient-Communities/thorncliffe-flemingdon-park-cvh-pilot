// The check-in rounds module's public interface (AD-2). S08.01 gives the Ambassador's home the one question it asks of a round; S08.05 the
// requests (E07's ports `withdrawRequest`, `locationChanging` and `deleteForSubscriber`, the edit page's and YES's request, `joinActiveRounds`),
// the round rows and their tally, and the `ensureRound` an approval calls (S08.06); S08.07 the round page's reads and the marks.
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
