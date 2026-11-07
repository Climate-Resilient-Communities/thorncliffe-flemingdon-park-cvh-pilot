import { IntlErrorCode, NextIntlClientProvider, type AbstractIntlMessages, type IntlError } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import { AddPlaceFlow, CorrectPlace, SubmissionStatusPage, type RulesTexts } from "@/ui/places";
import { SentPanel } from "@/ui/places/parts";
import { PLACES_NAMESPACES } from "./namespaces";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

// The place screens render with only the catalog parts their pages hand them (PLACES_NAMESPACES): a key outside them would throw here, as it
// would on the phone. The first render is what the server prerenders: R-17 for adding, and the loading states of the two others.
/** A key the catalog parts lack fails the test; the time-zone notice of a server-side render does not. */
const failOnMissing = (error: IntlError) => {
  if (error.code === IntlErrorCode.MISSING_MESSAGE) throw error;
};
const only = (messages: Record<string, unknown>) => Object.fromEntries(PLACES_NAMESPACES.map((namespace) => [namespace, messages[namespace]]));
const wrap = (lang: "en" | "ur", node: ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={lang} messages={only(lang === "ur" ? ur : en) as AbstractIntlMessages} onError={failOnMissing}>
      {node}
    </NextIntlClientProvider>,
  );
const rulesOf = (messages: { x03: RulesTexts }): RulesTexts => messages.x03;
const RULES = { en: rulesOf(en as unknown as { x03: RulesTexts }), ur: rulesOf(ur as unknown as { x03: RulesTexts }) };

describe("the place screens' catalog parts (PRD §6.3)", () => {
  it("open on R-17 with the two ways and the rules link, in English and in Urdu", () => {
    const html = wrap("en", <AddPlaceFlow lang="en" tiles={null} rules={RULES} />);
    expect(html).toContain("Add or correct a place");
    expect(html).toContain("Add a place that is missing");
    expect(html).toContain("Correct a place that looks wrong");
    expect(html).toContain('href="/en/map"');
    expect(wrap("ur", <AddPlaceFlow lang="ur" tiles={null} rules={RULES} />)).toContain((ur as { R17: { title: string } }).R17.title);
  });

  it("draw R-22 and R-23 while the release and the decision load", () => {
    expect(wrap("en", <CorrectPlace lang="en" id="M001" rules={RULES.en} />)).toContain("Loading the directory");
    expect(wrap("en", <SubmissionStatusPage lang="en" code="SEED-2A2A" />)).toContain("SEED-2A2A");
  });

  it("draw R-21 with the general lane, the week, the reference code and the way to see the decision", () => {
    const html = wrap("ur", <SentPanel lang="ur" title="t" lead="" code="SEED-2A2A" actions={null} />);
    expect(html).toContain('href="/ur/places/submitted/SEED-2A2A"');
    expect(html).toContain((ur as { places: { sentLine: string } }).places.sentLine);
    const en21 = wrap("en", <SentPanel lang="en" title="Sent to the Hub" lead="You sent: Food bank" code="SEED-2A2A" actions={null} />);
    expect(en21).toContain("Review path: Community review");
    expect(en21).toContain("About a week");
    expect(en21).toContain("Your reference");
  });
});
