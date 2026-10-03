import type { RecipientCounts } from "../../../contracts/alertApproval";
import type { AlertRefusal } from "../domain/refusals";
import type { RefusalDetail } from "./ports";

/** Found inside a transaction: nothing was written, and the refusal is audited after the rollback (lifecycle.ts's `change`). */
export class Refused extends Error {
  constructor(
    readonly refusal: AlertRefusal,
    readonly detail?: RefusalDetail & { reviewed?: RecipientCounts },
  ) {
    super(refusal);
  }
}
