// The coverage view of a shared space (the prototype's P-04, F5 "what is happening and what is missing"), as a pure rule: every statement and
// standing commitment of the disruption lands in exactly one group. Nobody edits the view; it changes when someone posts, takes something on or
// confirms (P04.assembled).

/** The four groups, in the order the screen shows them: what nobody has first. */
export const COVERAGE_GROUPS = ["gap", "working", "waiting", "covered"] as const;
export type CoverageGroup = (typeof COVERAGE_GROUPS)[number];

export const STATEMENT_KINDS = ["doing", "can_take", "cannot_cover", "need"] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export interface CoverageStatement {
  id: string;
  kind: StatementKind;
  orgId: string;
  /** The organisation that took a need on, or null. */
  claimedBy: string | null;
  /** The statement this one answers (an offer answering a need), or null. */
  answers: string | null;
}

export interface CoverageCommitment {
  id: string;
  orgId: string;
  /** The organisation's answer for this disruption: null until it confirms or declines. */
  forDisruption: "confirmed" | "declined" | null;
}

/** Why an item is in its group, as a code the screen turns into words (P04.state*). */
export type CoverageReason =
  | "doing"
  | "taken"
  | "offered"
  | "offer_standing"
  | "not_taken"
  | "cannot_cover"
  | "commitment_confirmed"
  | "commitment_unconfirmed"
  | "commitment_declined";

export type CoverageItem =
  | { source: "statement"; id: string; group: CoverageGroup; reason: CoverageReason; offeredBy: string | null }
  | { source: "commitment"; id: string; group: CoverageGroup; reason: CoverageReason; offeredBy: null };

/**
 * Sorts a disruption's statements and commitments into the coverage groups:
 *  - "doing" is covered; a standing commitment confirmed for this disruption is covered too;
 *  - a need or a "cannot cover" that an organisation took on is being worked on;
 *  - a need that another organisation offered to answer, an offer standing on its own, and a commitment not yet confirmed are waiting on someone;
 *  - a need or a "cannot cover" nobody took or answered, and a commitment declined for this disruption, are gaps.
 * An offer that answers a need is shown with that need (its `offeredBy`), not as an item of its own.
 */
export function coverageOf(statements: readonly CoverageStatement[], commitments: readonly CoverageCommitment[]): CoverageItem[] {
  const offers = new Map<string, string>();
  for (const statement of statements) if (statement.kind === "can_take" && statement.answers !== null) offers.set(statement.answers, statement.orgId);
  const items: CoverageItem[] = [];
  for (const statement of statements) {
    const base = { source: "statement" as const, id: statement.id, offeredBy: null };
    switch (statement.kind) {
      case "doing":
        items.push({ ...base, group: "covered", reason: "doing" });
        break;
      case "can_take":
        if (statement.answers === null) items.push({ ...base, group: "waiting", reason: "offer_standing" });
        break;
      case "need":
      case "cannot_cover": {
        const offeredBy = offers.get(statement.id) ?? null;
        if (statement.claimedBy !== null) items.push({ ...base, group: "working", reason: "taken", offeredBy });
        else if (offeredBy !== null) items.push({ ...base, group: "waiting", reason: "offered", offeredBy });
        else items.push({ ...base, group: "gap", reason: statement.kind === "need" ? "not_taken" : "cannot_cover" });
        break;
      }
    }
  }
  for (const commitment of commitments) {
    const base = { source: "commitment" as const, id: commitment.id, offeredBy: null };
    if (commitment.forDisruption === "confirmed") items.push({ ...base, group: "covered", reason: "commitment_confirmed" });
    else if (commitment.forDisruption === "declined") items.push({ ...base, group: "gap", reason: "commitment_declined" });
    else items.push({ ...base, group: "waiting", reason: "commitment_unconfirmed" });
  }
  return items;
}

/** How many items each group holds. */
export function coverageCounts(items: readonly Pick<CoverageItem, "group">[]): Record<CoverageGroup, number> {
  const counts: Record<CoverageGroup, number> = { gap: 0, working: 0, waiting: 0, covered: 0 };
  for (const item of items) counts[item.group] += 1;
  return counts;
}
