// The guides and essential numbers seed (S02.09, AD-25): idempotent upserts of what
// domain/guideContent.ts allows, in one transaction with the `seed.run` audit event.
import { sql } from "drizzle-orm";
import { record } from "@/modules/audit";
import type { Db } from "@/platform/db";
import { essentialNumber, guide } from "../adapters/schema";
import { formatSeedReport, planSeed, type ContentInput, type SeedReport } from "../domain/guideContent";

/** The run is refused as a whole (a 911 rule): nothing was written. */
export class SeedRefusedError extends Error {
  constructor(readonly refusals: string[]) {
    super(`Seed refused, nothing loaded:\n${refusals.map((r) => `  - ${r}`).join("\n")}`);
    this.name = "SeedRefusedError";
  }
}

export interface SeedResult {
  report: SeedReport;
  /** Rows inserted or changed by this run; 0 when the database already matches the files. */
  changed: { guides: number; numbers: number };
  /** True when a guide or the numbers list was refused (the others were loaded). */
  partial: boolean;
}

/**
 * Loads the guides and numbers the files allow. Running it twice changes nothing: a row is
 * written only when it differs from the file. A guide or list that is refused is left as it
 * is in the database. Throws SeedRefusedError before any write when a 911 rule fails.
 */
export async function seedGuidesAndNumbers(db: Db, input: ContentInput): Promise<SeedResult> {
  const plan = planSeed(input);
  if (plan.refusals.length > 0) throw new SeedRefusedError(plan.refusals);

  const changed = { guides: 0, numbers: 0 };
  await db.transaction(async (tx) => {
    for (const g of plan.guides) {
      const values = {
        id: g.id,
        readMins: g.readMins,
        owner: g.owner,
        lastUpdated: g.lastUpdated,
        englishReviewer: g.englishReviewer,
        englishReviewedOn: g.englishReviewedOn,
        texts: g.texts,
        translations: g.translations,
      };
      const rows = await tx
        .insert(guide)
        .values(values)
        .onConflictDoUpdate({
          target: guide.id,
          set: {
            readMins: sql`excluded.read_mins`,
            owner: sql`excluded.owner`,
            lastUpdated: sql`excluded.last_updated`,
            englishReviewer: sql`excluded.english_reviewer`,
            englishReviewedOn: sql`excluded.english_reviewed_on`,
            texts: sql`excluded.texts`,
            translations: sql`excluded.translations`,
          },
          setWhere: sql`(${guide.readMins}, ${guide.owner}, ${guide.lastUpdated}, ${guide.englishReviewer}, ${guide.englishReviewedOn}, ${guide.texts}, ${guide.translations})
            is distinct from (excluded.read_mins, excluded.owner, excluded.last_updated, excluded.english_reviewer, excluded.english_reviewed_on, excluded.texts, excluded.translations)`,
        })
        .returning({ id: guide.id });
      changed.guides += rows.length;
    }
    for (const n of plan.numbers) {
      const rows = await tx
        .insert(essentialNumber)
        .values({
          id: n.id,
          sortOrder: n.sortOrder,
          number: n.number,
          emergency: n.emergency,
          owner: n.owner,
          lastUpdated: n.lastUpdated,
          englishReviewer: n.englishReviewer,
          englishReviewedOn: n.englishReviewedOn,
          lastChecked: n.lastChecked,
          texts: n.texts,
          translations: n.translations,
        })
        .onConflictDoUpdate({
          target: essentialNumber.id,
          set: {
            sortOrder: sql`excluded.sort_order`,
            number: sql`excluded.number`,
            emergency: sql`excluded.emergency`,
            owner: sql`excluded.owner`,
            lastUpdated: sql`excluded.last_updated`,
            englishReviewer: sql`excluded.english_reviewer`,
            englishReviewedOn: sql`excluded.english_reviewed_on`,
            lastChecked: sql`excluded.last_checked`,
            texts: sql`excluded.texts`,
            translations: sql`excluded.translations`,
          },
          setWhere: sql`(${essentialNumber.sortOrder}, ${essentialNumber.number}, ${essentialNumber.emergency}, ${essentialNumber.owner}, ${essentialNumber.lastUpdated}, ${essentialNumber.englishReviewer}, ${essentialNumber.englishReviewedOn}, ${essentialNumber.lastChecked}, ${essentialNumber.texts}, ${essentialNumber.translations})
            is distinct from (excluded.sort_order, excluded.number, excluded.emergency, excluded.owner, excluded.last_updated, excluded.english_reviewer, excluded.english_reviewed_on, excluded.last_checked, excluded.texts, excluded.translations)`,
        })
        .returning({ id: essentialNumber.id });
      changed.numbers += rows.length;
    }

    const { report } = plan;
    const refusedGuides = report.guides.filter((g) => !g.loaded).length;
    const warnings = report.translations.unavailable.filter((u) => u.reason !== "not_translated").length;
    // seed.run allows only a seed code, counts, warnings and failures (src/modules/audit/domain/actions.ts):
    // warnings are translations not loaded although they exist (stale, unreviewed, ...), failures are
    // the guides and the numbers list that were refused.
    await record(tx, {
      action: "seed.run",
      actorStaffId: null,
      subjectType: "guides_and_numbers",
      subjectId: null,
      meta: {
        seed: "guides_and_numbers",
        counts: {
          guides_loaded: report.guides.length - refusedGuides,
          guides_refused: refusedGuides,
          numbers_loaded: plan.numbers.length,
          rows_changed_guide: changed.guides,
          rows_changed_number: changed.numbers,
          translations_loaded: report.translations.loaded,
          translations_not_yet: report.translations.unavailable.length - warnings,
        },
        warnings,
        failures: refusedGuides + (report.numbers.loaded ? 0 : 1),
      },
    });
  });

  const partial = plan.report.guides.some((g) => !g.loaded) || !plan.report.numbers.loaded;
  return { report: plan.report, changed, partial };
}

export { formatSeedReport };
