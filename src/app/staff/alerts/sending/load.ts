// What the sending progress pages read (S06.09): the entry (alerting), what became of its texts (messaging) and whether texts are paused (messaging's pause), put
// together for the published confirmation and for the alert's staff view. Counts, ids and languages: no number is read here. Server only.
import { englishText } from "@/i18n/text";
import type { EntryReview } from "@/modules/alerting";
import type { ProblemState } from "@/modules/messaging";
import { PROBLEM_LIST_LIMIT } from "@/modules/messaging";
import { alerting } from "../../alerts";
import { progressReader, textsArePaused, type ProgressReader } from "../../sendingProgress";
import { typeName } from "../typeNames";
import { approveHref } from "../pages";
import { problemListView, sendingProgressView, sendingText, unavailableNote, type ProblemListView, type SendingBlock, type Text } from "./view";

export interface SendingDeps {
  review: (ref: { alertId: string; entryId: string }) => Promise<EntryReview | null>;
  progress: ProgressReader;
  /** Whether texts are paused now (the paused sentence is added only then). */
  paused: () => Promise<boolean>;
  /** Where a failure is logged (the error's name only). */
  logError: (event: string, fields: Record<string, string>) => void;
}

const live = (): SendingDeps => ({
  review: (ref) => alerting().review(ref),
  progress: progressReader(),
  paused: textsArePaused,
  logError: (event, fields) => console.error(JSON.stringify({ evt: event, module: "alerting", ...fields })),
});

const errorName = (error: unknown) => (error instanceof Error ? error.name : "NonError");

/**
 * The progress block of an approved entry of a real alert; null for every other entry: a drill has its own view (the Drills page, S06.05) and an entry that
 * is not approved has no texts. It never throws: a failure to read is logged by the error's name and becomes a note, so it can never keep the confirmation
 * of an approval from being shown.
 */
export async function sendingBlock(review: EntryReview, deps: Pick<SendingDeps, "progress" | "paused" | "logError">, text: Text = sendingText): Promise<SendingBlock | null> {
  if (review.thread.isDrill || review.entry.status !== "approved") return null;
  const ref = { alertId: review.thread.id, entryId: review.entry.id };
  try {
    // The pause is read after the counts; if it cannot be read the sentence it adds is left out and the counts are shown.
    const progress = await deps.progress.forEntry(ref.entryId);
    const paused = progress.total.waiting > 0 ? await deps.paused() : false;
    return { kind: "progress", view: sendingProgressView({ ref, progress, paused, text }) };
  } catch (error) {
    deps.logError("sending.progress_failed", { error: errorName(error) });
    return { kind: "unavailable", note: unavailableNote(text) };
  }
}

export interface SendingQuery {
  alert?: string | string[];
  entry?: string | string[];
  state?: string | string[];
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The entry a query names, as a reference; empty ids when it names none (the pages then say "not found"). */
export const refOfQuery = (query: SendingQuery): { alertId: string; entryId: string } => ({ alertId: first(query.alert) ?? "", entryId: first(query.entry) ?? "" });

/** The alert's staff view of an entry's sending progress: what the entry is, and the block or why there is none. */
export interface SendingScreen {
  kind: "screen";
  ref: { alertId: string; entryId: string };
  /** "Power, Elevator · Acknowledgement". */
  heading: string;
  block: SendingBlock | null;
  /** Why there is no block: a drill (with the link to the Drills page), or an entry that is not approved. */
  notice: { message: string; link: { href: string; label: string } | null } | null;
  back: { href: string; label: string };
}

export interface MissingSending {
  kind: "missing";
  message: string;
  back: { href: string; label: string };
}

const compose: Text = (key, values) => englishText(`staff.compose.${key}`, values);

const headingOf = (review: EntryReview) => `${review.entry.content.types.map(typeName).join(", ")} · ${compose(`thread.kind.${review.entry.kind}`)}`;

/** The screen for the entry `?alert=<id>&entry=<id>` names, or the screen for one that is not there. */
export async function loadSending(query: SendingQuery, deps: SendingDeps = live(), text: Text = sendingText): Promise<SendingScreen | MissingSending> {
  const ref = refOfQuery(query);
  const review = await deps.review(ref);
  if (!review) return { kind: "missing", message: text("errors.missing"), back: { href: "/staff", label: englishText("staff.approve.back") } };
  const back = { href: approveHref(ref), label: text("back") };
  const heading = headingOf(review);
  if (review.thread.isDrill) {
    return { kind: "screen", ref, heading, block: null, notice: { message: text("drill"), link: { href: "/staff/drills", label: text("drillLink") } }, back };
  }
  if (review.entry.status !== "approved") return { kind: "screen", ref, heading, block: null, notice: { message: text("notApproved"), link: null }, back };
  return { kind: "screen", ref, heading, block: await sendingBlock(review, deps, text), notice: null, back };
}

/** The states a query can ask a list for: one of the three, or nothing (then the page says it was not understood). */
export const stateOfQuery = (query: SendingQuery): ProblemState | null => {
  const value = first(query.state);
  return value === "failed" || value === "undelivered" || value === "unknown" ? value : null;
};

export interface ProblemListScreen {
  kind: "list";
  ref: { alertId: string; entryId: string };
  heading: string;
  list: ProblemListView;
}

/**
 * The list of an entry's texts in one state (its own view). A drill's entry, an unapproved one and a state that is not one of the three have no list.
 * `viewer.canResend` is true for an Admin (the policy action `delivery.resend`, S09.02): only then does the list carry "Resend" on a text and "Resend the failed and
 * undelivered texts in {language}"; the server action asks the guard again, so the buttons are a convenience and never the rule.
 */
export async function loadProblemList(
  query: SendingQuery,
  deps: SendingDeps = live(),
  text: Text = sendingText,
  viewer: { canResend: boolean } = { canResend: false },
): Promise<ProblemListScreen | MissingSending> {
  const ref = refOfQuery(query);
  const state = stateOfQuery(query);
  const review = await deps.review(ref);
  const missing: MissingSending = { kind: "missing", message: text("errors.missing"), back: { href: "/staff", label: englishText("staff.approve.back") } };
  if (!review || state === null || review.thread.isDrill || review.entry.status !== "approved") return missing;
  let found: Awaited<ReturnType<ProgressReader["problemTexts"]>>;
  try {
    found = await deps.progress.problemTexts(ref.entryId, state);
  } catch (error) {
    deps.logError("sending.problems_failed", { error: errorName(error) });
    return { ...missing, message: unavailableNote(text) };
  }
  const { texts, more } = found;
  // The languages that have a failed or undelivered text to resend (the list shows only the most recent ones): from the entry's counts. A failure to read them
  // leaves the per-text buttons and takes away only "resend all".
  let resendLanguages: string[] = [];
  if (viewer.canResend && state !== "unknown") {
    try {
      const progress = await deps.progress.forEntry(ref.entryId);
      resendLanguages = progress.languages.filter((language) => language.failed + language.undelivered > 0).map((language) => language.lang);
    } catch (error) {
      deps.logError("sending.progress_failed", { error: errorName(error) });
    }
  }
  return {
    kind: "list",
    ref,
    heading: headingOf(review),
    list: problemListView({ ref, state, texts, more, limit: PROBLEM_LIST_LIMIT, text, canResend: viewer.canResend, resendLanguages }),
  };
}
