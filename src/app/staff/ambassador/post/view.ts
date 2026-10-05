// What an ambassador's post screen shows (A-02, S08.02): the view model, with every text already resolved from the English catalog, so the form that draws it
// (PostForm.tsx, a client component) knows none of the catalog. Pure: the page reads the data (./load.ts) and hands it here.
//
// The words are the prototype's A-02 (and A-01, A-03, X-01) strings: one building of the person's, its floors as a range, a list or the whole building, what
// is happening (the types an Ambassador may post; heat, smoke and winter storm are not offered), where things stand, until when and the English text. The
// attribution residents will read, "Building ambassador, {building}", is shown before Submit, never the person's name. Everything waits for the Hub's second
// person (S08.03 adds the lower-risk posts that residents read at once).
import { BUILDING_TYPES, ALERT_TEXT_MAX } from "@/contracts/alertContent";
import { englishText } from "@/i18n/text";
import { typeName } from "../../alerts/typeNames";

export type Text = (key: string, values?: Record<string, string | number>) => string;

/** The words of the screen: the catalog's, in English (the staff surface's language in the pilot). */
export const catalogText: Text = (key, values) => englishText(key, values);

/** A placeholder the form fills in itself (`fill`), kept as `{name}` in a text resolved here. */
const slot = (name: string) => `{${name}}`;

/** Fills `{name}` placeholders the server left in a text. Pure and browser-safe. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-z]+)\}/gi, (whole, name: string) => (name in values ? String(values[name]) : whole));
}

/** A building the person may post for: one they are assigned to now, with every floor (an Ambassador posts for any floor of an assigned building). */
export interface PostBuilding {
  rsn: string;
  address: string;
  floors: readonly { id: string; label: string }[];
}

/** The thread the post goes in, for an update to an open alert (a practice post in a drill, or an update about an alert): null for a new one. */
export interface PostThread {
  id: string;
  isDrill: boolean;
  /** The English text that covers the thread now. */
  headline: string;
  /** The thread's types: an update keeps them. */
  types: readonly string[];
}

export interface PostData {
  buildings: readonly PostBuilding[];
  thread: PostThread | null;
  /** The ids the post takes, made when the page was drawn: a press sent again names the same ones. */
  ids: { alertId: string; entryId: string };
}

export interface PostScreen {
  title: string;
  /** "You can post updates for any floor of {building}." for one building. */
  lead: string | null;
  back: { href: string; label: string };
  /** The exercise marker of a practice post in a drill; null otherwise. */
  exercise: string | null;
  thread: { id: string; isDrill: boolean; line: string; typesLine: string } | null;
  ids: PostData["ids"];
  buildings: { legend: string; items: readonly PostBuilding[] };
  required: string;
  /** Null for an update: it keeps the thread's types. */
  types: { legend: string; items: { id: string; label: string; more: string | null }[]; notOffered: string; error: string } | null;
  /** The types the post is for when it cannot choose them (an update). */
  fixedTypes: readonly string[];
  other: { not911: { text: string; call: string; short: string }; hint: string; textLabel: string; error: string; phrases: readonly string[] };
  floors: {
    legend: string;
    /** "All {n} floors" with `{n}` left for the form. */
    allLine: string;
    whole: string;
    list: { label: string; line: string };
    range: { label: string; line: string; from: string; to: string; choose: string };
    floorAria: string;
    error: string;
    rangeError: string;
  };
  phase: { legend: string; problem: string; progress: string; error: string };
  valid: { legend: string; resolved: string; at: string; date: string; time: string; hint: string };
  text: { label: string; hint: string; max: number; phrases: readonly string[]; more: string };
  bar: {
    label: string;
    /** "This will appear as: Building ambassador, {building}", `{building}` left for the form. */
    appearsAs: string;
    outcome: string;
    /** "Post update: {floors}", `{floors}` left for the form. */
    button: string;
    wholeWord: string;
    pickOne: string;
    pickRange: string;
    someFloors: string;
  };
  status: { unsent: string; unsentClose: string; sending: string };
  done: {
    title: string;
    line: string;
    home: string;
    another: string;
    anotherHref: string;
    /** S08.04: where the post stands (A-03); null for a practice post, which has no status page. */
    status: { href: string; label: string } | null;
    /** S08.03/S08.04: the words when residents already read it ("Live. Not yet verified"); null for a practice post. */
    live: { title: string; line: string } | null;
  };
  /** The words for each refusal or failure code, and the one for anything else. */
  errors: Readonly<Record<string, string>> & { fallback: string; signedOut: string; notAssigned: string };
}

/** The home of an Ambassador (A-01), where "Back" goes. */
export const AMBASSADOR_HOME = "/staff";

/** This screen; with `?alert=` an update to that open alert. */
export const POST_PAGE = "/staff/ambassador/post";
export const postHref = (alertId?: string): string => (alertId ? `${POST_PAGE}?${new URLSearchParams({ alert: alertId }).toString()}` : POST_PAGE);

/** Where a post stands (A-03, S08.04), for the entry named. */
export const STATUS_PAGE = "/staff/ambassador/status";
export const statusHref = (entryId: string): string => `${STATUS_PAGE}?${new URLSearchParams({ entry: entryId }).toString()}`;

export function postScreen(data: PostData, t: Text = catalogText): PostScreen {
  const drill = data.thread?.isDrill === true;
  const types = data.thread === null ? BUILDING_TYPES.map((id) => ({ id, label: typeName(id), more: id === "water" ? t("A02.typeMore.water") : null })) : null;
  const errValidPast = t("A02.errValidPast");
  const errValidFar = t("A02.errValidFar");
  const errFailed = t("A02.errFailed");
  const errNotAssigned = t("A02.errNotAssigned");
  return {
    title: t("A02.title"),
    lead: data.buildings.length === 1 ? t("A01.canPost", { building: data.buildings[0].address }) : null,
    back: { href: AMBASSADOR_HOME, label: t("A03.toHome") },
    exercise: drill ? t("A02.exNote") : null,
    thread:
      data.thread === null
        ? null
        : {
            id: data.thread.id,
            isDrill: drill,
            line: t("A02.inAlert", { headline: data.thread.headline }),
            typesLine: t("A02.typesFixed", { types: data.thread.types.map(typeName).join(", ") }),
          },
    ids: data.ids,
    buildings: { legend: t("A02.building"), items: data.buildings },
    required: t("A02.required"),
    types: types === null ? null : { legend: t("A02.types"), items: types, notOffered: t("A02.notOffered"), error: t("A02.errTypes") },
    fixedTypes: data.thread?.types ?? [],
    other: {
      not911: { text: t("x01.text"), call: t("x01.call"), short: t("x01.short") },
      hint: t("A02.otherFirst"),
      textLabel: t("A02.lineRequired"),
      error: t("A02.errLine"),
      phrases: rawList(t, "A02.otherPhrases"),
    },
    floors: {
      legend: t("A02.floors"),
      allLine: t("A02.allFloorsLine", { n: slot("n") }),
      whole: t("A02.wholeBuilding"),
      list: { label: t("A02.listLabel"), line: t("A02.listLine") },
      range: { label: t("A02.rangeLabel"), line: t("A02.rangeLine"), from: t("A02.fromFloor"), to: t("A02.toFloor"), choose: t("A02.chooseFloor") },
      floorAria: t("A02.floorAria", { n: slot("n") }),
      error: t("A02.errFloors"),
      rangeError: t("A02.errRange"),
    },
    phase: { legend: t("A02.phaseTitle"), problem: t("A02.phaseProblem"), progress: t("A02.phaseProgress"), error: t("A02.errPhase") },
    valid: { legend: t("A02.validTitle"), resolved: t("A02.validResolved"), at: t("A02.validAt"), date: t("A02.dateLabel"), time: t("A02.timeLabel"), hint: t("A02.validHint") },
    text: { label: t("A02.textLabel"), hint: t("A02.textHint", { max: ALERT_TEXT_MAX }), max: ALERT_TEXT_MAX, phrases: rawList(t, "A02.phrases"), more: t("A02.more") },
    bar: {
      label: t("A02.post"),
      appearsAs: t("A02.appearsAs", { building: slot("building") }),
      outcome: drill ? t("A02.exOutcome") : t("A02.waits"),
      button: t("A02.postTo", { floors: slot("floors") }),
      wholeWord: t("A02.wholeWord"),
      pickOne: t("A02.pickOne", { a: slot("a") }),
      pickRange: t("A02.pickRange", { a: slot("a"), b: slot("b") }),
      someFloors: t("A02.listLabel"),
    },
    status: { unsent: t("A02.unsent"), unsentClose: t("A02.unsentClose"), sending: t("A02.sending") },
    done: {
      ...(drill ? { title: t("A03.exerciseTitle"), line: t("A03.exercise") } : { title: t("A03.waitingTitle"), line: t("A03.waiting") }),
      home: t("A03.toHome"),
      another: t("A03.another"),
      anotherHref: postHref(data.thread?.id),
      status: drill ? null : { href: statusHref(data.ids.entryId), label: t("staff.ambassadorStatus.statusLink") },
      live: drill ? null : { title: t("A03.states.live"), line: t("staff.ambassadorStatus.liveBody") },
    },
    errors: {
      fallback: errFailed,
      signedOut: t("A02.errSignedOut"),
      notAssigned: errNotAssigned,
      TEXT_EMPTY: t("A02.errText"),
      TEXT_TOO_LONG: t("A02.errTextLong", { max: ALERT_TEXT_MAX }),
      TYPES_EMPTY: t("A02.errTypes"),
      PHASE_INVALID: t("A02.errPhase"),
      VALID_UNTIL_INVALID: t("A02.errValid"),
      VALID_UNTIL_SKIPPED: t("A02.errValidSkipped"),
      VALID_UNTIL_PAST: errValidPast,
      VALID_UNTIL_TOO_FAR: errValidFar,
      AUDIENCE_EMPTY: t("A02.errFloors"),
      FLOOR_RANGE_REVERSED: t("A02.errRange"),
      FLOOR_RANGE_INCOMPLETE: t("A02.errFloors"),
      OUT_OF_SCOPE: errNotAssigned,
      AUTHOR_NOT_ALLOWED: errNotAssigned,
      ALERT_CLOSED: t("A02.errClosed"),
    },
  };
}

/** A list of phrases in the catalog (A02.phrases): next-intl keeps an array's items as `key.0`, `key.1`, ... */
function rawList(t: Text, key: string): string[] {
  const items: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    try {
      items.push(t(`${key}.${index}`));
    } catch {
      break;
    }
  }
  return items;
}
