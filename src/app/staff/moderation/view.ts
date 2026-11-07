// What the moderation queue (O-08), a suggestion's review (O-09) and its decline (O-10) show, from the suggestions as the directory module reads
// them (PRD §6.3, D9/E4): pure, so the tests draw the very same words the page does. English only, like every Hub screen; the prototype's own
// O08, O09 and O10 strings where they say what the pilot does, staff.moderation where they would not (accepting publishes nothing: AD-11).
//
// Left out of the prototype on purpose: the ambassador lane (a resident has no identity, so every suggestion is on the general lane), the
// weekly time budget and the batch accept (a pilot queue of a few a week), and editing the fields before accepting (the Admin edits the
// catalogue entry itself when adding it).
import type { CorrectionChanges, CostAnswer, DeclineReason, WhereRecord, YesNoAnswer } from "@/contracts/placeSubmission";
import { DECLINE_REASONS } from "@/contracts/placeSubmission";
import { englishText } from "@/i18n/text";
import { dueOf, submissionFlags, waitedDays, type ListedProvider, type SubmissionFlag, type SubmissionRecord } from "@/modules/directory";
import { formatTorontoDate } from "@/platform/clock";
import { staffLanguageName } from "../languageName";

import { reviewHref } from "./pages";

export { MODERATION_PAGE, REVIEW_PAGE, reviewHref } from "./pages";

const t = (key: string, values?: Record<string, string | number>) => englishText(`staff.moderation.${key}`, values);
const o8 = (key: string, values?: Record<string, string | number>) => englishText(`O08.${key}`, values);
const o9 = (key: string, values?: Record<string, string | number>) => englishText(`O09.${key}`, values);
const o10 = (key: string, values?: Record<string, string | number>) => englishText(`O10.${key}`, values);

/** O08.types: a new official service, a new community offer, or a correction. */
export function typeLabel(submission: Pick<SubmissionRecord, "kind" | "type">): string {
  if (submission.kind === "correct") return o8("types.correction");
  return o8(submission.type === "offer" ? "types.communityOffer" : "types.service");
}

/** "Sent today", "1 day", "{n} days". */
export function waitedText(days: number): string {
  if (days === 0) return o8("today");
  return days === 1 ? o8("day") : o8("days", { n: days });
}

/** Where a waiting suggestion stands against the week residents are told. */
export function dueText(days: number): { text: string; overdue: boolean } {
  const due = dueOf(days);
  switch (due.kind) {
    case "dueIn":
      return { text: o8("dueIn", { n: due.days }), overdue: false };
    case "dueTomorrow":
      return { text: o8("dueTomorrow"), overdue: false };
    case "dueToday":
      return { text: o8("dueToday"), overdue: false };
    case "overdue":
      return { text: due.days === 1 ? o8("overdueOne") : o8("overdue", { n: due.days }), overdue: true };
  }
}

/** Which of O08.changed a correction's fields fall under: the name, the place, the cost, or "details" for the others. */
const CHANGED_GROUP: Record<keyof CorrectionChanges, "name" | "where" | "cost" | "other"> = {
  name: "name",
  where: "where",
  cost: "cost",
  phone: "other",
  web: "other",
  idRequired: "other",
  stepFree: "other",
};

/** What a correction changes, in O08.changed's words: "place and cost". */
export function changedWhat(changes: CorrectionChanges): string {
  const groups = [...new Set((Object.keys(changes) as (keyof CorrectionChanges)[]).filter((key) => changes[key] !== undefined).map((key) => CHANGED_GROUP[key]))];
  const words = groups.map((group) => o8(`changed.${group}`));
  return words.length <= 1 ? (words[0] ?? o8("changed.other")) : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** "Changes the place and cost of a place already on the map." */
export function correctionLine(changes: CorrectionChanges): string {
  return o8("correctionOf", { what: changedWhat(changes) });
}

const FLAG_KEY: Record<SubmissionFlag, string> = { noCat: "flags.noCat", fee: "flags.fee", lowCost: "flags.lowCost", words: "flags.words" };

export interface QueueRowView {
  id: string;
  href: string;
  name: string;
  /** What they wrote (a new place) or what a correction changes. */
  gloss: string;
  typeLabel: string;
  language: string;
  waited: string;
  due: string;
  overdue: boolean;
  flags: string[];
  ref: string;
  reviewLabel: string;
}

export interface DecidedRowView {
  id: string;
  href: string;
  name: string;
  typeLabel: string;
  decision: string;
  declined: boolean;
}

export interface QueueScreen {
  waitingCount: number;
  oldest: string;
  overdueCount: number;
  rows: QueueRowView[];
  decided: DecidedRowView[];
}

export function queueRowView(submission: SubmissionRecord, now: Date): QueueRowView {
  const days = waitedDays(submission.createdAt, now);
  const due = dueText(days);
  return {
    id: submission.id,
    href: reviewHref(submission.id),
    name: submission.name,
    gloss: submission.kind === "correct" && submission.changes ? correctionLine(submission.changes) : (submission.what ?? ""),
    typeLabel: typeLabel(submission),
    language: staffLanguageName(submission.lang),
    waited: waitedText(days),
    due: due.text,
    overdue: due.overdue,
    flags: submissionFlags(submission).map((flag) => o8(FLAG_KEY[flag])),
    ref: t("refLine", { ref: submission.ref }),
    reviewLabel: `${o8("review")}: ${submission.name}`,
  };
}

/** The decision as one line: "Accepted on 5 Nov 2026", "Declined: Selling or advertising on 5 Nov 2026". */
export function decisionText(submission: Pick<SubmissionRecord, "status" | "declineReason" | "decidedAt">): string {
  const decision = submission.status === "declined" && submission.declineReason ? o8("declined", { reason: o10(`labels.${submission.declineReason}`) }) : o8("accepted");
  return submission.decidedAt ? t("decidedOn", { decision, date: formatTorontoDate(submission.decidedAt) }) : decision;
}

export function queueScreen(data: { waiting: SubmissionRecord[]; decided: SubmissionRecord[] }, now: Date): QueueScreen {
  const rows = data.waiting.map((submission) => queueRowView(submission, now));
  const oldest = data.waiting[0];
  return {
    waitingCount: rows.length,
    oldest: oldest ? waitedText(waitedDays(oldest.createdAt, now)) : o8("oldestNone"),
    overdueCount: rows.filter((row) => row.overdue).length,
    rows,
    decided: data.decided.map((submission) => ({
      id: submission.id,
      href: reviewHref(submission.id),
      name: submission.name,
      typeLabel: typeLabel(submission),
      decision: decisionText(submission),
      declined: submission.status === "declined",
    })),
  };
}

// ---------------------------------------------------------------- O-09, one suggestion

export interface AnswerRow {
  label: string;
  value: string;
  /** `missing`: an answer it cannot go on the map without, `notSure`: an answer the resident gave as "Not sure", `plain` otherwise. */
  tone: "plain" | "missing" | "notSure";
  /** A link beside the value (a pin's place on a map). */
  link?: { href: string; label: string };
}

const costText = (cost: CostAnswer | null | undefined) =>
  cost === null || cost === undefined ? null : cost === "notSure" ? o9("notSure") : o9(`cost.${cost === "low" ? "lowCost" : cost}`);
const yesNoText = (value: YesNoAnswer | null | undefined) => (value === null || value === undefined ? null : value === "notSure" ? o9("notSure") : o9(value));

/** A row of an answer the resident could leave out: "Not given" when they did, "Not sure" marked as such. */
function answer(label: string, value: string | null, notSure = false): AnswerRow {
  if (value === null) return { label, value: o9("notGiven"), tone: "plain" };
  return { label, value, tone: notSure ? "notSure" : "plain" };
}

/** Where a new place is, in words: the address typed, the building's address with where in it, or a pin with a link to see it. */
export function whereRow(where: WhereRecord | null, buildings: ReadonlyMap<string, string>): AnswerRow {
  const label = o9("k.where");
  if (!where) return { label, value: o9("noPlace"), tone: "missing" };
  if (where.kind === "address") return { label, value: `${o9("whereKinds.address")}: ${where.text}`, tone: "plain" };
  if (where.kind === "building") {
    const address = buildings.get(where.rsn);
    const building = address ? t("building", { address }) : t("buildingUnknown", { rsn: where.rsn });
    return { label, value: [building, where.text].filter(Boolean).join(". "), tone: "plain" };
  }
  const lat = where.lat.toFixed(5);
  const lng = where.lng.toFixed(5);
  return {
    label,
    value: t("pinAt", { lat, lng }),
    tone: "plain",
    link: { href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`, label: t("openMap") },
  };
}

/** A correction's changed fields, each with the value the resident gave. */
export function changeRows(changes: CorrectionChanges): AnswerRow[] {
  const rows: AnswerRow[] = [];
  if (changes.name !== undefined) rows.push({ label: o9("k.name"), value: changes.name, tone: "plain" });
  if (changes.where !== undefined) rows.push({ label: o9("k.where"), value: changes.where, tone: "plain" });
  if (changes.phone !== undefined) rows.push({ label: t("phone"), value: changes.phone, tone: "plain" });
  if (changes.web !== undefined) rows.push({ label: t("web"), value: changes.web, tone: "plain" });
  if (changes.cost !== undefined) rows.push({ label: o9("k.cost"), value: costText(changes.cost)!, tone: changes.cost === "notSure" ? "notSure" : "plain" });
  if (changes.idRequired !== undefined) rows.push({ label: o9("k.id"), value: yesNoText(changes.idRequired)!, tone: changes.idRequired === "notSure" ? "notSure" : "plain" });
  if (changes.stepFree !== undefined) rows.push({ label: o9("k.step"), value: yesNoText(changes.stepFree)!, tone: changes.stepFree === "notSure" ? "notSure" : "plain" });
  return rows;
}

/** A new place's answers, in R-19's order. */
export function answerRows(submission: SubmissionRecord, buildings: ReadonlyMap<string, string>): AnswerRow[] {
  return [
    { label: o9("k.type"), value: typeLabel(submission), tone: "plain" },
    { label: o9("k.name"), value: submission.name, tone: "plain" },
    submission.category === null ? { label: o9("k.category"), value: o9("noCat"), tone: "missing" } : { label: o9("k.category"), value: submission.category, tone: "plain" },
    whereRow(submission.location, buildings),
    answer(t("phone"), submission.phone),
    answer(t("web"), submission.web),
    answer(o9("k.cost"), costText(submission.cost), submission.cost === "notSure"),
    answer(o9("k.id"), yesNoText(submission.idRequired), submission.idRequired === "notSure"),
    answer(o9("k.step"), yesNoText(submission.stepFree), submission.stepFree === "notSure"),
    answer(o9("k.langs"), submission.languages && submission.languages.length > 0 ? submission.languages.map(staffLanguageName).join(", ") : null),
  ];
}

/** O-09's "Before you decide": what the reviewer should notice, in words. */
export function reviewChecks(submission: SubmissionRecord): string[] {
  if (submission.kind === "correct") return submission.changes ? [o9("checks.corr", { what: changedWhat(submission.changes) })] : [];
  const checks: string[] = [];
  if (submission.category === null) checks.push(o9("checks.noCat"));
  const notSure = [submission.cost, submission.idRequired, submission.stepFree].filter((value) => value === "notSure").length;
  if (notSure === 1) checks.push(o9("checks.notSureOne"));
  if (notSure > 1) checks.push(o9("checks.notSure", { n: notSure }));
  return checks;
}

/** O-10's reasons: each with what the resident reads (R23's "why", shown here in English) and whether the checks suggest it. */
export function declineReasons(submission: SubmissionRecord): { id: DeclineReason; label: string; line: string; suggested: boolean }[] {
  const flags = submissionFlags(submission);
  const advert = flags.includes("words") || flags.includes("fee");
  return DECLINE_REASONS.map((id) => ({
    id,
    label: o10(`labels.${id}`),
    line: `${o10("theyRead")}${englishText(`R23.reasons.${id}.why`)}`,
    suggested: id === "advert" && advert,
  }));
}

export interface ReviewScreen {
  id: string;
  name: string;
  typeLabel: string;
  from: string;
  meta: string;
  position: string | null;
  /** The one sentence the resident typed, with the language it is in, or null for a correction. */
  wrote: { text: string; lang: string; english: boolean } | null;
  rows: AnswerRow[];
  /** A correction's listed place as the Hub has it now: its rows, or a line saying it is gone. */
  listed: { rows: AnswerRow[]; note: string | null } | null;
  checks: string[];
  kind: SubmissionRecord["kind"];
  status: SubmissionRecord["status"];
  decision: string | null;
  /** O-10's reasons for this suggestion. */
  reasons: ReturnType<typeof declineReasons>;
  /** The next suggestion waiting, for the way on after a decision. */
  next: { href: string; label: string } | null;
}

export function reviewScreen(
  data: { submission: SubmissionRecord; provider: ListedProvider | null; waitingCount: number; position: number | null; next: { id: string; name: string } | null },
  buildings: ReadonlyMap<string, string>,
  now: Date,
): ReviewScreen {
  const { submission, provider } = data;
  const days = waitedDays(submission.createdAt, now);
  const sent = days === 0 ? o9("sentToday") : o9("sent", { age: waitedText(days) });
  const meta = [sent, `${o8("cols.lang")}: ${staffLanguageName(submission.lang)}`, t("refLine", { ref: submission.ref })].join(" · ");
  let listed: ReviewScreen["listed"] = null;
  if (submission.kind === "correct") {
    listed = provider
      ? {
          rows: [
            { label: o9("k.name"), value: `${provider.name} (${provider.id})`, tone: "plain" },
            answer(o9("k.where"), provider.street),
            answer(t("phone"), provider.phone),
            answer(t("web"), provider.web),
          ],
          note: provider.published ? null : t("unpublished"),
        }
      : { rows: [], note: t("providerGone") };
  }
  return {
    id: submission.id,
    name: submission.name,
    typeLabel: typeLabel(submission),
    from: o9("fromRes"),
    meta,
    position: data.position === null ? null : o9("position", { i: data.position, n: data.waitingCount }),
    wrote: submission.what ? { text: submission.what, lang: submission.lang, english: submission.lang === "en" } : null,
    rows: submission.kind === "correct" ? changeRows(submission.changes ?? {}) : answerRows(submission, buildings),
    listed,
    checks: reviewChecks(submission),
    kind: submission.kind,
    status: submission.status,
    decision: submission.status === "pending" ? null : decisionText(submission),
    reasons: declineReasons(submission),
    next: data.next ? { href: reviewHref(data.next.id), label: o9("next", { name: data.next.name }) } : null,
  };
}
