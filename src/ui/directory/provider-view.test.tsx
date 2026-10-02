import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildListing } from "../../../e2e/resident/directory-fixture";
import { DirectoryListingV1, type ListingProvider } from "@/contracts/directory";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import { hasFallbackText } from "./directory-browser";
import { Inline911 } from "./listing-text";
import { addressLines, postalText, ProviderView, type CategoryNames } from "./provider-view";

const NBSP = "\u00a0";
const wrap = (lang: "en" | "ur", node: ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={lang} messages={(lang === "ur" ? ur : en) as unknown as AbstractIntlMessages}>
      {node}
    </NextIntlClientProvider>,
  );

const render = (lang: "en" | "ur", id: string, variant: "card" | "page" = "card", change: Partial<ListingProvider> = {}) => {
  const listing = DirectoryListingV1.parse(buildListing(lang, 7));
  const categories: CategoryNames = new Map(listing.categories.map((c) => [c.id, c.name]));
  const provider = { ...listing.providers.find((p) => p.id === id)!, ...change };
  return wrap(lang, <ProviderView provider={provider} categories={categories} lang={lang} variant={variant} />);
};

describe("ProviderView", () => {
  it("shows a provider's categories, contacts, services, emergency role and the day the Hub last confirmed it", () => {
    const html = render("en", "P101");

    expect(html).toContain("Thorncliffe Park Food Bank");
    expect(html).toContain("Food");
    expect(html).toContain("Free groceries every Tuesday and Friday");
    expect(html).toContain("Hands out ready-to-eat food and water during a long power cut.");
    expect(html).toContain("Last confirmed by the Hub September 30, 2026");
    expect(html).toContain('href="tel:+14165550101"');
    expect(html).toContain('href="mailto:food@example.org"');
  });

  it("writes a phone number with displayPhone, as an isolated left-to-right run, in a right-to-left page too", () => {
    for (const lang of ["en", "ur"] as const) {
      const html = render(lang, "P101");
      expect(html).toContain('<bdi dir="ltr" lang="en">(416) 555-0101</bdi>');
      expect(html).toContain('<bdi dir="ltr" lang="en">food@example.org</bdi>');
      expect(html).toContain('<bdi dir="ltr" lang="en">example.org/food-bank</bdi>');
      expect(html).toContain(`<bdi lang="en" dir="ltr">45 Overlea Blvd, Toronto, M4H${NBSP}1K2</bdi>`);
    }
  });

  it("names 911 in How they can help, whatever the emergency role is", () => {
    for (const lang of ["en", "ur"] as const) {
      const html = render(lang, "P104");
      expect(html).toContain('data-testid="how-they-help"');
      expect(html).toContain("911");
      expect(html).toContain(lang === "en" ? "If someone is in danger, call 911." : ur.x01.call);
    }
    expect(render("en", "P104")).toContain("Open as a cooling room during heat warnings. Not a medical service.");
  });

  it("says Not known for a detail the file does not give", () => {
    const html = render("en", "P103");

    expect(html.match(/data-testid="not-known"/g)).toHaveLength(2);
    expect(html).toContain("Not known");
    expect(html).not.toContain('data-testid="how-they-help"');
  });

  it("carries the machine-translation label on machine-translated text, and nowhere in English", () => {
    expect(render("ur", "P101")).toContain('data-testid="machine-label"');
    expect(render("ur", "P101")).toContain(ur.x04.label);
    expect(render("en", "P101")).not.toContain('data-testid="machine-label"');
  });

  it("marks English standing in for a missing translation, with no machine label for it, and no [EN] in the content", () => {
    const html = render("ur", "P105");

    expect(html).toContain('data-translation="unavailable"');
    expect(html).toContain("Help for newcomers: forms, job search and language classes.");
    expect(html).not.toContain("[EN] Help for newcomers");
  });

  it("keeps a postal code in one piece: the space inside it is a non-breaking space, wherever the code is written", () => {
    expect(postalText("M4H 1K2")).toBe(`M4H${NBSP}1K2`);
    expect(postalText(" M3C  1H9 ")).toBe(`M3C${NBSP}1H9`);
    expect(postalText("M4H1K2")).toBe("M4H1K2");
    const location = { street: "1 Main St", city: "East York", lat: 43.7, lng: -79.3 };
    expect(addressLines({ locations: [{ ...location, postal: "M4C 2L3" }, { ...location, postal: null }] })).toEqual([`1 Main St, East York, M4C${NBSP}2L3`, "1 Main St, East York"]);
    expect(render("en", "P102")).toContain(`10 Gateway Blvd, North York, M3C${NBSP}1H9`);
  });

  it("says Not known where the address would be when a provider has no address, and shows no address line", () => {
    const none = render("en", "P103", "card", { locations: [] });
    const blank = render("en", "P103", "card", { locations: [{ street: " ", city: "", postal: null, lat: 43.7, lng: -79.3 }] });

    for (const html of [none, blank]) {
      expect(html).toMatch(/<p class="dir-card__address"><span class="dir-unknown" data-testid="not-known">[\s\S]*?Not known<\/span><\/p>/);
      expect(html.match(/data-testid="not-known"/g)).toHaveLength(3);
    }
    expect(render("en", "P103")).not.toMatch(/dir-card__address"><span class="dir-unknown"/);
  });

  it("describes Read it in English by the provider's name, and makes Original (English) a status", () => {
    for (const variant of ["card", "page"] as const) {
      const html = render("ur", "P101", variant);

      expect(html).toMatch(/<h[12] class="dir-card__name" id="provider-name-P101">/);
      expect(html).toMatch(/<button [^>]*aria-describedby="provider-name-P101"[^>]*data-testid="show-english"/);
      expect(html).toMatch(/<span class="dir-mt__shown" role="status" data-testid="original-shown"><\/span>/);
    }
  });

  it("gives each provider's name its own id, so the buttons of a list each point at their own listing", () => {
    expect(render("ur", "P104")).toContain('id="provider-name-P104"');
    expect(render("ur", "P104")).toContain('aria-describedby="provider-name-P104"');
    expect(render("ur", "P104")).not.toContain("provider-name-P101");
  });

  it("names the neighbourhoods the release lists on the provider's own page, whatever the address says", () => {
    const html = render("en", "P101", "page", { neighbourhood_ids: ["FP", "TP"] });

    expect(html.match(/dir-tag--quiet"><bdi lang="en" dir="ltr">(Thorncliffe Park|Flemingdon Park)<\/bdi>/g)).toHaveLength(2);
    expect(render("en", "P101", "page", { neighbourhood_ids: [] })).not.toMatch(/dir-tag--quiet"><bdi lang="en" dir="ltr">(Thorncliffe Park|Flemingdon Park)/);
  });

  it("is a heading 2 with a link on the list and the heading 1 of its own page", () => {
    expect(render("en", "P101")).toMatch(/<h2[^>]*><a [^>]*href="\/en\/directory\/P101"/);
    expect(render("en", "P101", "page")).toMatch(/<h1[^>]*><bdi/);
  });
});

describe("hasFallbackText", () => {
  it("is true only for a listing in which some text is English standing in for a translation", () => {
    expect(hasFallbackText(DirectoryListingV1.parse(buildListing("ur", 7)))).toBe(true);
    expect(hasFallbackText(DirectoryListingV1.parse(buildListing("en", 7)))).toBe(false);
    expect(hasFallbackText(DirectoryListingV1.parse(buildListing("ur", 7, { drop: ["P105"] })))).toBe(false);
  });
});

describe("Inline911", () => {
  it.each(["en", "ur"] as const)("is a note holding the catalog's short 911 sentence, in %s", (lang) => {
    const html = wrap(lang, <Inline911 />);

    expect(html).toMatch(/^<div class="dir-911" role="note" data-testid="inline-911">/);
    expect(html).toContain(lang === "en" ? "Not an emergency service. In danger? Call 911." : ur.x01.short);
    expect(html).toContain("911");
  });
});
