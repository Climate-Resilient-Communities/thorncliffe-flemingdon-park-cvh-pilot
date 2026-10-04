// How the lifecycle tests of S04.03 and S04.04 reach the freeze and the retry now that there is one path to both (S04.05): the attempt table
// and the short transactions of Submit. The lifecycle no longer has a second way in (it had `submitEntry` and `retryTranslation`, which
// skipped the attempt table, the possible-duplicate check and the route refusals): a test that wants to freeze content it made itself
// does what `beginSubmit` would have done (a running attempt of the person, for a key) and then asks `completeSubmit`, the transaction
// that freezes; and a retry is the submitter's own `retranslate`.
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import {
  createSubmitter,
  type AlertActor,
  type AlertLifecycle,
  type AlertResult,
  type ApprovalBinding,
  type EntryContent,
  type EntryPreparer,
  type EntryRef,
  type EntryView,
  type FrozenContent,
} from "../../src/modules/alerting";

export function submitSeams(owner: postgres.Sql, alerting: AlertLifecycle) {
  return {
    /**
     * Freezes `frozen` as the next version of the draft: the attempt `beginSubmit` would have recorded (so a freeze can be tested at the rules of
     * the freeze itself, with content no preparation made), then `completeSubmit`. `expected` is the draft
     * the preparation was made from; the draft as it is now when not given.
     */
    async freeze(actor: AlertActor, ref: EntryRef, frozen: FrozenContent, expected?: EntryContent): Promise<AlertResult<EntryView>> {
      const current = await alerting.getEntry(ref);
      if (!current) throw new Error("freeze: no such entry");
      const key = randomUUID();
      await owner.begin(async (tx) => {
        await tx`select set_config('cvh.actor_id', ${actor.staffId}, true)`;
        await tx`insert into alert_submit_attempt (entry_id, key, kind, actor_id) values (${ref.entryId}, ${key}, 'submit', ${actor.staffId})`;
      });
      return alerting.completeSubmit(actor, ref, key, frozen, expected ?? current.content, null);
    },

    /** "Try translation again" through the submitter, with `preparer` for the translation and a no-op record of operational events. */
    async retranslate(actor: AlertActor, ref: EntryRef, seen: ApprovalBinding, preparer: EntryPreparer): Promise<AlertResult<EntryView>> {
      const submitter = createSubmitter({ lifecycle: alerting, preparer, ops: { record: async () => undefined } });
      const report = await submitter.retranslate(actor, ref, randomUUID(), seen);
      if (report.state === "refused") return { ok: false, error: report.refusal };
      if (report.state === "failed") return { ok: false, error: report.outcome ?? "PREPARATION_FAILED" };
      const entry = await alerting.getEntry(ref);
      if (!entry) throw new Error("retranslate: no such entry");
      return { ok: true, value: entry };
    },
  };
}
