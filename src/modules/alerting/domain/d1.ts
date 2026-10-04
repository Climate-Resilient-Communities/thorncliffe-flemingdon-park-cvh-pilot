// D-1: which entries appear on the web at submit, as "Not yet verified", before anyone has approved them (S08.03, AD-5 "Web publication" and "D-1
// eligibility", FR-A15). `isD1Eligible` is the ONLY place that decides it; the use case asks here, and the entry trigger
// (db/migrations/20261005210000_d1_web_first.sql) refuses a publication at submit that does not meet the same facts, so a use case that forgot the rule is
// still refused. Pure: no I/O, no clock.
//
// An entry is D-1 when ALL of these hold:
//   - its author's role is Ambassador;
//   - its thread is not a drill (a drill is never shown to residents);
//   - its kind is `ack`, `update` or `correction` (never a withdrawal or a final: a final closes a thread, a withdrawal takes something back, and both wait
//     for a second person);
//   - it has at least one type, and every type has `disruption_type.direct = true` (power, water, elevator, flood). `false` (fire alarm or evacuation, "Other")
//     and null (not decided: heat, smoke, winter storm) both count as not direct, and so does a type the table does not know.
// What D-1 changes is the web only: its texts are still made at approval, by a second person.
import type { StaffRole } from "../../../contracts/staffRoles";
import type { EntryKind } from "./lifecycle";

/** The kinds that can be D-1: the entries that say what is going on (a final and a withdrawal never are). */
export const D1_KINDS = ["ack", "update", "correction"] as const satisfies readonly EntryKind[];

/** What `disruption_type.direct` says of each type: true, false, or null (not decided). A type missing from the map is not known. */
export type DirectTypes = ReadonlyMap<string, boolean | null> | Readonly<Record<string, boolean | null | undefined>>;

export interface D1Facts {
  /** The role of the entry's author. */
  authorRole: StaffRole;
  /** The thread is a drill. */
  isDrill: boolean;
  kind: EntryKind;
  /** `entry.types`. */
  types: readonly string[];
  /** `disruption_type.direct` of the types (at least those of `types`). */
  direct: DirectTypes;
}

const directOf = (direct: DirectTypes, type: string): boolean | null | undefined =>
  direct instanceof Map ? direct.get(type) : (direct as Readonly<Record<string, boolean | null | undefined>>)[type];

/** Whether the entry is web-published at submit as "Not yet verified" (AD-5 "D-1 eligibility"). Anything that is not exactly `true` for a type is not direct. */
export function isD1Eligible(facts: D1Facts): boolean {
  if (facts.authorRole !== "ambassador" || facts.isDrill) return false;
  if (!(D1_KINDS as readonly string[]).includes(facts.kind)) return false;
  return facts.types.length > 0 && facts.types.every((type) => directOf(facts.direct, type) === true);
}
