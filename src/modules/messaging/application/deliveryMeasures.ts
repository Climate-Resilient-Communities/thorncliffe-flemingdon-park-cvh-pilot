// The pilot's delivery measures as use cases (S06.08, FR-M2, FR-M4): they read the outbox's rows for an entry and apply the rules of
// domain/deliveryMeasures.ts. Read-only, and they hold no phone number: a row's recipient is an id, never a number.
import type { DbExecutor } from "../../../platform/db";
import { correctionReach, entryTimings, type CorrectionReach, type EntryTimings, type MeasuredRow, type ReachRow } from "../domain/deliveryMeasures";

/** The outbox's rows as the measures read them. */
export interface MeasureStore {
  /** Every row of an entry (its state, language, recipient kind and the instants the dispatcher and the callbacks stamped). */
  entryRows(executor: DbExecutor, entryId: string): Promise<MeasuredRow[]>;
  /** Every row of the given entries, with the recipient each is for. */
  reachRows(executor: DbExecutor, entryIds: readonly string[]): Promise<ReachRow[]>;
}

export interface DeliveryMeasures {
  /**
   * Time to deliver, per language: from the entry's approval (`approvedAt`, the entry's `approved_at`, which alerting owns) to the first
   * hand-off and to the moment delivered rows reach 90% of the rows handed off, or "not reached" with the final delivered share.
   */
  entryTimings(executor: DbExecutor, input: { entryId: string; approvedAt: Date }): Promise<EntryTimings>;
  /** How far a correction reached: attempted and confirmed reach against the recipients of the entry it corrects. */
  correctionReach(executor: DbExecutor, input: { originalEntryId: string; correctionEntryId: string }): Promise<CorrectionReach>;
}

export function createDeliveryMeasures(deps: { store: MeasureStore }): DeliveryMeasures {
  return {
    async entryTimings(executor, { entryId, approvedAt }) {
      return entryTimings(await deps.store.entryRows(executor, entryId), approvedAt);
    },
    async correctionReach(executor, { originalEntryId, correctionEntryId }) {
      return correctionReach(await deps.store.reachRows(executor, [originalEntryId, correctionEntryId]), originalEntryId, correctionEntryId);
    },
  };
}
