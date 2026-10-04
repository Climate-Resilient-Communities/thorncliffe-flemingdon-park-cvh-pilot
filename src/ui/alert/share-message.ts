// The message a resident shares (R-29, S05.08): worked out from the alert's own view and nothing else, as a pure function, so the screen draws what the phone
// sends and a unit test fixes every word. It is always the standard version: it takes the alert as the feed shows it to everyone, and no input about the sharer
// (a building, a group, a floor, a language choice other than the page's), so nothing tailored can enter it. In the prototype's fixed order (R-29's
// `message`): what, where the words came from and whether the Hub checked them (X-02), where, when as clock times (the message is read later, not "5 minutes
// ago"), the not-911 line (X-01) and the link to the newest version. An alert that is not verified says "Not yet verified". A thread that closed says how, and
// a corrected alert says its correction. Nothing here reads a clock, a cookie or the network.
import type { LaunchCode } from "@/i18n/languages";
import { languageOf } from "@/i18n/languages";
import type { AlertView } from "./alert-view";
import { clockPhrase, type Translate } from "./times";

export interface ShareMessage {
  /** The message, a line each, in the page's language: what the preview shows and the phone sends. */
  lines: string[];
  /** The lines joined with line breaks: the one text handed to the share sheet, copied, or put in the WhatsApp link. */
  text: string;
  /** The link in the message, `/a/{slug}?l={lang}` under the public origin. */
  link: string;
  /** `https://wa.me/?text=…`: where the share sheet is not available. */
  whatsapp: string;
}

const SLUG = /^[a-z0-9]{6,16}$/;

/** The link every shared message carries: always the standard alert in its current state, in the sharer's page language (`l`). */
export function shareLink(publicBaseUrl: string, slug: string, lang: LaunchCode): string {
  if (!SLUG.test(slug)) throw new RangeError("An alert slug is 6 to 16 lowercase letters and digits");
  return `${publicBaseUrl.replace(/\/+$/, "")}/a/${slug}?l=${lang}`;
}

/** The WhatsApp link that opens a chat picker with the text filled in (the text is the whole message, link included). */
export const whatsappHref = (text: string): string => `https://wa.me/?text=${encodeURIComponent(text)}`;

export function shareMessage(view: AlertView, input: { lang: LaunchCode; serverNow: Date; t: Translate; link: string }): ShareMessage {
  const { lang, serverNow, t, link } = input;
  const locale = languageOf(lang).bcp47;
  const clock = (iso: string) => clockPhrase(new Date(iso), serverNow, locale, t);
  const types = view.types.map((type) => type.word).join(", ");
  const words = view.current.text.body.replace(/\s+/g, " ").trim();
  const lines: string[] = [`${types}: ${view.current.kind === "correction" ? `${t("R07.kinds.correction")}: ` : ""}${words}`];
  if (view.current.text.fallback) lines.push(view.unavailableTitle);
  else if (view.current.text.machine) lines.push(view.machineLabel);
  if (view.closed !== null && view.stamps.closed !== null) {
    const when = clock(view.stamps.closed);
    lines.push(view.closed.reason === "resolved" ? t("R07.endedResolved", { t: when }) : view.closed.reason === "expired" ? t("R07.endedExpired", { t: when }) : view.closed.line);
  }
  // Who sent it and whether the Hub checked it (X-02), each on its own line and with no punctuation added: a sentence mark of one script is wrong in another.
  lines.push(view.origin.attribution, view.origin.verification);
  if (view.place !== null) lines.push(view.place);
  if (view.closed === null) {
    lines.push(t("R29.postedAt", { t: clock(view.stamps.posted) }));
    if (view.stamps.updated !== null) lines.push(t("R29.updatedAt", { t: clock(view.stamps.updated) }));
  }
  lines.push(t("x01.short"));
  lines.push(t("R29.linkLine", { url: link }));
  const text = lines.join("\n");
  return { lines, text, link, whatsapp: whatsappHref(text) };
}
