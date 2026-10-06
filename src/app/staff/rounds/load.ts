// Composition of "Check-in rounds" (O-17, S08.08) and an escalation's page (AD-2): checkins' escalations, places' addresses and floor labels, identity's names
// and, for an Admin at aal2 only, subscriptions' number of the subscriber the escalation's row still names. S08.09: the rounds' counts by building and floor,
// an open round's from its live rows (as "My round" reads them) and a closed one's from checkins' tally, with alerting's threads. Read for each request; the
// pages are no-store and the service worker never keeps a staff page (AD-1). Server only.
import "server-only";
import { createAlerting, createAmbassadorHome } from "@/modules/alerting";
import { countsByPlace, escalationList, escalationOf, residentShown, roundTallies, type EscalationRow } from "@/modules/checkins";
import { readStaffName } from "@/modules/identity";
import { stdoutMessagingLog } from "@/modules/messaging";
import { addressesOfBuildings, floorsOfBuilding } from "@/modules/places";
import { escalationNumberOf } from "@/modules/subscriptions";
import { getDb, type Db, type DbExecutor } from "@/platform/db";
import { openRoundRows, roundPlansOf } from "../ambassador/round/load";
import { CLOSED_ROUNDS_DAYS, progressScreen, unreadableProgress, type ProgressScreen } from "./progress";
import { escalationScreen, missingEscalation, roundsScreen, unreadableRounds, type DescribedEscalation, type EscalationScreen, type EscalationViewer, type MissingEscalation, type ResidentFacts, type RoundsScreen } from "./view";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The escalations with their words: each building's address and each floor's label (read once per building), and each staff member's name (once per person). */
export async function describeEscalations(executor: DbExecutor, rows: readonly EscalationRow[]): Promise<DescribedEscalation[]> {
  const rsns = [...new Set(rows.map((row) => row.rsn))];
  const addresses = await addressesOfBuildings(executor, rsns);
  const floors = new Map<string, Map<string, string>>();
  for (const rsn of rsns) floors.set(rsn, new Map(((await floorsOfBuilding(executor, rsn)) ?? []).map((floor) => [floor.id, floor.label])));
  const names = new Map<string, string | null>();
  for (const id of new Set(rows.flatMap((row) => [row.raisedBy, ...(row.handledBy ? [row.handledBy] : [])]))) names.set(id, await readStaffName(executor, id));
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    building: addresses.get(row.rsn) ?? row.rsn,
    floor: floors.get(row.rsn)?.get(row.floorId) ?? "?",
    raisedBy: names.get(row.raisedBy) ?? null,
    late: row.late,
    createdAt: row.createdAt,
    handled: row.handledAt && row.handledNote !== null ? { at: row.handledAt, by: row.handledBy ? (names.get(row.handledBy) ?? null) : null, note: row.handledNote } : null,
  }));
}

/** The list (O-17): the open escalations first, then those handled in the last 7 days. One that cannot be read says so (logged with the error's name only). */
export async function loadRounds(executor: DbExecutor = getDb(), now: Date = new Date()): Promise<RoundsScreen> {
  try {
    return roundsScreen(await describeEscalations(executor, await escalationList(executor, now)));
  } catch (error) {
    stdoutMessagingLog.error("rounds.list_failed", { module: "checkins", error: error instanceof Error ? error.name : "NonError" });
    return unreadableRounds();
  }
}

/**
 * An escalation's page: its words, and the resident's number, floor and method only for an Admin whose session is at aal2 while the row still names its
 * subscriber and the escalation is not a late mark's (checkins' `residentShown`). The number is read only then.
 */
export async function loadEscalation(id: unknown, viewer: EscalationViewer, executor: DbExecutor = getDb()): Promise<EscalationScreen | MissingEscalation> {
  if (typeof id !== "string" || !UUID.test(id)) return missingEscalation();
  const found = await escalationOf(executor, id);
  if (found === null) return missingEscalation();
  const [described] = await describeEscalations(executor, [found.escalation]);
  let facts: ResidentFacts = { kind: "unlinked" };
  if (viewer.followUp && viewer.aal2 && found.row.linked && residentShown(found.escalation, found.row)) {
    facts = { kind: "linked", phone: await escalationNumberOf(executor, found.row.subscriberId), method: found.row.method };
  }
  return escalationScreen(described!, viewer, facts);
}

/**
 * The rounds' counts by building and floor (S08.09): each open round's live rows as "My round" reads them (the open threads residents read, the requesters
 * who still ask; never their numbers, which are not read here), and the tally of the threads closed in the last 7 days that are not drills. Counts that
 * cannot be read say so (logged with the error's name only), and the escalations above them are shown as they are.
 */
export async function loadRoundProgress(db: Db = getDb(), now: Date = new Date()): Promise<ProgressScreen> {
  try {
    const headlines = await createAmbassadorHome(db).openHeadlines();
    const rows = await openRoundRows(db, headlines);
    const since = new Date(now.getTime() - CLOSED_ROUNDS_DAYS * 24 * 60 * 60 * 1000);
    const closed = (await createAlerting({ db }).closedThreads(since)).filter((thread) => !thread.isDrill);
    const tallies = await roundTallies(db, closed.map((thread) => thread.alertId));
    const plans = await roundPlansOf(db, [...rows.map((row) => row.rsn), ...tallies.map((count) => count.rsn)]);
    return progressScreen({ rows, headlines, closed, closedPlaces: countsByPlace(tallies), plans });
  } catch (error) {
    stdoutMessagingLog.error("rounds.progress_failed", { module: "checkins", error: error instanceof Error ? error.name : "NonError" });
    return unreadableProgress();
  }
}
