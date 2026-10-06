// What "My round" says (A-04, S08.07): every text resolved from the English catalog (the staff surface's language in the pilot), so the page that draws it
// (RoundPage.tsx, a client component) knows none of the catalog. Placeholders the page fills itself (`{headline}`, `{n}`, `{phone}`, ...) are kept, and
// filled with `fill`. Pure and browser-safe once built.
//
// The words are the prototype's A-04 (the title, "For: {headline}", the tally, the floors, the three marks, "no round right now", what is kept when the
// disruption closes) and the pilot's own `staff.round` strings: the marks wait in the open page, never "saved on your phone", and what a late mark is told.
import { HUB_PHONE_E164 } from "@/contracts/hubNumber.generated";
import { displayPhone } from "@/contracts/phone";
import type { StaffRole } from "@/contracts/staffRoles";
import { englishText } from "@/i18n/text";
import { AMBASSADOR_HOME } from "../post/view";

export { fill } from "../post/view";

const slot = (name: string) => `{${name}}`;
const t = (key: string, values?: Record<string, string | number>) => englishText(key, values);

export interface RoundScreen {
  title: string;
  /** Who sees what: an Ambassador's floors, an Admin's every request, or counts only (a Coordinator, a Director). */
  lead: string;
  forAlert: string;
  tally: string;
  floor: string;
  /** An Ambassador's floor seen as counts only says why; a Coordinator's or a Director's lead says it once (null). */
  countsNote: string | null;
  marks: { done: string; not_reached: string; needs_help: string };
  marked: string;
  marksFor: string;
  call: string;
  text: string;
  methodWord: { call: string; text: string };
  noRound: string;
  deleted: string;
  loading: string;
  offline: string;
  waitingOne: string;
  waitingMany: string;
  keepOpen: string;
  notSent: string;
  notes: { hub_told: string; request_ended: string; mark_failed: string };
  /** "This round has ended. If someone needs help, call the Hub at {number}": the words around the number, which is a `tel:` link. */
  roundEnded: { before: string; after: string };
  hub: { href: string; label: string };
  reload: string;
  reloadButton: string;
  signedOut: string;
  loadFailed: string;
  home: { href: string; label: string };
}

/** The screen's words for this person's role. */
export function roundScreen(role: StaffRole): RoundScreen {
  const ended = t("staff.round.roundEnded", { number: slot("number") });
  const [before = "", after = ""] = ended.split(slot("number"));
  return {
    title: t("A04.title"),
    lead: role === "admin" ? t("staff.round.leadAdmin") : role === "ambassador" ? t("staff.round.lead") : t("staff.round.leadCounts"),
    forAlert: t("A04.forAlert", { headline: slot("headline") }),
    tally: t("A04.tally", { todo: slot("todo"), done: slot("done"), nr: slot("nr"), help: slot("help") }),
    floor: t("A04.floorN", { n: slot("n") }),
    countsNote: role === "ambassador" ? t("staff.round.countsNote") : null,
    marks: { done: t("A04.done"), not_reached: t("A04.notReached"), needs_help: t("A04.needsHelp") },
    marked: t("staff.round.marked", { mark: slot("mark") }),
    marksFor: t("staff.round.marksFor", { phone: slot("phone") }),
    call: t("staff.round.call", { phone: slot("phone") }),
    text: t("staff.round.text", { phone: slot("phone") }),
    methodWord: { call: t("A04.methodWord.call"), text: t("A04.methodWord.text") },
    noRound: t("A04.noRound"),
    deleted: t("A04.deleted"),
    loading: t("staff.round.loading"),
    offline: t("staff.round.offline"),
    waitingOne: t("staff.round.waitingOne"),
    waitingMany: t("staff.round.waitingMany", { n: slot("n") }),
    keepOpen: t("staff.round.keepOpen"),
    notSent: t("staff.round.notSent"),
    notes: { hub_told: t("staff.round.hubTold"), request_ended: t("staff.round.requestEnded"), mark_failed: t("staff.round.markFailed") },
    roundEnded: { before, after },
    hub: { href: `tel:${HUB_PHONE_E164}`, label: displayPhone(HUB_PHONE_E164) },
    reload: t("staff.round.reload"),
    reloadButton: t("staff.round.reloadButton"),
    signedOut: t("staff.round.signedOut"),
    loadFailed: t("staff.round.loadFailed"),
    home: { href: AMBASSADOR_HOME, label: t("A03.toHome") },
  };
}

/** The link a request's number is: `tel:` for a call, `sms:` for a text, on the number in E.164. */
export const contactHref = (method: "call" | "text", phone: string): string => `${method === "call" ? "tel" : "sms"}:${phone}`;
