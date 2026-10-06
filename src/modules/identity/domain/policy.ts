import type { StaffRole } from "../../../contracts/staffRoles";
import { STAFF_ROLES } from "../../../contracts/staffRoles";

/**
 * The role policy (AD-4, S01.12): one table-driven function, `can(role, action, context)`, decides
 * what each role may do. Every staff route handler, server action and page names one of the
 * actions below and the staff guard (src/app/staff/guard.ts) asks `can` before the route's own
 * code; the use cases ask again inside their transaction ("at submit and again at approve, against
 * the author's current status and assignments").
 *
 * The matrix is data: AUTHORITY_MATRIX holds the rows of the AD-4 table in
 * docs/architecture/ARCHITECTURE-SPINE.md, each with the policy actions it covers and one rule per
 * role. policy.test.ts checks the rows against the table in the spine and every row × role.
 */

/**
 * How one cell of the matrix decides:
 *  - `yes` / `no`: whatever the context;
 *  - `assigned_building`: the target building is one of the Ambassador's assignments (any floor of it);
 *  - `own_pending_entry`: the entry is the actor's own and still pending approval;
 *  - `not_editor`: the actor never edited the entry (AD-5: no self-approval through editing);
 *  - `assigned_floor_open_alert`: the target floor is covered by the actor's assignments and its alert is open;
 *  - `assigned_floor`: the target floor is covered by the actor's assignments (S08.07: a mark, which a closed stub still takes for 2 hours);
 *  - `read_only`: yes, for an action that only shows (the matrix's "yes (read-only)").
 */
export const POLICY_RULES = ["yes", "no", "assigned_building", "own_pending_entry", "not_editor", "assigned_floor_open_alert", "assigned_floor", "read_only"] as const;
export type PolicyRule = (typeof POLICY_RULES)[number];

export interface MatrixRow {
  /** The row's first cell in the AD-4 table, word for word. */
  row: string;
  /** The policy actions the row covers. */
  actions: readonly string[];
  rules: Readonly<Record<StaffRole, PolicyRule>>;
}

/** The AD-4 authority matrix, row by row (the spine's table is the source; policy.test.ts compares them). */
export const AUTHORITY_MATRIX = [
  {
    row: "Author ack, update, final for any floor of an assigned building",
    actions: ["alert.author"],
    rules: { ambassador: "assigned_building", coordinator: "yes", director: "no", admin: "yes" },
  },
  {
    row: "Author neighbourhood scope, or heat, smoke, winter",
    actions: ["alert.author_wide"],
    rules: { ambassador: "no", coordinator: "yes", director: "no", admin: "yes" },
  },
  {
    row: "Author correction or withdrawal",
    actions: ["alert.correct", "alert.withdraw"],
    rules: { ambassador: "own_pending_entry", coordinator: "yes", director: "no", admin: "yes" },
  },
  {
    // Approval sends (AD-5, AD-8): `alert.send` follows the approver's rule.
    row: "Approve (never an editor of that entry, AD-5)",
    actions: ["alert.approve", "alert.send"],
    rules: { ambassador: "no", coordinator: "not_editor", director: "no", admin: "not_editor" },
  },
  {
    // `guide.publish` is "publish directory" (S02.05's Publish directory). `provider.manage` (S02.04) is the same
    // authority one step earlier: choosing which loaded providers are published and confirming them is what the
    // directory is published from, so it follows the row's "publish directory" (Admin only, aal2). `campaign.run` (S09.07) is the end-of-pilot
    // re-consent campaign, its rehearsal on the drill roster and reopening sign-ups: one Admin at aal2 (AD-9 D-7), like a drill. `checkins.round_types`
    // (S08.06) is which types of disruption start a check-in round (E08 "Round types": "editable by an Admin at aal2"), a setting of the Hub like the cap.
    row: "Drills, publish directory, accounts, cap, pause",
    actions: ["drill.run", "guide.publish", "provider.manage", "accounts.manage", "spend.cap", "sending.pause", "buildings.manage", "oncall.manage", "delivery.resend", "campaign.run", "checkins.round_types"],
    rules: { ambassador: "no", coordinator: "no", director: "no", admin: "yes" },
  },
  {
    // S07.03: start a resident's sign-up for texts at an event or the Hub desk (the resident still replies YES themselves). Not privileged:
    // it changes nothing staff can see and is limited per staff account.
    row: "Help a resident sign up for texts",
    actions: ["signup.assist"],
    rules: { ambassador: "yes", coordinator: "yes", director: "no", admin: "yes" },
  },
  {
    row: "See open check-in rows",
    actions: ["checkins.view_open"],
    rules: { ambassador: "assigned_floor_open_alert", coordinator: "no", director: "no", admin: "yes" },
  },
  {
    // S08.07: a mark on a check-in row (done, not reached, needs help) from "My round" (A-04). AD-12: "a late mark is accepted only against an
    // unexpired stub, from a signed-in, active Ambassador who covers that floor (or an Admin)": the row's floor, judged on the person's current
    // assignments, whether the row is still in its open round or has left it (its thread closed, the request withdrawn) and not yet expired.
    row: "Mark check-ins, and late marks on unexpired stubs",
    actions: ["checkins.mark"],
    rules: { ambassador: "assigned_floor", coordinator: "no", director: "no", admin: "yes" },
  },
  {
    // S08.08: the Hub's list of escalations (O-17) and an escalation's page: the building, floor, status, time and ambassador, never the resident's details.
    // The Hub follows up, so the roles that see counts see it (a Director read-only); an Ambassador hears from their own round page instead.
    row: "See escalations (building, floor, ambassador; no resident details)",
    actions: ["checkins.escalations"],
    rules: { ambassador: "no", coordinator: "yes", director: "read_only", admin: "yes" },
  },
  {
    // S08.08: the resident's number, floor and method on an escalation, and marking it handled with a note (E08 "Escalation": "Admins only"); privileged,
    // so it runs at aal2 like every Admin action that reaches personal data.
    row: "Follow up an escalation: the resident's number, floor and method, and mark it handled",
    actions: ["checkins.follow_up"],
    rules: { ambassador: "no", coordinator: "no", director: "no", admin: "yes" },
  },
  {
    row: "See counts and coverage",
    actions: ["coverage.view"],
    rules: { ambassador: "no", coordinator: "yes", director: "read_only", admin: "yes" },
  },
  {
    row: "See spend",
    actions: ["spend.view"],
    rules: { ambassador: "no", coordinator: "no", director: "read_only", admin: "yes" },
  },
] as const satisfies readonly MatrixRow[];

/**
 * What every signed-in staff member may do for themselves, whatever their role: not rows of the
 * matrix, which is about the Hub's work. The setup gates (S01.07, S01.10) still decide when:
 *  - `hub.open`: open the Hub's home;
 *  - `account.own_setup`: choose their own password, enrol their authenticator, enter its code;
 *  - `session.read_own`: read who they are signed in as (`GET /api/staff/me`).
 */
export const SELF_SERVICE_ACTIONS = ["hub.open", "account.own_setup", "session.read_own"] as const;

type MatrixAction = (typeof AUTHORITY_MATRIX)[number]["actions"][number];
export type PolicyAction = MatrixAction | (typeof SELF_SERVICE_ACTIONS)[number];

const RULES: ReadonlyMap<string, Readonly<Record<StaffRole, PolicyRule>>> = new Map([
  ...AUTHORITY_MATRIX.flatMap((row) => row.actions.map((action) => [action, row.rules] as const)),
  ...SELF_SERVICE_ACTIONS.map((action) => [action, Object.fromEntries(STAFF_ROLES.map((role) => [role, "yes"])) as Record<StaffRole, PolicyRule>] as const),
]);

/** Every policy action, matrix rows first. */
export const POLICY_ACTIONS: readonly PolicyAction[] = [...RULES.keys()] as PolicyAction[];

export function isPolicyAction(name: unknown): name is PolicyAction {
  return typeof name === "string" && RULES.has(name);
}

/**
 * One assignment of an Ambassador (S01.14's `ambassador_assignment(staff_id, rsn, floor_ids | null)`):
 * a building, and its floors by id, or null for every floor.
 */
export interface PolicyAssignment {
  rsn: string;
  floorIds: readonly string[] | null;
}

/** The entry an action is on (AD-5): its author, editors and state. */
export interface PolicyEntry {
  authorId: string;
  editorIds: readonly string[];
  status: string;
}

/**
 * The facts a conditional rule needs, loaded by the caller at the time it asks (the guard, then the
 * use case again under its lock). Each is optional: a rule whose fact is missing denies (fail closed).
 */
export interface PolicyContext {
  /** The staff member acting. */
  actorId?: string;
  /** The actor's current assignments (S01.14's `ambassador_assignment`, read by identity's `readAssignments`, which `readStaffStanding` calls in the caller's transaction). An Ambassador with none covers nothing. */
  assignments?: readonly PolicyAssignment[];
  /** The building, and floor where it matters, the action is on. */
  target?: { rsn: string; floorId?: string | null };
  /**
   * Every building the action is on, when it covers more than one (an alert for several
   * buildings). `assigned_building` then needs each of them assigned, together with `target`'s if
   * that is given too; an empty list is not satisfied (an action on no building has no scope).
   */
  targets?: readonly string[];
  /** The entry the action is on (correction, withdrawal, approval). */
  entry?: PolicyEntry;
  /** Whether the target's alert is open (check-in rows). */
  alertOpen?: boolean;
}

/** `allowed`; `forbidden` (the role never may); `out_of_scope` (the role may, but not here). */
export type PolicyDecision = "allowed" | "forbidden" | "out_of_scope";

/** The buildings an action is on: `targets` and `target`'s; none when it names no building (or an empty list). */
function buildingsOf(target: PolicyContext["target"], targets: PolicyContext["targets"]): string[] {
  if (targets?.length === 0) return [];
  return [...(targets ?? []), ...(target ? [target.rsn] : [])];
}

/** The target floor is one the assignments cover: its building as a whole, or that floor by id. No floor given covers nothing. */
function coversTarget(assignments: readonly PolicyAssignment[], target: PolicyContext["target"]): boolean {
  if (target === undefined || typeof target.floorId !== "string") return false;
  const floorId = target.floorId;
  return assignments.some((assignment) => assignment.rsn === target.rsn && (assignment.floorIds === null || assignment.floorIds.includes(floorId)));
}

function holds(rule: PolicyRule, context: PolicyContext): boolean {
  const { actorId, assignments = [], target, targets, entry } = context;
  const buildings = buildingsOf(target, targets);
  switch (rule) {
    case "yes":
    case "read_only":
      return true;
    case "no":
      return false;
    case "assigned_building":
      return buildings.length > 0 && buildings.every((rsn) => assignments.some((assignment) => assignment.rsn === rsn));
    case "assigned_floor_open_alert":
      return context.alertOpen === true && coversTarget(assignments, target);
    case "assigned_floor":
      return coversTarget(assignments, target);
    case "own_pending_entry":
      return actorId !== undefined && entry !== undefined && entry.authorId === actorId && entry.status === "pending_approval";
    case "not_editor":
      // The approve use case (E04) must not rely on this check alone: it re-checks the author with
      // can(authorRole, "alert.author", ...) against the author's current status and assignments,
      // at approval time, as the spine requires.
      return actorId !== undefined && entry !== undefined && !entry.editorIds.includes(actorId) && entry.authorId !== actorId;
  }
}

/** The policy's decision, with why a refusal was made. An unknown action or role is forbidden. */
export function decidePolicy(role: StaffRole, action: string, context: PolicyContext = {}): PolicyDecision {
  const rule = RULES.get(action)?.[role];
  if (rule === undefined || rule === "no") return "forbidden";
  return holds(rule, context) ? "allowed" : "out_of_scope";
}

/** AD-4's `can(role, action, context)`: true only for an allowed combination. */
export function can(role: StaffRole, action: string, context: PolicyContext = {}): boolean {
  return decidePolicy(role, action, context) === "allowed";
}

/** True when the role's rule for the action depends on the context (so the caller loads it). */
export function needsPolicyContext(role: StaffRole, action: string): boolean {
  const rule = RULES.get(action)?.[role];
  return rule !== undefined && rule !== "yes" && rule !== "no" && rule !== "read_only";
}
