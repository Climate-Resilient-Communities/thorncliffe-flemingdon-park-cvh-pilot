// Composition root of the alerting module for the staff surface (AD-2): the alert lifecycle on the app's own
// database connection (cvh_app_login), with the audit trail, identity's view of who is who and places' readers
// that alerting wires itself (src/modules/alerting/index.ts), and Submit on top of it (S04.05): the translation of
// this environment (./alertTranslation.ts) and the renderer's public origin (./freezeEntry.ts). Server only.
import { createAlertSubmitter, createAlerting, type AlertLifecycle, type AlertSubmitter } from "@/modules/alerting";
import { getDb } from "@/platform/db";
import { alertTranslation } from "./alertTranslation";
import { freezeEntryContent } from "./freezeEntry";

let service: AlertLifecycle | undefined;
let submitter: AlertSubmitter | undefined;

/** The alert thread and entry use cases (S04.03), the audience pickers (S04.04) and logging a disruption (S04.05). */
export function alerting(): AlertLifecycle {
  return (service ??= createAlerting({ db: getDb() }));
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
