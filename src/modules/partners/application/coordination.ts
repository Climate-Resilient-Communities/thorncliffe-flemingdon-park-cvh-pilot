// What the Hub and partner screens read besides the spaces (the partner space, 2026-11-07): the organisations, the shared space of the open
// disruption and what is in it (statements, decisions, handovers; P-02, P-04, P-09, P-10), the supplies (P-08), and the readiness area between
// disruptions (standing commitments, playbooks, teams and triggers, exercises, indicators, look back; P-11 to P-16). Read-only in this release:
// the rows are the dummy data the seed loaded (data/partners/seed.json).
import { asc, desc, eq, isNull } from "drizzle-orm";
import type { DbExecutor } from "@/platform/db";
import {
  lookBackAction,
  lookBackRecord,
  partnerCommitment,
  partnerDecision,
  partnerExercise,
  partnerHandover,
  partnerIndicator,
  partnerOrg,
  partnerStatement,
  partnerSupply,
  partnerTeam,
  playbook,
  sharedSpace,
  type PlaybookVersion,
} from "../adapters/schema";
import type { StatementKind } from "../domain/coverage";
import type { Hazard, OrgCapacity } from "../domain/seedData";

export interface PartnerOrgRow {
  id: string;
  name: string;
  shortName: string;
  kind: string;
  contactRole: string;
  contactPhone: string;
  contactEmail: string;
  capacity: OrgCapacity | null;
  capacitySetAt: Date | null;
}

/** Every organisation, the Hub first (the seed's order). */
export async function listOrgs(executor: DbExecutor): Promise<PartnerOrgRow[]> {
  const rows = await executor
    .select({
      id: partnerOrg.id,
      name: partnerOrg.name,
      shortName: partnerOrg.shortName,
      kind: partnerOrg.kind,
      contactRole: partnerOrg.contactRole,
      contactPhone: partnerOrg.contactPhone,
      contactEmail: partnerOrg.contactEmail,
      capacity: partnerOrg.capacity,
      capacitySetAt: partnerOrg.capacitySetAt,
    })
    .from(partnerOrg)
    .orderBy(asc(partnerOrg.sortOrder));
  return rows as PartnerOrgRow[];
}

export interface SharedSpaceRow {
  id: string;
  hazard: Hazard;
  level: number;
  location: string;
  purpose: string;
  openedAt: Date;
  openedBy: string;
}

/** The shared space of the open disruption: the latest one still open, or null when no disruption has one. */
export async function openSharedSpace(executor: DbExecutor): Promise<SharedSpaceRow | null> {
  const [row] = await executor
    .select({ id: sharedSpace.id, hazard: sharedSpace.hazard, level: sharedSpace.level, location: sharedSpace.location, purpose: sharedSpace.purpose, openedAt: sharedSpace.openedAt, openedBy: sharedSpace.openedBy })
    .from(sharedSpace)
    .where(isNull(sharedSpace.closedAt))
    .orderBy(desc(sharedSpace.openedAt))
    .limit(1);
  return (row as SharedSpaceRow | undefined) ?? null;
}

export interface StatementRow {
  id: string;
  orgId: string;
  person: string;
  kind: StatementKind;
  body: string;
  postedAt: Date;
  claimedBy: string | null;
  answers: string | null;
}

/** The statements of a shared space, newest first. */
export async function statementsOf(executor: DbExecutor, sharedSpaceId: string): Promise<StatementRow[]> {
  const rows = await executor
    .select({
      id: partnerStatement.id,
      orgId: partnerStatement.orgId,
      person: partnerStatement.person,
      kind: partnerStatement.kind,
      body: partnerStatement.body,
      postedAt: partnerStatement.postedAt,
      claimedBy: partnerStatement.claimedBy,
      answers: partnerStatement.answers,
    })
    .from(partnerStatement)
    .where(eq(partnerStatement.sharedSpaceId, sharedSpaceId))
    .orderBy(desc(partnerStatement.postedAt));
  return rows as StatementRow[];
}

export interface DecisionRow {
  id: string;
  orgId: string;
  person: string;
  decidedAt: Date;
  body: string;
  why: string;
}

/** The decision log of a shared space, newest first (P-09). */
export async function decisionsOf(executor: DbExecutor, sharedSpaceId: string): Promise<DecisionRow[]> {
  return executor
    .select({ id: partnerDecision.id, orgId: partnerDecision.orgId, person: partnerDecision.person, decidedAt: partnerDecision.decidedAt, body: partnerDecision.body, why: partnerDecision.why })
    .from(partnerDecision)
    .where(eq(partnerDecision.sharedSpaceId, sharedSpaceId))
    .orderBy(desc(partnerDecision.decidedAt));
}

export interface HandoverRow {
  id: string;
  orgId: string;
  fromPerson: string;
  toPerson: string | null;
  handedAt: Date;
  note: string;
  openItems: string[];
}

/** The handover notes of a shared space, newest first (P-10). */
export async function handoversOf(executor: DbExecutor, sharedSpaceId: string): Promise<HandoverRow[]> {
  return executor
    .select({
      id: partnerHandover.id,
      orgId: partnerHandover.orgId,
      fromPerson: partnerHandover.fromPerson,
      toPerson: partnerHandover.toPerson,
      handedAt: partnerHandover.handedAt,
      note: partnerHandover.note,
      openItems: partnerHandover.openItems,
    })
    .from(partnerHandover)
    .where(eq(partnerHandover.sharedSpaceId, sharedSpaceId))
    .orderBy(desc(partnerHandover.handedAt));
}

export interface CommitmentRow {
  id: string;
  orgId: string;
  hazard: Hazard;
  mode: "everyday" | "during" | "recovery";
  body: string;
  role: string;
  agreement: string | null;
  reviewDue: string;
  forDisruption: "confirmed" | "declined" | null;
}

/** Every standing commitment, by disruption type then review date (P-11). */
export async function listCommitments(executor: DbExecutor): Promise<CommitmentRow[]> {
  const rows = await executor
    .select({
      id: partnerCommitment.id,
      orgId: partnerCommitment.orgId,
      hazard: partnerCommitment.hazard,
      mode: partnerCommitment.mode,
      body: partnerCommitment.body,
      role: partnerCommitment.role,
      agreement: partnerCommitment.agreement,
      reviewDue: partnerCommitment.reviewDue,
      forDisruption: partnerCommitment.forDisruption,
    })
    .from(partnerCommitment)
    .orderBy(asc(partnerCommitment.hazard), asc(partnerCommitment.reviewDue), asc(partnerCommitment.id));
  return rows as CommitmentRow[];
}

export interface SupplyRow {
  id: string;
  orgId: string;
  item: string;
  qty: "few" | "some" | "plenty";
  qtyNum: number | null;
  unit: string;
  location: string;
  updatedAt: Date;
}

/** What each organisation holds, by organisation then most recently updated (P-08). */
export async function listSupplies(executor: DbExecutor): Promise<SupplyRow[]> {
  const rows = await executor
    .select({
      id: partnerSupply.id,
      orgId: partnerSupply.orgId,
      item: partnerSupply.item,
      qty: partnerSupply.qty,
      qtyNum: partnerSupply.qtyNum,
      unit: partnerSupply.unit,
      location: partnerSupply.location,
      updatedAt: partnerSupply.updatedAt,
    })
    .from(partnerSupply)
    .innerJoin(partnerOrg, eq(partnerOrg.id, partnerSupply.orgId))
    .orderBy(asc(partnerOrg.sortOrder), desc(partnerSupply.updatedAt));
  return rows as SupplyRow[];
}

export interface PlaybookRow {
  hazard: Hazard;
  state: "agreed" | "proposed" | "placeholder";
  version: string | null;
  agreedOn: string | null;
  staleAfterMins: number;
  ambassadorPosting: "direct" | "hub" | "none";
  activated: string[];
  spaces: string[];
  templates: string[];
  asks: Record<string, string>;
  steps: string[];
  history: PlaybookVersion[];
}

/** Every playbook, one per disruption type (P-12). */
export async function listPlaybooks(executor: DbExecutor): Promise<PlaybookRow[]> {
  const rows = await executor.select().from(playbook).orderBy(asc(playbook.hazard));
  return rows as PlaybookRow[];
}

export interface TeamRow {
  hazard: Hazard;
  level: number;
  team: string | null;
  channels: string[];
  triggerEvent: string | null;
}

/** Who is activated for each disruption type and level (P-13). */
export async function listTeams(executor: DbExecutor): Promise<TeamRow[]> {
  const rows = await executor.select().from(partnerTeam).orderBy(asc(partnerTeam.hazard), asc(partnerTeam.level));
  return rows as TeamRow[];
}

export interface ExerciseRow {
  id: string;
  hazard: Hazard;
  level: number;
  title: string;
  kind: "scheduled" | "past";
  onDate: string;
  repeats: "none" | "q" | "h" | "y";
  tookPart: number | null;
}

/** The exercises, soonest first (P-14). */
export async function listExercises(executor: DbExecutor): Promise<ExerciseRow[]> {
  const rows = await executor.select().from(partnerExercise).orderBy(asc(partnerExercise.onDate));
  return rows as ExerciseRow[];
}

export interface IndicatorRow {
  id: string;
  realValue: string | null;
  exerciseValue: string | null;
  everydayValue: string | null;
}

/** The indicators, in their agreed order (P-15). */
export async function listIndicators(executor: DbExecutor): Promise<IndicatorRow[]> {
  return executor
    .select({ id: partnerIndicator.id, realValue: partnerIndicator.realValue, exerciseValue: partnerIndicator.exerciseValue, everydayValue: partnerIndicator.everydayValue })
    .from(partnerIndicator)
    .orderBy(asc(partnerIndicator.sortOrder));
}

export interface LookBackRow {
  id: string;
  kind: "real" | "exercise";
  hazard: Hazard;
  place: string;
  period: string;
  title: string;
  lessons: string[];
}

export interface ActionRow {
  id: string;
  lesson: string;
  body: string;
  ownerRole: string;
  due: string;
  status: "open" | "done";
  changed: string | null;
}

/** The past records, newest first, and the actions, open ones first then by due date (P-16). */
export async function readLookBack(executor: DbExecutor): Promise<{ records: LookBackRow[]; actions: ActionRow[] }> {
  const records = await executor.select().from(lookBackRecord).orderBy(desc(lookBackRecord.period), asc(lookBackRecord.id));
  const actions = await executor.select().from(lookBackAction).orderBy(desc(lookBackAction.status), asc(lookBackAction.due));
  return { records: records as LookBackRow[], actions: actions as ActionRow[] };
}
