// The check-in rounds module's public interface (AD-2). S08.01 gives the Ambassador's home the one question it asks of a round; S08.05 the
// requests (E07's ports `withdrawRequest`, `locationChanging` and `deleteForSubscriber`, the edit page's and YES's request, `joinActiveRounds`),
// the round rows and their tally, and the `ensureRound` an approval calls (S08.06).
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
