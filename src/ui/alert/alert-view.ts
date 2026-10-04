// What a resident reads of an alert (R-03's card, R-07, R-28), worked out from the feed's thread as a pure function: the words come from
// the catalog through `t`, the times from the feed's own `server_now` (never the phone's clock), and nothing here is drawn. The components
// (alert-card.tsx, alert-detail.tsx, verified-explainer.tsx) only draw it, so the rules below are unit tests (alert-view.test.ts):
//  - the words of the type (X-13), the origin and verification (X-02) and the machine-translation label (X-04) are the catalog's, in the same
//    words wherever they appear;
//  - a text that is English standing in for a translation that failed (`fallback_en`) is set left to right in English and says so, in the
//    resident's language ("Not yet available in this language"); a machine translation carries its label and "Read it in English";
//  - the attribution is the Hub's whole sentence (R04.fromHub): "the Hub" is never joined to a preposition word by word (spine AD-21);
//  - a correction is shown above the entry it replaces, which stays readable and is marked "Corrected"; a withdrawn entry is marked "Withdrawn" and shows
//    the reason in its place, and the withdrawal notice is not an entry of its own (S05.02). What is true now (`current`, the card, the share preview) is the
//    latest entry that was neither corrected nor withdrawn, so the feed, the alert and the preview always say the same.
import { entriesNewestFirst, type FeedThread } from "@/contracts/feed";
import { isLaunchCode, languageOf, type LaunchCode } from "@/i18n/languages";
import { agoText } from "../home/feed-poll";
import { guideDuringHref, guidesFor } from "./guides";
import { validUntilLine, type Translate } from "./times";

export type { Translate } from "./times";

type FeedEntry = FeedThread["entries"][number];

/** The disruption types of the pilot (X-13); a type the catalog has no word for is read as "Other". */
export const TYPE_IDS = ["fire", "power", "water", "elevator", "flood", "heat", "smoke", "winter", "other"] as const;

export interface TypeView {
  id: (typeof TYPE_IDS)[number];
  word: string;
}

export interface TextView {
  body: string;
  /** The language the text is in, for `lang`: English for a fallback, whatever the page's language is. */
  lang: string;
  /** Left to right for English, the language's own direction for a translation. */
  dir: "ltr" | "rtl";
  /** English standing in for a translation that failed or was never made: set in English, with the note that says so. */
  fallback: boolean;
  /** A machine translation: it carries the label and "Read it in English". */
  machine: boolean;
}

export interface OriginView {
  /** "Community alert from the Hub": the Hub's whole sentence. */
  attribution: string;
  verified: boolean;
  /** "Verified by the Hub" or "Not yet verified": the same words on every surface (FR-A5). */
  verification: string;
  whatMeans: string;
}

/** What happened to an entry residents read earlier (S05.02): it was corrected (its wording stays readable) or withdrawn (the reason stands in its place). */
export interface EntryMark {
  kind: "corrected" | "withdrawn";
  /** "Corrected 5 minutes ago" or "Withdrawn". */
  label: string;
}

/**
 * How a thread that closed ended (S05.03, R-07): the three reasons each have words and an icon of their own, so "Resolved", "Expired" and "Withdrawn" are never read as
 * one another. The icon only sits beside the words, it never carries the meaning alone.
 */
export interface ClosedView {
  reason: "resolved" | "expired" | "withdrawn";
  /** The alert-icons.css mark: a check for resolved, a clock for expired, an information mark for withdrawn. */
  icon: "check" | "clock" | "info";
  /** "Resolved 5 minutes ago", "Expired 5 minutes ago", "Withdrawn". */
  title: string;
  /** The sentence: "This alert has ended. It was resolved 5 minutes ago.", the withdrawal with its reason. */
  line: string;
}

export interface EntryView {
  id: string;
  /** The kind of entry as the feed has it. */
  kind: FeedEntry["kind"];
  /** The catalog's name for the kind of entry ("First message", "Update", ...). */
  kindLabel: string;
  /** Set on an entry a later correction or withdrawal replaced; null on every entry that still stands. */
  mark: EntryMark | null;
  /** "10 minutes ago", from the feed's clock. */
  time: string;
  /** The phase the entry reported ("Active problem", "Work in progress"), in the catalog's status words; null where it reported none. */
  phase: string | null;
  text: TextView;
  /** The English the entry was written in, for "Read it in English"; null where the text is English already or it is not a machine translation. */
  english: string | null;
}

export interface AlertView {
  slug: string;
  types: TypeView[];
  /** The latest entry that was neither corrected nor withdrawn: what is true now. */
  current: EntryView;
  origin: OriginView;
  /** "Posted 10 minutes ago" or "Posted 10 minutes ago · Updated 2 minutes ago". */
  times: string;
  /** The home card's one time line, as the prototype's R-03 card has it: "Posted 10 minutes ago" for one entry, "Updated 2 minutes ago" once there is an update. */
  cardTime: string;
  /** "Valid until today at 3:00 p.m.", or null when the time has passed. */
  valid: string | null;
  /** The thread's valid-until (ISO) and the feed's own clock when this was read (ISO): with them a phone with no signal says "may have ended" once the time passes (S05.07). */
  validUntil: string;
  serverNow: string;
  /** "This alert may have ended. Check again when you have signal": said instead of the valid-until line (and of the card's "current" look) once a kept copy's time has passed. */
  mayHaveEnded: string;
  /** Said when the alert's time has passed and the thread is not closed yet: "This alert reached its end time without a final update." */
  ended: string | null;
  /** Set when the thread closed (S05.03): how, and when; the alert is then no longer valid or live, and its final message is the entry on top. Null for an open thread. */
  closed: ClosedView | null;
  /** "Not yet available in this language". */
  unavailableTitle: string;
  /** "This has not been translated into اردو yet." */
  unavailableBody: string;
  /** "Read it in English". */
  showEnglish: string;
  /** "Original (English)". */
  originalLabel: string;
  /** The label and its "from English": the machine-translation mark (X-04). */
  machineLabel: string;
  machineFrom: string;
  guides: { id: string; label: string; href: string }[];
  /** Every entry, newest first (R-07's "Updates, newest first"); more than one only once the thread has an update. A withdrawal notice is not among them. */
  entries: EntryView[];
  /** The share preview (S05.08 builds the link): the title and description a shared link shows, from `current`, so it says what the alert says. */
  preview: { title: string; description: string };
}

/** The longest description a link preview carries. */
const PREVIEW_MAX = 200;

const ENGLISH = languageOf("en");

/** The catalog's `x13` word for a type; "Other" for a type it has no word for. */
function typeOf(id: string, t: Translate): TypeView {
  const known = (TYPE_IDS as readonly string[]).includes(id) ? (id as TypeView["id"]) : "other";
  return { id: known, word: t(`x13.${known}`) };
}

/** `lang` and direction of a text: English reads as English, left to right; a translation as the language it is in. */
function textOf(entry: FeedEntry): TextView {
  const { text } = entry;
  const fallback = text.status === "fallback_en";
  if (fallback || text.lang === "en") return { body: text.body, lang: "en", dir: "ltr", fallback, machine: false };
  const language = isLaunchCode(text.lang) ? languageOf(text.lang) : undefined;
  return { body: text.body, lang: language?.bcp47 ?? text.lang, dir: language?.dir ?? "ltr", fallback: false, machine: text.machine };
}

/**
 * One entry as the screens draw it. `replacedBy` is the correction or withdrawal that replaced it, when there is one (S05.02): a corrected entry keeps its own
 * wording and is marked "Corrected" with the time of the correction; a withdrawn entry is marked "Withdrawn" and its text is the reason (the withdrawal's own
 * words, in the resident's language), the wording it had no longer being shown as something to act on.
 */
function entryOf(entry: FeedEntry, serverNow: Date, t: Translate, replacedBy?: FeedEntry): EntryView {
  const withdrawal = replacedBy?.kind === "withdrawal" ? replacedBy : undefined;
  const shown = withdrawal ?? entry;
  const text = textOf(shown);
  // A withdrawal notice is never an entry of the list, so its kind is only reached through the screens that name it.
  const kinds: Record<string, string> = { ack: "ack", update: "update", correction: "correction", final: "final", withdrawal: "update" };
  const timeT: Translate = (key, values) => t(`time.${key}`, values);
  const ago = (iso: string) => agoText(serverNow.getTime() - new Date(iso).getTime(), timeT);
  const mark: EntryMark | null = !replacedBy
    ? null
    : withdrawal
      ? { kind: "withdrawn", label: t("R07.withdrawn") }
      : { kind: "corrected", label: t("R07.corrected", { t: ago(replacedBy.published_at) }) };
  return {
    id: entry.id,
    kind: entry.kind,
    kindLabel: t(`R07.kinds.${kinds[entry.kind] ?? "update"}`),
    mark,
    time: ago(entry.published_at),
    phase: entry.phase === "problem" ? t("status.active") : entry.phase === "in_progress" ? t("status.progress") : null,
    text,
    english: text.machine ? shown.original.body : null,
  };
}

/** The origin and verification of an entry (X-02): who sent it, and whether the Hub checked it. */
export function originOf(entry: Pick<FeedEntry, "attribution" | "verified">, t: Translate): OriginView {
  return {
    // Only the Hub posts in this epic. An ambassador's post (E08) will be attributed to its building from the feed's `rsn`; until then a role
    // this page does not know is "a community alert", with no name of anyone.
    attribution: entry.attribution.role === "hub" ? t("R04.fromHub") : t("x02.levelCommunity"),
    verified: entry.verified,
    verification: entry.verified ? t("x02.verifiedBy", { org: t("x02.hub") }) : t("x02.notYetVerified"),
    whatMeans: t("x02.whatMeans"),
  };
}

/** How a closed thread ended, in words: the time is the closing entry's (the final, or the withdrawal notice), the newest entry of a thread nothing can be added to. */
function closedOf(thread: FeedThread, serverNow: Date, t: Translate): ClosedView | null {
  if (thread.state !== "closed") return null;
  const timeT: Translate = (key, values) => t(`time.${key}`, values);
  const newest = entriesNewestFirst(thread.entries)[0];
  const when = agoText(serverNow.getTime() - new Date(newest.published_at).getTime(), timeT);
  switch (thread.close_reason) {
    case "resolved":
      return { reason: "resolved", icon: "check", title: t("R07.resolvedTitle", { t: when }), line: t("R07.endedResolved", { t: when }) };
    case "expired":
      return { reason: "expired", icon: "clock", title: t("R07.expiredTitle", { t: when }), line: t("R07.endedExpired", { t: when }) };
    case "withdrawn": {
      // The reason is the withdrawal notice's own words, in the resident's language.
      const notice = entriesNewestFirst(thread.entries).find((entry) => entry.kind === "withdrawal");
      return { reason: "withdrawn", icon: "info", title: t("R07.withdrawn"), line: t("R07.endedWithdrawn", { reason: notice?.text.body ?? "" }) };
    }
    default:
      return null;
  }
}

/**
 * The view of a thread for a reader of `lang`. `serverNow` is the feed's `server_now`: every "ago" and the comparison with the valid-until
 * are measured against it, so a phone with a wrong clock reads the same words as everyone else.
 */
export function alertView(thread: FeedThread, input: { lang: LaunchCode; serverNow: Date; t: Translate }): AlertView {
  const { lang, serverNow, t } = input;
  const timeT: Translate = (key, values) => t(`time.${key}`, values);
  const language = languageOf(lang);
  // The feed carries the entries oldest first and does not refuse an order; R-07 reads them newest first, by their own times (S05.01).
  // A withdrawal notice is the reason shown on the entry it withdrew, never an entry of its own; a correction replaces the entry it names (S05.02).
  const replacers = new Map<string, FeedEntry>();
  for (const entry of thread.entries) if (entry.supersedes_id !== undefined) replacers.set(entry.supersedes_id, entry);
  const visible = entriesNewestFirst(thread.entries.filter((entry) => entry.kind !== "withdrawal"));
  const newestFirst = visible.length > 0 ? visible : entriesNewestFirst(thread.entries);
  const standing = newestFirst.find((entry) => !replacers.has(entry.id)) ?? newestFirst[0];
  const latest = newestFirst[0];
  const first = newestFirst[newestFirst.length - 1];
  const ago = (iso: string) => agoText(serverNow.getTime() - new Date(iso).getTime(), timeT);
  const times =
    newestFirst.length > 1 ? t("R07.timeLine", { posted: ago(first.published_at), updated: ago(latest.published_at) }) : t("R07.timeLineOne", { posted: ago(first.published_at) });
  const closed = closedOf(thread, serverNow, t);
  // A thread closed withdrawn has nothing that stands any more: what residents read in the place of the entry is the withdrawal's reason, never the wording that was
  // withdrawn (S05.03). Every other thread reads the entry that stands.
  const withdrawnBy = closed?.reason === "withdrawn" ? replacers.get(standing.id) : undefined;
  // A thread that closed is over: it has no valid-until to read, and no "reached its end time" note beside the one that says how it closed.
  const valid = closed ? null : validUntilLine(new Date(thread.valid_until), serverNow, language.bcp47, t);
  const lowerHazard = (guide: string) => t(`hazards.${guide}`).toLocaleLowerCase(language.bcp47);
  return {
    slug: thread.slug,
    types: thread.types.map((type) => typeOf(type, t)),
    current: entryOf(standing, serverNow, t, withdrawnBy),
    origin: originOf(standing, t),
    times,
    cardTime: standing.id !== first.id ? t("R03.updated", { t: ago(standing.published_at) }) : t("R03.posted", { t: ago(first.published_at) }),
    valid,
    validUntil: thread.valid_until,
    serverNow: serverNow.toISOString(),
    mayHaveEnded: t("R07.mayHaveEnded"),
    ended: closed === null && valid === null ? t("R07.expiredNote") : null,
    closed,
    unavailableTitle: t("x04.unavailable"),
    unavailableBody: t("x04.unavailableBody", { lang: language.native }),
    showEnglish: t("x04.showSource", { lang: ENGLISH.native }),
    originalLabel: t("x04.original", { lang: ENGLISH.native }),
    machineLabel: t("x04.label"),
    machineFrom: t("x04.from", { lang: ENGLISH.native }),
    guides: guidesFor(thread.types).map((id) => ({ id, label: t("R07.guide", { hazard: lowerHazard(id) }), href: guideDuringHref(lang, id) })),
    entries: newestFirst.map((entry) => entryOf(entry, serverNow, t, replacers.get(entry.id))),
    preview: previewOf(thread, withdrawnBy ?? standing, t),
  };
}

/**
 * The title and description of a shared link (S05.02; the share action is S05.08): the types' words, and the words of what is true now, so a link to a
 * corrected alert previews the correction and never the wording it replaced. It reads the same `standing` entry as the card and the alert, from the same feed.
 */
function previewOf(thread: FeedThread, standing: FeedEntry, t: Translate): AlertView["preview"] {
  const title = thread.types.map((type) => typeOf(type, t).word).join(", ");
  const words = standing.text.body.replace(/\s+/g, " ").trim();
  const lead = standing.kind === "correction" ? `${t("R07.kinds.correction")}: ${words}` : words;
  const chars = [...lead];
  return { title, description: chars.length > PREVIEW_MAX ? `${chars.slice(0, PREVIEW_MAX - 1).join("")}\u2026` : lead };
}
