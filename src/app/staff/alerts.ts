// Composition root of the alerting module for the staff surface (AD-2): the alert lifecycle on the app's own
// database connection (cvh_app_login), with the audit trail, identity's view of who is who and places' readers
// that alerting wires itself (src/modules/alerting/index.ts). Server only.
import { createAlerting, type AlertLifecycle } from "@/modules/alerting";
import { getDb } from "@/platform/db";

let service: AlertLifecycle | undefined;

/** The alert thread and entry use cases (S04.03) and the audience pickers (S04.04). */
export function alerting(): AlertLifecycle {
  return (service ??= createAlerting({ db: getDb() }));
}

/** Test seam: forget the composition. */
export function resetAlertsComposition(): void {
  service = undefined;
}
