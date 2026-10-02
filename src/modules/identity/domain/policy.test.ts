import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_ROLES, type StaffRole } from "../../../contracts/staffRoles";
import { PRIVILEGED_ACTIONS } from "./assurance";
import {
  AUTHORITY_MATRIX,
  POLICY_ACTIONS,
  SELF_SERVICE_ACTIONS,
  can,
  decidePolicy,
  isPolicyAction,
  needsPolicyContext,
  type PolicyContext,
  type PolicyRule,
} from "./policy";

const SPINE = path.join(__dirname, "..", "..", "..", "..", "docs", "architecture", "ARCHITECTURE-SPINE.md");

/** The AD-4 authority table as the spine writes it: each row's first cell and its four role cells. */
function spineMatrix(text: string = readFileSync(SPINE, "utf8")): { row: string; cells: Record<StaffRole, string> }[] {
  const lines = text.split("\n");
  const header = lines.findIndex((line) => /^\| Action \| Ambassador \| Coordinator \| Director \| Admin \|$/.test(line.trim()));
  expect(header, "the AD-4 table's header in the spine").toBeGreaterThan(-1);
  const rows = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.trim().startsWith("|")) break;
    const cells = line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
    expect(cells, `a data row has the action and four role cells: ${line.trim()}`).toHaveLength(5);
    const [row, ambassador, coordinator, director, admin] = cells;
    rows.push({ row, cells: { ambassador, coordinator, director, admin } });
  }
  return rows;
}

/** The rules a spine cell may be encoded as. A bare "yes" is conditional only where the row's own words say so. */
function rulesForCell(row: string, cell: string): PolicyRule[] {
  switch (cell) {
    case "no":
      return ["no"];
    case "yes (read-only)":
      return ["read_only"];
    case "own pending entries only":
      return ["own_pending_entry"];
    case "assigned floors, open alerts":
      return ["assigned_floor_open_alert"];
    case "yes":
      return ["yes", ...(row.includes("of an assigned building") ? (["assigned_building"] as const) : []), ...(row.includes("never an editor") ? (["not_editor"] as const) : [])];
    default:
      throw new Error(`a cell the encoding does not know: "${cell}" in "${row}"`);
  }
}

describe("the spine parser", () => {
  it("fails on a data row with an extra cell, or a missing one", () => {
    const text = readFileSync(SPINE, "utf8");
    const header = text.split("\n").findIndex((line) => /^\| Action \| Ambassador/.test(line.trim()));
    const lines = text.split("\n");
    const firstRow = header + 2;
    expect(() => spineMatrix(text)).not.toThrow();
    expect(() => spineMatrix(lines.map((line, index) => (index === firstRow ? `${line} extra |` : line)).join("\n"))).toThrow(/four role cells/);
    expect(() => spineMatrix(lines.map((line, index) => (index === firstRow ? line.replace(/ [^|]+\|$/, "") : line)).join("\n"))).toThrow(/four role cells/);
  });
});

describe("the encoded matrix", () => {
  it("has the rows of the AD-4 table in the spine, in order, with each cell encoded as the table says", () => {
    const spine = spineMatrix();
    expect(AUTHORITY_MATRIX.map((entry) => entry.row)).toEqual(spine.map((entry) => entry.row));
    for (const [index, { row, cells }] of spine.entries()) {
      for (const role of STAFF_ROLES) {
        expect(rulesForCell(row, cells[role]), `${row} / ${role}`).toContain(AUTHORITY_MATRIX[index].rules[role]);
      }
    }
    // Ambassadors' "yes" in the first row is the row's own condition: an assigned building.
    expect(AUTHORITY_MATRIX[0].rules.ambassador).toBe("assigned_building");
    // Approval's "yes" carries AD-5's condition for everyone who may approve.
    expect(AUTHORITY_MATRIX[3].rules.coordinator).toBe("not_editor");
    expect(AUTHORITY_MATRIX[3].rules.admin).toBe("not_editor");
  });

  it("gives every action one rule: no action sits in two rows", () => {
    const actions = [...AUTHORITY_MATRIX.flatMap((entry) => entry.actions), ...SELF_SERVICE_ACTIONS];
    expect(new Set(actions).size).toBe(actions.length);
    expect([...POLICY_ACTIONS].sort()).toEqual([...actions].sort());
  });

  it("covers every privileged action (S01.10's names are policy actions)", () => {
    for (const action of PRIVILEGED_ACTIONS) expect(isPolicyAction(action), action).toBe(true);
  });
});

const ME = "01900000-0000-7000-8000-000000000001";
const OTHER = "01900000-0000-7000-8000-000000000002";
const ASSIGNED = { rsn: "7001", floorIds: ["floor-3"] };

type Expected = Record<StaffRole, boolean>;
const roles = (ambassador: boolean, coordinator: boolean, director: boolean, admin: boolean): Expected => ({ ambassador, coordinator, director, admin });

/**
 * Every row of the matrix, each of its actions, in the situations that decide it, and what each
 * role gets: written out from the AD-4 table, independently of the encoding above.
 */
const CASES: { actions: readonly string[]; situation: string; context: PolicyContext; expected: Expected }[] = [
  // Author ack, update, final for any floor of an assigned building: yes | yes | no | yes.
  { actions: ["alert.author"], situation: "a floor of an assigned building", context: { assignments: [ASSIGNED], target: { rsn: "7001", floorId: "floor-3" } }, expected: roles(true, true, false, true) },
  { actions: ["alert.author"], situation: "another floor of an assigned building", context: { assignments: [ASSIGNED], target: { rsn: "7001", floorId: "floor-9" } }, expected: roles(true, true, false, true) },
  { actions: ["alert.author"], situation: "a building outside the assignments", context: { assignments: [ASSIGNED], target: { rsn: "7002", floorId: "floor-3" } }, expected: roles(false, true, false, true) },
  { actions: ["alert.author"], situation: "no assignments (before S01.14)", context: { target: { rsn: "7001" } }, expected: roles(false, true, false, true) },
  { actions: ["alert.author"], situation: "no target given", context: { assignments: [ASSIGNED] }, expected: roles(false, true, false, true) },
  { actions: ["alert.author"], situation: "several buildings, all assigned", context: { assignments: [ASSIGNED, { rsn: "7002", floorIds: null }], targets: ["7001", "7002"] }, expected: roles(true, true, false, true) },
  { actions: ["alert.author"], situation: "several buildings, one not assigned", context: { assignments: [ASSIGNED], targets: ["7001", "7002"] }, expected: roles(false, true, false, true) },
  { actions: ["alert.author"], situation: "an empty list of buildings", context: { assignments: [ASSIGNED], targets: [] }, expected: roles(false, true, false, true) },
  { actions: ["alert.author"], situation: "an empty list of buildings beside an assigned target", context: { assignments: [ASSIGNED], targets: [], target: { rsn: "7001" } }, expected: roles(false, true, false, true) },
  { actions: ["alert.author"], situation: "an assigned target with an unassigned one in the list", context: { assignments: [ASSIGNED], targets: ["7002"], target: { rsn: "7001" } }, expected: roles(false, true, false, true) },
  // Author neighbourhood scope, or heat, smoke, winter: no | yes | no | yes.
  { actions: ["alert.author_wide"], situation: "any context", context: { assignments: [ASSIGNED], target: { rsn: "7001" } }, expected: roles(false, true, false, true) },
  // Author correction or withdrawal: own pending entries only | yes | no | yes.
  { actions: ["alert.correct", "alert.withdraw"], situation: "the actor's own pending entry", context: { entry: { authorId: ME, editorIds: [ME], status: "pending_approval" } }, expected: roles(true, true, false, true) },
  { actions: ["alert.correct", "alert.withdraw"], situation: "the actor's own approved entry", context: { entry: { authorId: ME, editorIds: [ME], status: "approved" } }, expected: roles(false, true, false, true) },
  { actions: ["alert.correct", "alert.withdraw"], situation: "someone else's pending entry", context: { entry: { authorId: OTHER, editorIds: [OTHER], status: "pending_approval" } }, expected: roles(false, true, false, true) },
  { actions: ["alert.correct", "alert.withdraw"], situation: "no entry given", context: {}, expected: roles(false, true, false, true) },
  // Approve (never an editor of that entry, AD-5): no | yes | no | yes.
  { actions: ["alert.approve", "alert.send"], situation: "an entry the actor never edited", context: { entry: { authorId: OTHER, editorIds: [OTHER], status: "pending_approval" } }, expected: roles(false, true, false, true) },
  { actions: ["alert.approve", "alert.send"], situation: "an entry the actor edited", context: { entry: { authorId: OTHER, editorIds: [OTHER, ME], status: "pending_approval" } }, expected: roles(false, false, false, false) },
  { actions: ["alert.approve", "alert.send"], situation: "the actor's own entry", context: { entry: { authorId: ME, editorIds: [ME], status: "pending_approval" } }, expected: roles(false, false, false, false) },
  { actions: ["alert.approve", "alert.send"], situation: "no entry given", context: {}, expected: roles(false, false, false, false) },
  // Drills, publish directory, accounts, cap, pause: no | no | no | yes.
  { actions: ["drill.run", "guide.publish", "accounts.manage", "spend.cap", "sending.pause"], situation: "any context", context: { assignments: [ASSIGNED], target: { rsn: "7001" } }, expected: roles(false, false, false, true) },
  // See open check-in rows: assigned floors, open alerts | no | no | yes.
  { actions: ["checkins.view_open"], situation: "an assigned floor of an open alert", context: { assignments: [ASSIGNED], target: { rsn: "7001", floorId: "floor-3" }, alertOpen: true }, expected: roles(true, false, false, true) },
  { actions: ["checkins.view_open"], situation: "a floor of a whole-building assignment, open alert", context: { assignments: [{ rsn: "7001", floorIds: null }], target: { rsn: "7001", floorId: "floor-9" }, alertOpen: true }, expected: roles(true, false, false, true) },
  { actions: ["checkins.view_open"], situation: "an unassigned floor of an assigned building", context: { assignments: [ASSIGNED], target: { rsn: "7001", floorId: "floor-9" }, alertOpen: true }, expected: roles(false, false, false, true) },
  { actions: ["checkins.view_open"], situation: "an assigned floor of a closed alert", context: { assignments: [ASSIGNED], target: { rsn: "7001", floorId: "floor-3" }, alertOpen: false }, expected: roles(false, false, false, true) },
  { actions: ["checkins.view_open"], situation: "another building", context: { assignments: [ASSIGNED], target: { rsn: "7002", floorId: "floor-3" }, alertOpen: true }, expected: roles(false, false, false, true) },
  // See counts and coverage: no | yes | yes (read-only) | yes.
  { actions: ["coverage.view"], situation: "any context", context: {}, expected: roles(false, true, true, true) },
  // See spend: no | no | yes (read-only) | yes.
  { actions: ["spend.view"], situation: "any context", context: {}, expected: roles(false, false, true, true) },
  // Every staff member, for themselves (not matrix rows).
  { actions: ["hub.open", "account.own_setup", "session.read_own"], situation: "any context", context: {}, expected: roles(true, true, true, true) },
  // Anything else is refused.
  { actions: ["alert.delete", "accounts", "", "hub.open.extra", "constructor", "__proto__"], situation: "an unknown action", context: {}, expected: roles(false, false, false, false) },
];

const ROWS = CASES.flatMap(({ actions, situation, context, expected }) =>
  actions.flatMap((action) => STAFF_ROLES.map((role) => [action, role, situation, { ...context, actorId: ME }, expected[role]] as const)),
);

describe("can(role, action, context)", () => {
  it("is decided for every action of every row, for every role", () => {
    const covered = new Set(CASES.flatMap(({ actions }) => actions));
    for (const action of POLICY_ACTIONS) expect(covered.has(action), action).toBe(true);
  });

  it.each(ROWS)("%s as %s, %s", (action, role, _situation, context, expected) => {
    expect(can(role, action, context)).toBe(expected);
  });

  it("refuses an unknown role, and a conditional rule without the actor's id", () => {
    expect(can("visitor" as StaffRole, "hub.open")).toBe(false);
    expect(can("ambassador", "alert.correct", { entry: { authorId: ME, editorIds: [ME], status: "pending_approval" } })).toBe(false);
    expect(can("coordinator", "alert.approve", { entry: { authorId: OTHER, editorIds: [OTHER], status: "pending_approval" } })).toBe(false);
  });
});

describe("decidePolicy and needsPolicyContext", () => {
  it("tells a role that never may (forbidden) from one that may, but not here (out_of_scope)", () => {
    expect(decidePolicy("director", "alert.author", { actorId: ME })).toBe("forbidden");
    expect(decidePolicy("ambassador", "alert.author", { actorId: ME, assignments: [ASSIGNED], target: { rsn: "7002" } })).toBe("out_of_scope");
    expect(decidePolicy("ambassador", "alert.author", { actorId: ME, assignments: [ASSIGNED], target: { rsn: "7001" } })).toBe("allowed");
    expect(decidePolicy("admin", "no.such.action")).toBe("forbidden");
  });

  it("asks for the context only where a role's rule depends on it", () => {
    expect(needsPolicyContext("ambassador", "alert.author")).toBe(true);
    expect(needsPolicyContext("coordinator", "alert.author")).toBe(false);
    expect(needsPolicyContext("director", "alert.author")).toBe(false);
    expect(needsPolicyContext("admin", "alert.approve")).toBe(true);
    expect(needsPolicyContext("director", "spend.view")).toBe(false);
    expect(needsPolicyContext("admin", "no.such.action")).toBe(false);
  });
});
