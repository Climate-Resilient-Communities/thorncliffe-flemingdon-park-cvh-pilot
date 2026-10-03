import type { LangCode } from "@/contracts/lang";

/**
 * One line of operational log (spine: Logging) for a failed feed read, with no personal data: the kind of error and the
 * language of the page, never the error's message (a database message can carry the query, and a rejected feed's can
 * carry an alert's text) and never anything about the visitor. After E04 a malformed thread fails every resident's
 * feed, and this line is the trace of it.
 */
export function logFeedReadFailed(lang: LangCode, error: unknown): void {
  console.log(JSON.stringify({ level: "error", evt: "resident.feed_read_failed", module: "app", lang, error: error instanceof Error ? error.constructor.name : "unknown" }));
}
