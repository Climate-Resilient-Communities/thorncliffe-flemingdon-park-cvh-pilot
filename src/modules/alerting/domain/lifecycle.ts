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
 * ```
 *
 * `superseded` and `published_system` are statuses E05 reaches (corrections, withdrawals, the expiry
 * job); no transition leads to them yet, so they are final here.
 */

export const ENTRY_KINDS = ["ack", "update", "correction", "withdrawal", "final"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/** The kinds this epic creates; E05 adds the others. */
export const AUTHORED_KINDS = ["ack", "update"] as const satisfies readonly EntryKind[];

export const ENTRY_STATUSES = ["draft", "pending_approval", "approved", "discarded", "superseded", "published_system"] as const;
export type EntryStatus = (typeof ENTRY_STATUSES)[number];

/** Why a pending entry goes back to draft: its author wants to edit it, an approver returns it, or someone re-translates it. */
export const RETURN_REASONS = ["edit", "return", "retranslate"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

/** A return by these reasons changes the entry (a re-translation, an edit), so whoever does it becomes an editor. */
export const EDITING_RETURN_REASONS = ["edit", "retranslate"] as const satisfies readonly ReturnReason[];

export type TransitionAction = "create" | "submit" | "return" | "discard" | "approve";

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

/**
 * The approval rules that need no other lookup (AD-5): the entry is pending; the approver is not
 * the author and never edited it (two-person rule); the approval binds to the version and hash the
 * approver saw, so an edit, return or re-translation since refuses it ("This alert changed.
 * Review it again."); and the valid-until is still in the future. The role, the assurance level and
 * the author's current standing are checked by the use case (the policy, S01.12).
 */
export function checkApproval(facts: ApprovalFacts): ApprovalRefusal | null {
  if (facts.status !== "pending_approval") return "ENTRY_NOT_PENDING";
  if (facts.approverId === facts.authorId || facts.editorIds.includes(facts.approverId)) return "EDITOR_CANNOT_APPROVE";
  if (facts.contentHash === null || facts.shownVersion !== facts.version || facts.shownHash !== facts.contentHash) return "ENTRY_CHANGED";
  if (facts.validUntil.getTime() <= facts.now.getTime()) return "VALID_UNTIL_PAST";
  return null;
}
