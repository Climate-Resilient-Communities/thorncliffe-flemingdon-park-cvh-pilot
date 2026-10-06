// Composition root of "My round" (S08.07, A-04; AD-2, AD-12): checkins' live rows and marks, alerting's open threads (the words residents read), places'
// buildings and floors, identity's assignments and subscriptions' numbers, on the app's database connection. The round is composed for each request from
// the person's assignments as they are now (compose.ts), and the API sends it no-store; nothing is cached here. Server only.
import "server-only";
import type { RoundResponse } from "@/contracts/checkinRound";
import { createAmbassadorHome } from "@/modules/alerting";
import { createMarks, liveRoundRows, roundRowPlace, type Marks, type RoundAssignment, type RoundSummaryReader } from "@/modules/checkins";
import { createAssignments, type PolicyAssignment } from "@/modules/identity";
import { addressesOfBuildings, floorsOfBuilding } from "@/modules/places";
import { checkinContactsOf } from "@/modules/subscriptions";
import { getDb, type Db } from "@/platform/db";
import type { StaffSession } from "../../session";
import { composeRound, sightOf, type RoundPlan, type RoundViewer } from "./compose";

/** The reads of the round on one database: what the page shows a person, and the count the Ambassador's home shows. */
export interface RoundReads {
  /** The round as this person may see it now. */
  load(session: Pick<StaffSession, "staffId" | "role">): Promise<RoundResponse>;
  /** The Ambassador's home (A-01): the requests of the open rounds on the floors these assignments cover; null when there is none. */
  summary: RoundSummaryReader;
}

/** The buildings of these rows with their floors in the building's own order, by address. */
async function plansOf(db: Db, rsns: readonly string[]): Promise<RoundPlan[]> {
  const unique = [...new Set(rsns)];
  const addresses = await addressesOfBuildings(db, unique);
  const plans: RoundPlan[] = [];
  for (const rsn of unique) plans.push({ rsn, address: addresses.get(rsn) ?? rsn, floors: (await floorsOfBuilding(db, rsn)) ?? [] });
  return plans.sort((a, b) => a.address.localeCompare(b.address, "en") || a.rsn.localeCompare(b.rsn));
}

export function createRoundReads(db: Db): RoundReads {
  const home = createAmbassadorHome(db);
  const assignments = createAssignments({ db, floors: { floorsOf: floorsOfBuilding } });
  const viewerOf = async (session: Pick<StaffSession, "staffId" | "role">): Promise<RoundViewer> => ({
    role: session.role,
    // Only an active Ambassador's assignments count (identity's `assignmentsOf`, read now): anyone else covers nothing.
    assignments: session.role === "ambassador" ? await assignments.assignmentsOf(session.staffId) : [],
  });
  return {
    async load(session) {
      const [viewer, rows, headlines] = await Promise.all([viewerOf(session), liveRoundRows(db), home.openHeadlines()]);
      const plans = await plansOf(db, rows.filter((row) => headlines.has(row.alertId)).map((row) => row.rsn));
      return composeRound(viewer, { rows, headlines, plans, contactsOf: (ids) => checkinContactsOf(db, ids) });
    },
    summary: {
      async openFor(current: readonly RoundAssignment[]) {
        if (current.length === 0) return null;
        const [rows, headlines] = await Promise.all([liveRoundRows(db), home.openHeadlines()]);
        const viewer: RoundViewer = { role: "ambassador", assignments: current as readonly PolicyAssignment[] };
        const requests = rows.filter((row) => headlines.has(row.alertId) && sightOf(viewer, row) === "contact").length;
        return requests === 0 ? null : { requests };
      },
    },
  };
}

let reads: RoundReads | undefined;
let marks: Marks | undefined;

/** The round's reads on the app's database (made once). */
export function roundReads(): RoundReads {
  return (reads ??= createRoundReads(getDb()));
}

/** The marks use case on the app's database (made once). S08.08 gives it the escalations' follow-up. */
export function roundMarks(): Marks {
  return (marks ??= createMarks({ db: getDb() }));
}

/** Where the row a mark names is, for the staff guard's `checkins.mark` (read from the database, never from the request); null for no such row. */
export function markPlace(roundRef: string): Promise<{ rsn: string; floorId: string } | null> {
  return roundRowPlace(getDb(), roundRef);
}
