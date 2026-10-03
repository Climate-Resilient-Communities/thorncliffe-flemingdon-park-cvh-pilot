/**
 * The entry state machine (AD-5, S04.03): the only place that says which status changes of an
 * `alert_entry` exist. The `alert_entry_guard` trigger (db/migrations/20261002250000_alert_lifecycle.sql)
 * mirrors it and rejects any other change, whoever asks; test/db/alertLifecycle.db.test.ts checks
 * every pair of statuses against both.
 *
 * Pure: no I/O, no clock. The use cases (../application/lifecycle.ts) ask here before they write.
 *
 * ```mermaid
 * stateDiagram-v2
 *   [*] --> draft
 *   draft --> pending_approval: submit
 *   pending_approval --> draft: return (edit, return, retranslate; only if not web-published)
 *   draft --> discarded: discard
 *   pending_approval --> discarded: discard (only if not web-published)
 *   pending_approval --> approved: approve
 *   approved --> superseded: a correction or a withdrawal that names it is approved (S05.02)
 *   pending_approval --> superseded: the same, for a web-published pending entry (S05.02)
 * ```
 *
 * `published_system` is a status E05's expiry job reaches (a system `final`); no transition leads to it yet, so it is final
 * here. `superseded` is final: nothing leaves it.
 */

export const ENTRY_KINDS = ["ack", "update", "correction", "withdrawal", "final"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** The kinds a person starts a thread or an update with; a correction or a withdrawal names a target (S05.02), a final closes (S05.03). */
export const AUTHORED_KINDS = ["ack", "update"] as const satisfies readonly EntryKind[];

export const ENTRY_STATUSES = ["draft", "pending_approval", "approved", "discarded", "superseded", "published_system"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** Why a pending entry goes back to draft: its author wants to edit it, an approver returns it, or someone re-translates it. */
export const RETURN_REASONS = ["edit", "return", "retranslate"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/** A return by these reasons changes the entry (a re-translation, an edit), so whoever does it becomes an editor. */
export const EDITING_RETURN_REASONS = ["edit", "retranslate"] as const satisfies readonly ReturnReason[];

export type TransitionAction = "create" | "submit" | "return" | "discard" | "approve" | "supersede";

export interface TransitionRule {
  /** null is the start: `[*] → draft`. */
  from: EntryStatus | null;
  to: EntryStatus;
  action: TransitionAction;
}

/** Every transition that exists in this epic. Anything not listed is refused here and by the trigger. */
export const ENTRY_TRANSITIONS: readonly TransitionRule[] = [
  { from: null, to: "draft", action: "create" },
  { from: "draft", to: "pending_approval", action: "submit" },
  { from: "pending_approval", to: "draft", action: "return" },
  { from: "draft", to: "discarded", action: "discard" },
  { from: "pending_approval", to: "discarded", action: "discard" },
  { from: "pending_approval", to: "approved", action: "approve" },
  { from: "approved", to: "superseded", action: "supersede" },
  { from: "pending_approval", to: "superseded", action: "supersede" },
];

/** Why a transition is refused. The codes are the use cases' refusal codes too (./refusals.ts). */
export type TransitionRefusal = "ILLEGAL_TRANSITION" | "ALERT_CLOSED" | "WEB_PUBLISHED";

export interface TransitionRequest {
  from: EntryStatus | null;
  to: EntryStatus;
  /** `web_published_at` is set: residents may have seen it (AD-5). */
  webPublished: boolean;
  /** The thread is still `open`. */
  threadOpen: boolean;
  /** The thread is being closed and this discard is part of it (E05's close path); the only change a closed thread allows. */
  closing?: boolean;
}

export type TransitionDecision = { ok: true; action: TransitionAction } | { ok: false; refusal: TransitionRefusal };

/**
 * Decides one status change. In order: the transition must exist; a closed thread allows only the
 * discard its closing makes (`ALERT_CLOSED`); a web-published entry never returns to draft and is
 * not discarded (`WEB_PUBLISHED`: changing it takes a correction, E05).
 */
export function requestTransition(request: TransitionRequest): TransitionDecision {
  const rule = ENTRY_TRANSITIONS.find((candidate) => candidate.from === request.from && candidate.to === request.to);
  if (!rule) return { ok: false, refusal: "ILLEGAL_TRANSITION" };
  if (!request.threadOpen && !(request.closing === true && rule.action === "discard")) return { ok: false, refusal: "ALERT_CLOSED" };
  if (request.webPublished && (rule.action === "return" || rule.action === "discard")) return { ok: false, refusal: "WEB_PUBLISHED" };
  return { ok: true, action: rule.action };
}

/** Whether any transition leaves the status (nothing changes a final entry). */
export function isFinal(status: EntryStatus): boolean {
  return !ENTRY_TRANSITIONS.some((rule) => rule.from === status);
}

// --- Approval --------------------------------------------------------------------------------

/** What the approval rules need, all judged by the use case from the database under the thread's lock. */
export interface ApprovalFacts {
  approverId: string;
  authorId: string;
  /** The author and every account that changed the entry. */
  editorIds: readonly string[];
  status: EntryStatus;
  version: number;
  /** The entry's content hash now; null when it holds none (a draft). */
  contentHash: string | null;
  /** The version and hash the approver was shown. */
  shownVersion: number;
  shownHash: string;
  validUntil: Date;
  now: Date;
}

export type ApprovalRefusal = "ENTRY_NOT_PENDING" | "EDITOR_CANNOT_APPROVE" | "ENTRY_CHANGED" | "VALID_UNTIL_PAST";

/** What an approver's action on an entry they were shown (approve, return, discard) is judged on: the entry now, and the version and hash they saw. */
export interface ShownBindingFacts {
  status: EntryStatus;
  version: number;
  /** The entry's content hash now; null when it holds none (a draft). */
  contentHash: string | null;
  shownVersion: number;
  shownHash: string;
}

/**
 * Whether the entry is still the one the approver was shown. An entry that went back to a draft since the view (its author pulled it back, or
 * an approver returned it) is a changed entry ("This alert changed. Review it again."), as is one with another version or hash (it was pulled
 * back, edited and submitted again, or re-translated). One that was approved or discarded since is not waiting any more (`ENTRY_NOT_PENDING`:
 * another approver was first). Null when it is still the pending entry that was shown.
 */
export function checkShownBinding(facts: ShownBindingFacts): "ENTRY_NOT_PENDING" | "ENTRY_CHANGED" | null {
  if (facts.status !== "pending_approval" && facts.status !== "draft") return "ENTRY_NOT_PENDING";
  if (facts.status === "draft" || facts.contentHash === null) return "ENTRY_CHANGED";
  return facts.shownVersion !== facts.version || facts.shownHash !== facts.contentHash ? "ENTRY_CHANGED" : null;
}

/**
 * The approval rules that need no other lookup (AD-5): the entry was not approved or discarded since (`ENTRY_NOT_PENDING`); the approver
 * is not the author and never edited it (two-person rule); the approval binds to the version and hash the approver saw, so an edit,
 * return or re-translation since refuses it ("This alert changed. Review it again.", `checkShownBinding`); and the valid-until is still
 * in the future. The role, the assurance level and the author's current standing are checked by the use case (the policy, S01.12).
 */
export function checkApproval(facts: ApprovalFacts): ApprovalRefusal | null {
  const shown = checkShownBinding(facts);
  if (shown === "ENTRY_NOT_PENDING") return shown;
  if (facts.approverId === facts.authorId || facts.editorIds.includes(facts.approverId)) return "EDITOR_CANNOT_APPROVE";
  if (shown) return shown;
  if (facts.validUntil.getTime() <= facts.now.getTime()) return "VALID_UNTIL_PAST";
  return null;
}
