// What the submit endpoints say (S04.05, src/contracts/alertSubmit.ts): the alerting module's entry state and a submit's report as the
// wire bodies the composer's browser reads. Pure.
import { LANG_CODES, type LangCode } from "@/contracts/lang";
import { EntryStateSchema, LANGUAGE_RESULTS, SubmitResultSchema, type EntryState as EntryStateBody, type LanguageResult, type SubmitResult } from "@/contracts/alertSubmit";
import type { EntryState, SubmitReport } from "@/modules/alerting";

const isLang = (value: string): value is LangCode => (LANG_CODES as readonly string[]).includes(value);
const isResult = (value: string): value is LanguageResult => (LANGUAGE_RESULTS as readonly string[]).includes(value);

/** The entry's stored state, with the latest attempt and the frozen translations, as the wire carries it; null when there is no such entry. */
export function entryStateBody(state: EntryState | null, now: Date): EntryStateBody | null {
  if (state === null) return null;
  const { entry, attempt } = state;
  const body: EntryStateBody = {
    v: 1,
    server_now: now.toISOString(),
    entry: {
      id: entry.id,
      alert_id: entry.alertId,
      kind: entry.kind,
      status: entry.status,
      version: entry.version,
      content_hash: entry.contentHash,
      possible_duplicate_of: entry.possibleDuplicateOf,
    },
    attempt:
      attempt === null
        ? null
        : {
            key: attempt.key,
            kind: attempt.kind,
            state: attempt.state,
            outcome: attempt.outcome,
            started_at: attempt.startedAt.toISOString(),
            finished_at: attempt.finishedAt?.toISOString() ?? null,
            budget_ms: attempt.budgetMs,
            progress: Object.fromEntries(Object.entries(attempt.progress).filter(([lang, result]) => isLang(lang) && isResult(result))),
            result_version: attempt.resultVersion,
          },
    translations: state.translations.flatMap((translation) =>
      isLang(translation.lang) && isResult(translation.status) ? [{ lang: translation.lang, status: translation.status, machine: translation.machine }] : [],
    ),
  };
  // The body is what the browser parses with the same schema: what this builds must pass it.
  return EntryStateSchema.parse(body);
}

/** A submit's report and the entry's state after it, as the wire carries them. */
export function submitResultBody(report: SubmitReport, state: EntryState | null, now: Date): SubmitResult {
  const result: SubmitResult = {
    v: 1,
    state: report.state,
    outcome: report.state === "refused" ? report.refusal : report.outcome,
    entry_state: entryStateBody(state, now),
  };
  return SubmitResultSchema.parse(result);
}
