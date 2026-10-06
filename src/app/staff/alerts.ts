// Composition root of the alerting module for the staff surface (AD-2): the alert lifecycle on the app's own
// database connection (cvh_app_login), with the audit trail, identity's view of who is who and places' readers
// that alerting wires itself (src/modules/alerting/index.ts), and Submit on top of it (S04.05): the translation of
// this environment (./alertTranslation.ts) and the renderer's public origin (./freezeEntry.ts). Server only.
import { createAlertSubmitter, createAlerting, type AlertLifecycle, type AlertSubmitter } from "@/modules/alerting";
import { englishText } from "@/i18n/text";
import { getEnv } from "@/platform/config/env";
import { getDb } from "@/platform/db";
import { checkinRequests } from "../checkins";
import { textingIsLive } from "../textingLive";
import { alertTranslation } from "./alertTranslation";
import { freezeEntryContent } from "./freezeEntry";

let service: AlertLifecycle | undefined;
let submitter: AlertSubmitter | undefined;

/**
 * The alert thread and entry use cases (S04.03), the audience pickers (S04.04), logging a disruption (S04.05) and the approval (S04.07), whose
 * transaction writes the alert deliveries through messaging's outbox (S06.01); each queued text's cost estimate uses the configured price of a segment.
 * S08.06: the approval of a round type starts or adds to its check-in round through checkins' `ensureRound` (src/app/checkins.ts), in the same transaction.
 */
export function alerting(): AlertLifecycle {
  return (service ??= createAlerting({
    db: getDb(),
    pricePerSegmentCents: () => getEnv().smsPricePerSegmentCents,
    discardWithdrawalText: () => englishText("staff.discard.withdrawnText"),
    // The on-call rule (S06.07): once texting is live, a real alert is approved only with an on-call number on the roster; off until then.
    oncall: { required: () => textingIsLive(getEnv()) },
    checkins: { ensureRound: (tx, thread, requesterIds) => checkinRequests().ensureRound(tx, thread, requesterIds) },
  }));
}

/** Submit and "Try translation again" (S04.05): from the browser's key to a frozen, pending entry, and the entry's state a browser fetches when it did not see the outcome. */
export function alertSubmitter(): AlertSubmitter {
  if (submitter) return submitter;
  const translation = alertTranslation();
  submitter = createAlertSubmitter({
    alerting: alerting(),
    db: getDb(),
    translator: translation.translator,
    translationConfigured: translation.configured,
    freeze: (input) => freezeEntryContent(input),
  });
  return submitter;
}

/** Test seam: forget the composition. */
export function resetAlertsComposition(): void {
  service = undefined;
  submitter = undefined;
}
