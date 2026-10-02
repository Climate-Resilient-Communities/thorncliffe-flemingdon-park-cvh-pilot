import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildListing } from "../../../e2e/resident/directory-fixture";
import { DirectoryListingV1 } from "@/contracts/directory";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import { hasFallbackText } from "./directory-browser";
import { ProviderView, type CategoryNames } from "./provider-view";

const render = (lang: "en" | "ur", id: string, variant: "card" | "page" = "card") => {
  const listing = DirectoryListingV1.parse(buildListing(lang, 7));
  const categories: CategoryNames = new Map(listing.categories.map((c) => [c.id, c.name]));
  const provider = listing.providers.find((p) => p.id === id)!;
  return renderToStaticMarkup(
    <NextIntlClientProvider locale={lang} messages={(lang === "ur" ? ur : en) as unknown as AbstractIntlMessages}>
      <ProviderView provider={provider} categories={categories} lang={lang} variant={variant} />
    </NextIntlClientProvider>,
  );
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
      expect(html).toContain('<bdi lang="en" dir="ltr">45 Overlea Blvd, Toronto, M4H 1K2</bdi>');
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
