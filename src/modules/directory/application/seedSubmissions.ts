// Demo suggestions for the moderation queue (PRD §6.3, D9/E4): five made-up rows so O-08 is not empty in a demo, a walkthrough or a review
// session. Run by scripts/seed/submissions.mjs as the migration role, never by a migration and never in production by accident (the seed
// target's own checks: an explicit SEED_DATABASE_URL, a remote host only with --yes).
//
// Two new places waiting, one correction waiting (of the first provider the database holds, when it holds one), one place declined as an
// advert, one accepted and not yet added to the catalogue (so the Providers page shows its "From residents" task). Every word is invented and
// names no person. The reference codes start with SEED, so the rows are easy to recognise and to delete; running the seed again inserts
// nothing new (each code is inserted once).
import { asc } from "drizzle-orm";
import { record, SYSTEM_ACTOR } from "@/modules/audit";
import type { Db } from "@/platform/db";
import { placeSubmission, provider } from "../adapters/schema";

/** Who "decided" the seeded decisions: no staff account (decided_by names none), so the demo never borrows a real person's name. */
export const SEED_DECIDER = "00000000-0000-4000-8000-00000000d3c0";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function seedDemoSubmissions(db: Db, options: { now?: () => Date } = {}): Promise<{ inserted: number }> {
  const now = (options.now ?? (() => new Date()))();
  const ago = (days: number, hours = 0) => new Date(now.getTime() - days * DAY_MS - hours * 60 * 60 * 1000);
  const [listed] = await db.select({ id: provider.id, name: provider.name }).from(provider).orderBy(asc(provider.id)).limit(1);

  const rows: (typeof placeSubmission.$inferInsert)[] = [
    {
      ref: "SEED-2A2A",
      kind: "add",
      lang: "en",
      type: "offer",
      name: "Thursday food bank",
      what: "Free groceries on Thursday evenings, for anyone who needs them.",
      location: { kind: "address", text: "45 Overlea Blvd, the community room at the back" },
      cost: "free",
      idRequired: "no",
      stepFree: "yes",
      languages: ["en", "ur", "prs"],
      createdAt: ago(5, 3),
    },
    {
      ref: "SEED-2B2B",
      kind: "add",
      lang: "en",
      type: "official",
      name: "Homework club at the library",
      what: "Tutors help children in grades 1 to 8 with homework after school.",
      location: { kind: "pin", lat: 43.7172, lng: -79.3364 },
      category: "Libraries",
      cost: "free",
      idRequired: "notSure",
      createdAt: ago(1, 6),
    },
    {
      ref: "SEED-4D4D",
      kind: "add",
      lang: "en",
      type: "offer",
      name: "Phone repair and accessories, 20% off",
      what: "Screens fixed while you wait. Sale on cases this week.",
      location: { kind: "address", text: "Thorncliffe Park Plaza" },
      cost: "fee",
      status: "declined",
      declineReason: "advert",
      decidedBy: SEED_DECIDER,
      decidedAt: ago(2),
      createdAt: ago(6),
    },
    {
      ref: "SEED-5E5E",
      kind: "add",
      lang: "en",
      type: "offer",
      name: "Seniors' tea afternoon",
      what: "Tea and conversation for older neighbours, Tuesdays at 2.",
      location: { kind: "address", text: "Flemingdon Park, the recreation centre lobby" },
      cost: "free",
      stepFree: "yes",
      status: "accepted",
      decidedBy: SEED_DECIDER,
      decidedAt: ago(1),
      createdAt: ago(4),
    },
  ];
  if (listed) {
    rows.push({
      ref: "SEED-3C3C",
      kind: "correct",
      lang: "en",
      name: listed.name,
      providerId: listed.id,
      changes: { where: "Moved to the second floor, room 204", cost: "free" },
      createdAt: ago(0, 5),
    });
  }

  return db.transaction(async (tx) => {
    const inserted = await tx.insert(placeSubmission).values(rows).onConflictDoNothing({ target: placeSubmission.ref }).returning({ ref: placeSubmission.ref });
    await record(tx, {
      action: "seed.run",
      actorStaffId: SYSTEM_ACTOR,
      subjectType: "place_submission",
      subjectId: null,
      meta: { seed: "place_submissions", counts: { inserted: inserted.length, skipped: rows.length - inserted.length } },
    });
    return { inserted: inserted.length };
  });
}
