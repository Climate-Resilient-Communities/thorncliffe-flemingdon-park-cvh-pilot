// The sending progress of an entry as use cases (S06.09, O-06): the counts per language of what became of the entry's texts, and the list of the
// texts that did not arrive. Read-only. A delivery row holds no phone number, so nothing here has one; the entry is named by id, and it is the caller
// (the Hub, which has read the entry from alerting) that keeps a drill's entry out: drills have their own view (S06.05, `drillResults`).
import type { DbExecutor } from "../../../platform/db";
import { PROBLEM_STATES, problemMeaning, referenceOf, sumOf, totalOf, type EntryProgress, type LanguageProgress, type ProblemState, type ProblemText } from "../domain/sendingProgress";

/** The most texts one list shows; the answer says when there are more. */
export const PROBLEM_LIST_LIMIT = 200;

/** A text that did not arrive, as the store reads it: the row's facts, before they are put in words. */
export interface ProblemRow {
  id: string;
  lang: string;
  state: ProblemState;
  providerErrorCode: number | null;
  attempts: number;
  at: Date;
}

/** Port: the outbox's rows for the progress view (adapters/progressStore.ts). Ids, states, languages and instants only. */
export interface ProgressStore {
  /** The entry's counts per language (one row for each language that has a text) and how many of its rows have `handed_off_at` set. */
  languageCounts(executor: DbExecutor, entryId: string): Promise<{ languages: LanguageProgress[]; handedOff: number }>;
  /** The entry's texts in `states`, the most recently changed first (ties by id), at most `limit`. */
  problemRows(executor: DbExecutor, entryId: string, states: readonly ProblemState[], limit: number): Promise<ProblemRow[]>;
}

export interface SendingProgress {
  /** What became of the entry's texts: per language, then in all. A drill's texts (recipient kind `roster`) are never counted. */
  forEntry(executor: DbExecutor, entryId: string): Promise<EntryProgress>;
  /** The entry's texts that failed, were undelivered or are `unknown` (all three, or the one asked for), each with what it means. At most `PROBLEM_LIST_LIMIT`. */
  problemTexts(executor: DbExecutor, entryId: string, state?: ProblemState): Promise<{ texts: ProblemText[]; more: boolean }>;
}

export function createSendingProgress(deps: { store: ProgressStore }): SendingProgress {
  return {
    async forEntry(executor, entryId) {
      const { languages, handedOff } = await deps.store.languageCounts(executor, entryId);
      const total = totalOf(languages);
      return { languages, total, texts: sumOf(total), handedOff };
    },
    async problemTexts(executor, entryId, state) {
      const rows = await deps.store.problemRows(executor, entryId, state === undefined ? PROBLEM_STATES : [state], PROBLEM_LIST_LIMIT + 1);
      const texts = rows.slice(0, PROBLEM_LIST_LIMIT).map((row): ProblemText => {
        const { meaning, code } = problemMeaning({ state: row.state, providerErrorCode: row.providerErrorCode, attempts: row.attempts });
        return { id: row.id, reference: referenceOf(row.id), lang: row.lang, state: row.state, meaning, code, at: row.at };
      });
      return { texts, more: rows.length > PROBLEM_LIST_LIMIT };
    },
  };
}
