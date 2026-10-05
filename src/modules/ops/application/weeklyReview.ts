// The weekly reliability review (S09.04, NFR-N4, AR-21 weekly view): a week of the SQL view `weekly_review`, and its CSV. Read-only; the view has applied the
// small-number rule and holds no personal data. The notes of the review are not kept here: an Admin writes them in docs/procedures/weekly-notes/{week}.md
// (there is no notes table and no write endpoint).
import type { DbExecutor } from "../../../platform/db";
import { weeklyReviewStore } from "../adapters/weeklyReviewStore";
import { isWeekStart, sortWeeklyRows, weeklyReviewCsv, type WeeklyRow } from "../domain/weeklyReview";

/** The week's rows, in reading order. `weekStart` is a Monday (YYYY-MM-DD); anything else throws, since a week is Monday to Sunday in Toronto. */
export async function readWeeklyReview(executor: DbExecutor, weekStart: string): Promise<WeeklyRow[]> {
  if (!isWeekStart(weekStart)) throw new Error("weekly review: a week is given by its Monday, written YYYY-MM-DD");
  return sortWeeklyRows(await weeklyReviewStore.week(executor, weekStart));
}

/** The week's CSV (the export script's content). */
export async function weeklyReviewExport(executor: DbExecutor, weekStart: string): Promise<string> {
  return weeklyReviewCsv(await readWeeklyReview(executor, weekStart));
}
