// The approval view's warning that nobody is on duty for check-ins (S08.08, E08 "On-duty Admin"): an approval of a round type's acknowledgement, update or
// correction starts or adds to a check-in round (S08.06), and its escalations go to the on-duty Admin, or to every on-call number when none is set. Beside the
// pause and cap notices (loadApproval.ts); it only informs, and Approve works as always. Server only.
import { englishText } from "@/i18n/text";
import { isRoundThread } from "@/modules/checkins";
import type { OnDutyState } from "@/modules/ops";
import { roundTypes } from "@/modules/places";
import { getDb } from "@/platform/db";
import { onDutyState } from "../escalations";

export interface OnDutyNoticeDeps {
  /** places' round types now (`disruption_type.checkin`). */
  roundTypes: () => Promise<readonly string[]>;
  /** ops' and identity's answer: whether an escalation has an on-duty Admin to go to. */
  onDuty: () => Promise<OnDutyState>;
}

const live: OnDutyNoticeDeps = { roundTypes: () => roundTypes(getDb()), onDuty: () => onDutyState() };

/** The entry as the notice needs it: its kind, its types, whether its thread is a drill. */
export interface NoticeEntry {
  kind: string;
  types: readonly string[];
  isDrill: boolean;
}

/** The kinds whose approval starts or adds to a round (S08.06): never a withdrawal, a final or a drill. */
const ROUND_KINDS: readonly string[] = ["ack", "update", "correction"];

/**
 * The sentence for an entry whose approval would start or add to a round while nobody is on duty (no on-duty entry, or one whose account is no longer an
 * active Admin with an authenticator); null otherwise. Asked for an entry waiting for approval only (the caller's).
 */
export async function onDutyNoticeFor(entry: NoticeEntry, deps: OnDutyNoticeDeps = live): Promise<string | null> {
  if (entry.isDrill || !ROUND_KINDS.includes(entry.kind)) return null;
  if (!isRoundThread(entry.types, await deps.roundTypes())) return null;
  return (await deps.onDuty()).kind === "set" ? null : englishText("staff.approve.noOnDuty");
}
