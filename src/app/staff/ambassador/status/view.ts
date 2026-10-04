// What an ambassador's post status screen shows (A-03, S08.04): the view model, with every text already resolved from the English catalog, so the components that
// draw it (StatusBody.tsx, FollowForms.tsx) know none of the catalog. Pure: the page reads the data (../home.ts, the sending progress) and hands it here.
//
// The words are the prototype's A-03 (and A-02) where it has them and the pilot's own where the pilot differs (staff.ambassadorStatus): where the post stands
// ("Live. Not yet verified", "Waiting for the Hub", "Approved", "Returned to you" with the Hub's note, "Withdrawn"), once approved how its texts are going
// (waiting, on their way, delivered, not delivered), what residents read instead when it was corrected or withdrawn, and the three things the ambassador may
// do: correct or withdraw their own post that residents already read, and mark the alert resolved. Each goes to the Hub for a second person's approval.
import { ALERT_TEXT_MAX } from "@/contracts/alertContent";
import type { AmbassadorPostState, AmbassadorPostStatus } from "@/modules/alerting";
import { englishText } from "@/i18n/text";
import { formatTorontoDateTime } from "@/platform/clock";
import { typeName } from "../../alerts/typeNames";
import { AMBASSADOR_HOME, catalogText, statusHref, type Text } from "../post/view";

/** The text screens of this story use the post screen's catalog reader. */
export { catalogText, type Text };

export { STATUS_PAGE, statusHref } from "../post/view";
export const RESOLVE_PAGE = "/staff/ambassador/resolve";
export const resolveHref = (alertId: string): string => `${RESOLVE_PAGE}?${new URLSearchParams({ alert: alertId }).toString()}`;
/** The page residents read an alert on (R-07). */
export const residentAlertHref = (slug: string): string => `/en/alerts/${slug}`;

/** The reasons a withdrawal can give, in the catalog's order (alerting's `WITHDRAWAL_REASONS`; a test keeps the two equal). */
export const FOLLOW_REASONS = ["wrong_place", "wrong_information", "duplicate", "other"] as const;

/** What became of the texts of an approved post, from messaging's counts for the entry. */
export interface TextCounts {
  waiting: number;
  inFlight: number;
  delivered: number;
  undelivered: number;
  failed: number;
  unknown: number;
  cancelled: number;
  skipped: number;
}

export interface StatusData {
  status: AmbassadorPostStatus;
  /** The address of each building (rsn) the person is assigned to. */
  addresses: ReadonlyMap<string, string>;
  /** The label of each floor (by floor id) of the buildings above. */
  floorLabels: ReadonlyMap<string, string>;
  /** The texts' counts once the post is approved; null before. */
  counts: TextCounts | null;
  /** The ids the follow-up entries take, made when the page was drawn: a press sent again names the same one. */
  ids: { correct: string; withdraw: string; resolve: string };
}

/** The words and fields of the three forms (the client component draws them). */
export interface FollowWords {
  required: string;
  text: { max: number; hint: string };
  phase: { legend: string; problem: string; progress: string; error: string };
  valid: { legend: string; resolved: string; at: string; date: string; time: string; hint: string };
  correct: { open: string; lead: string; label: string; button: string };
  withdraw: { open: string; lead: string; reason: string; reasons: { id: string; label: string }[]; words: string; button: string; reasonError: string };
  resolve: { open: string; lead: string; label: string; button: string };
  status: { unsent: string; unsentClose: string; sending: string };
  sent: { title: string; line: string; live: string; resolve: string };
  /** The words for each refusal or failure code, and the one for anything else. */
  errors: Readonly<Record<string, string>> & { fallback: string; signedOut: string; notAssigned: string };
  textErrors: { empty: string; tooLong: string; valid: string };
}

export interface FollowScreen {
  alertId: string;
  /** The post that is corrected or withdrawn; null on the resolve page. */
  postId: string | null;
  correct: { entryId: string; phase: "problem" | "in_progress"; text: string } | null;
  withdraw: { entryId: string } | null;
  resolve: { entryId: string } | null;
  back: { href: string; label: string };
  words: FollowWords;
}

export interface StatusScreen {
  title: string;
  back: { href: string; label: string };
  state: { id: AmbassadorPostState; title: string; body: string; sub: string | null; note: string | null; hold: boolean };
  /** What is waiting for the Hub besides the post itself: a correction or a withdrawal of it, a final message of the alert. */
  waiting: string[];
  /** The texts' progress, once approved. */
  progress: null | { title: string; none: string | null; lines: { id: "waiting" | "inFlight" | "delivered" | "failed"; n: number; text: string }[]; hint: string | null };
  yours: { title: string; types: string; floors: string; text: string; meta: string[]; residents: { href: string; label: string } };
  follow: FollowScreen | null;
}

const own = (t: Text) => (key: string, values?: Record<string, string | number>) => t(`staff.ambassadorStatus.${key}`, values);

/** The words of the three forms and of every refusal they can meet. Shared by the status page and the resolve page. */
export function followWords(t: Text = catalogText): FollowWords {
  const s = own(t);
  const failed = t("A02.errFailed");
  const notAssigned = t("A02.errNotAssigned");
  return {
    required: t("A02.required"),
    text: { max: ALERT_TEXT_MAX, hint: t("A02.textHint", { max: ALERT_TEXT_MAX }) },
    phase: { legend: t("A02.phaseTitle"), problem: t("A02.phaseProblem"), progress: t("A02.phaseProgress"), error: t("A02.errPhase") },
    valid: { legend: t("A02.validTitle"), resolved: t("A02.validResolved"), at: t("A02.validAt"), date: t("A02.dateLabel"), time: t("A02.timeLabel"), hint: t("A02.validHint") },
    correct: { open: s("correctOpen"), lead: s("correctLead"), label: t("A02.textLabel"), button: s("correctButton") },
    withdraw: {
      open: s("withdrawOpen"),
      lead: s("withdrawLead"),
      reason: s("withdrawReason"),
      reasons: FOLLOW_REASONS.map((id) => ({ id, label: t(`staff.correct.reasons.${id}`) })),
      words: s("withdrawWords"),
      button: s("withdrawButton"),
      reasonError: s("errors.WITHDRAWAL_REASON_INVALID"),
    },
    resolve: { open: s("resolveOpen"), lead: s("resolveLead"), label: s("resolveLabel"), button: s("resolveButton") },
    status: { unsent: t("A02.unsent"), unsentClose: t("A02.unsentClose"), sending: t("A02.sending") },
    sent: { title: s("sent"), line: s("sentLine"), live: s("sentLive"), resolve: s("sentResolve") },
    textErrors: { empty: t("A02.errText"), tooLong: t("A02.errTextLong", { max: ALERT_TEXT_MAX }), valid: t("A02.errValid") },
    errors: {
      fallback: failed,
      signedOut: t("A02.errSignedOut"),
      notAssigned,
      VALID_UNTIL_INVALID: t("A02.errValid"),
      VALID_UNTIL_SKIPPED: t("A02.errValidSkipped"),
      VALID_UNTIL_PAST: t("A02.errValidPast"),
      VALID_UNTIL_TOO_FAR: t("A02.errValidFar"),
      TEXT_TOO_LONG: t("A02.errTextLong", { max: ALERT_TEXT_MAX }),
      PHASE_INVALID: t("A02.errPhase"),
      ...Object.fromEntries(
        ["OUT_OF_SCOPE", "NOT_ALLOWED", "AUTHOR_NOT_ALLOWED", "ONE_BUILDING_ONLY", "TARGET_NOT_VALID", "TARGET_SUPERSEDED", "TARGET_NOT_PUBLISHED", "ALERT_CLOSED", "NO_PUBLISHED_ENTRY", "WITHDRAWAL_REASON_INVALID", "TEXT_EMPTY", "TYPES_CHANGED", "DRAFT_CHANGED", "SUBMIT_IN_PROGRESS", "ONCALL_REQUIRED"].map(
          (code) => [code, s(`errors.${code}`)],
        ),
      ),
    },
  };
}

/** The four counts a post's texts are told in (waiting, on their way, delivered, not delivered). Cancelled and skipped texts never went and are no part of it. */
export function progressLines(counts: TextCounts, t: Text = catalogText): NonNullable<StatusScreen["progress"]>["lines"] {
  const s = own(t);
  const failed = counts.failed + counts.undelivered + counts.unknown;
  return [
    { id: "waiting", n: counts.waiting, text: s("progressWaiting", { n: counts.waiting }) },
    { id: "inFlight", n: counts.inFlight, text: s("progressInFlight", { n: counts.inFlight }) },
    { id: "delivered", n: counts.delivered, text: s("progressDelivered", { n: counts.delivered }) },
    { id: "failed", n: failed, text: s("progressFailed", { n: failed }) },
  ];
}

/** The line that says which floors of the building a post is for. */
function floorsLine(status: AmbassadorPostStatus, data: Pick<StatusData, "addresses" | "floorLabels">, t: Text): string {
  return status.buildings
    .map((building) => {
      const address = data.addresses.get(building.rsn) ?? building.rsn;
      if (building.floors === null) return `${address}: ${t("A03.floorsAll").toLowerCase()}`;
      const labels = building.floors.map((id) => data.floorLabels.get(id) ?? "").filter((label) => label !== "");
      return `${address}: ${labels.length === 1 ? t("A03.floorsOne", { a: labels[0] }).toLowerCase() : `${t("A02.listLabel").toLowerCase()} ${labels.join(", ")}`}`;
    })
    .join("; ");
}

/** Where the post stands, in the screen's words: the title, what it means and what the Hub wrote, if anything. */
function stateOf(status: AmbassadorPostStatus, t: Text): StatusScreen["state"] {
  const s = own(t);
  const at = (date: Date | null) => (date === null ? "" : formatTorontoDateTime(date));
  switch (status.state) {
    case "live":
      return { id: "live", title: t("A03.states.live"), body: s("liveBody"), sub: t("A03.when", { t: at(status.postedAt) }), note: null, hold: false };
    case "waiting":
      return { id: "waiting", title: t("A03.waitingTitle"), body: s("waitingBody"), sub: t("A03.when", { t: at(status.postedAt) }), note: null, hold: true };
    case "approved":
    case "verified":
      return { id: status.state, title: s("approvedTitle"), body: s("approvedBody", { t: at(status.approvedAt) }), sub: null, note: null, hold: false };
    case "returned":
      return { id: "returned", title: s("returnedTitle"), body: s("returnedBody"), sub: null, note: status.note === null ? null : s("returnedNote", { note: status.note }), hold: true };
    case "withdrawn":
      return {
        id: "withdrawn",
        title: s("withdrawnTitle"),
        body: s("withdrawnBody"),
        sub: status.replacedWith === null ? null : `${t("A03.takenDown", { t: at(status.replacedWith.at) })}.`,
        note: status.replacedWith === null ? null : s("withdrawnNotice", { text: status.replacedWith.text }),
        hold: true,
      };
    case "corrected":
      return {
        id: "corrected",
        title: s("correctedTitle"),
        body: s("correctedBody"),
        sub: status.replacedWith === null ? null : t("A03.correctedWhen", { t: at(status.replacedWith.at) }),
        note: status.replacedWith === null ? null : s("correctedNotice", { text: status.replacedWith.text }),
        hold: false,
      };
    case "declined":
      return { id: "declined", title: t("A03.declinedTitle"), body: s("declinedBody"), sub: null, note: null, hold: true };
    case "ended":
      return { id: "ended", title: t("A03.declinedTitle"), body: t("A03.states.ended"), sub: null, note: null, hold: true };
  }
}

export function statusScreen(data: StatusData, t: Text = catalogText): StatusScreen {
  const { status } = data;
  const s = own(t);
  const waiting: string[] = [];
  if (status.waitingReplacement !== null) waiting.push(status.waitingReplacement.kind === "withdrawal" ? s("waitingWithdrawal") : s("waitingCorrection"));
  if (status.waitingFinal) waiting.push(s("waitingFinal"));
  const approved = status.state === "approved" || status.state === "verified";
  const lines = data.counts === null || !approved ? null : progressLines(data.counts, t);
  const texts = lines === null ? 0 : lines.reduce((sum, line) => sum + line.n, 0);
  const canFollow = status.can.replace || status.can.resolve;
  const back = { href: AMBASSADOR_HOME, label: t("A03.toHome") };
  return {
    title: s("title"),
    back,
    state: stateOf(status, t),
    waiting,
    progress:
      lines === null
        ? null
        : { title: s("progressTitle"), none: texts === 0 ? s("progressNone") : null, lines: texts === 0 ? [] : lines, hint: texts === 0 ? null : s("progressFailedHint") },
    yours: {
      title: s("yourUpdate"),
      types: status.types.map(typeName).join(", "),
      floors: floorsLine(status, data, t),
      text: status.text,
      meta: [
        s("postedAt", { time: formatTorontoDateTime(status.postedAt) }),
        s("untilLine", { time: formatTorontoDateTime(status.validUntil) }),
        s("phaseLine", { phase: status.phase === "in_progress" ? t("A02.phaseProgress") : t("A02.phaseProblem") }),
        t("A02.appearsAs", { building: status.buildings.map((building) => data.addresses.get(building.rsn) ?? building.rsn).join(", ") }),
      ],
      residents: { href: residentAlertHref(status.slug), label: s("seeResidents") },
    },
    follow: canFollow
      ? {
          alertId: status.alertId,
          postId: status.entryId,
          correct: status.can.replace ? { entryId: data.ids.correct, phase: status.phase === "in_progress" ? "in_progress" : "problem", text: status.text } : null,
          withdraw: status.can.replace ? { entryId: data.ids.withdraw } : null,
          resolve: status.can.resolve ? { entryId: data.ids.resolve } : null,
          back: { href: statusHref(status.entryId), label: s("backToUpdate") },
          words: followWords(t),
        }
      : null,
  };
}

/** The data of the resolve page ("Mark resolved" for an alert about the person's building). */
export interface ResolveData {
  alertId: string;
  /** The English text that covers the alert now. */
  headline: string;
  /** Whether a final message for the alert already waits for the Hub. */
  waitingFinal: boolean;
  entryId: string;
}

export interface ResolveScreen {
  title: string;
  about: string;
  back: { href: string; label: string };
  /** Set instead of the form while a final message already waits. */
  waiting: string | null;
  follow: FollowScreen | null;
}

export function resolveScreen(data: ResolveData, t: Text = catalogText): ResolveScreen {
  const s = own(t);
  return {
    title: s("resolveTitle"),
    about: s("resolveAbout", { headline: data.headline }),
    back: { href: AMBASSADOR_HOME, label: t("A03.toHome") },
    waiting: data.waitingFinal ? s("resolveWaiting") : null,
    follow: data.waitingFinal
      ? null
      : { alertId: data.alertId, postId: null, correct: null, withdraw: null, resolve: { entryId: data.entryId }, back: { href: AMBASSADOR_HOME, label: t("A03.toHome") }, words: followWords(t) },
  };
}

/** Not found: the entry is not theirs to see, is a drill's, or is gone. */
export const notFoundScreen = (t: Text = catalogText): { text: string; back: { href: string; label: string } } => ({
  text: englishText("staff.ambassadorStatus.notFound"),
  back: { href: AMBASSADOR_HOME, label: t("A03.toHome") },
});
