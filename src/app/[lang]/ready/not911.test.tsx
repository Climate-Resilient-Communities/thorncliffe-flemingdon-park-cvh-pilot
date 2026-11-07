// AR-27, UX-DR13: every guide, the essential-numbers page and (later) every alert and check-in screen draws the one
// catalog 911 block (src/ui/emergency), and a test fails if a page in that list renders without it. The pages are
// rendered here the way the server renders them, in English and in Urdu, from the sample guides of the page tests.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import type { ResidentContent } from "@/modules/directory";
import { englishEntry, thread } from "@/ui/alert/alert-test-helpers";

const root = path.join(__dirname, "..", "..", "..", "..");
const content: ResidentContent = JSON.parse(readFileSync(path.join(root, "e2e", "resident", "fixtures", "guides.json"), "utf8"));

const state = vi.hoisted(() => ({ content: undefined as unknown as ResidentContent, empty: false }));

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getMessages: async ({ locale }: { locale: string }) => (locale === "ur" ? ur : en),
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: (locale === "ur" ? ur : en) as unknown as AbstractIntlMessages, namespace } as never),
}));
vi.mock("next/navigation", async (original) => ({ ...(await original<object>()), useRouter: () => ({ replace: () => undefined, push: () => undefined, prefetch: () => undefined }), usePathname: () => "/en" }));
// An alert for the alert pages (S04.08), which the 911 block must be on too.
vi.mock("@/app/feedCache", () => ({
  residentAlertsEnabled: () => true,
  readCachedFeed: async () => ({ v: 1, feed_version: 1, server_now: "2026-10-01T15:00:00.000Z", threads: [thread({ entries: [englishEntry()] })], places: { buildings: [], neighbourhoods: [] } }),
}));
vi.mock("./source", () => ({
  loadResidentContent: async () => (state.empty ? { guides: [], numbers: [] } : state.content),
  loadBuildingContacts: async () => [],
}));

import ReadyPage from "./page";
import GuidePage from "./[guide]/page";
import NumbersPage from "./numbers/page";
import HomePage from "../page";
import AlertPage from "../alerts/[slug]/page";
import VerifiedPage from "../alerts/[slug]/verified/page";
import OfflinePage from "../offline/page";
import CheckinPage from "./check-in/page";

/** The marker the 911 block carries (src/ui/emergency/not-911.tsx). */
export const hasNot911 = (html: string) => (html.match(/data-component="not-911"/g) ?? []).length;

type Render = (lang: string) => Promise<ReactElement>;

/** The pages that must draw the inline (one-line) 911 block, not the full one: `data-variant` is on the marker. */
const inlineOnly = new Set(["Be ready", "home", "what verified means"]);

/**
 * The pages that must draw the 911 block. The alert and check-in screens (E04, E08) add themselves here when they are built:
 * a page in this list that renders without the block fails the test below.
 */
const PAGES: { name: string; render: Render }[] = [
  ...["power", "flood", "elevator", "heat", "smoke", "fire"].map((guide) => ({
    name: `guide ${guide}`,
    render: async (lang: string) => (await GuidePage({ params: Promise.resolve({ lang, guide }), searchParams: Promise.resolve({}) })) as ReactElement,
  })),
  { name: "essential numbers", render: async (lang) => (await NumbersPage({ params: Promise.resolve({ lang }), searchParams: Promise.resolve({}) })) as ReactElement },
  { name: "Be ready", render: async (lang) => (await ReadyPage({ params: Promise.resolve({ lang }), searchParams: Promise.resolve({}) })) as ReactElement },
  // Home (R-03): the short notice first (UAT 2026-11-04), drawn on the server render before the phone's choices are read.
  { name: "home", render: async (lang) => (await HomePage({ params: Promise.resolve({ lang }) } as never)) as ReactElement },
  // An alert (R-07, S04.08): the full block, once. What "verified" means (R-28) has the short form, as in the prototype.
  { name: "alert detail", render: async (lang) => (await AlertPage({ params: Promise.resolve({ lang, slug: "kbcdfghj" }) } as never)) as ReactElement },
  { name: "what verified means", render: async (lang) => (await VerifiedPage({ params: Promise.resolve({ lang, slug: "kbcdfghj" }) } as never)) as ReactElement },
  // The offline page (S02.12): what a phone without signal shows for a page it has not kept.
  { name: "offline", render: async (lang) => (await OfflinePage({ params: Promise.resolve({ lang }) } as never)) as ReactElement },
  // Ask for a check-in (R-33, S08.05): the full block, once.
  { name: "ask for a check-in", render: async (lang) => (await CheckinPage({ params: Promise.resolve({ lang }) } as never)) as ReactElement },
];

beforeEach(() => {
  state.content = content;
  state.empty = false;
});

describe("the 911 block", () => {
  it("is on every guide, the essential-numbers page, Be ready, home, an alert, what verified means, the offline page and Ask for a check-in, exactly once, in English and in Urdu", async () => {
    for (const { name, render } of PAGES) {
      for (const lang of ["en", "ur"]) {
        const html = renderToStaticMarkup(await render(lang));
        expect(hasNot911(html), `${name} (${lang})`).toBe(1);
        if (inlineOnly.has(name)) expect(html, `${name} (${lang})`).toContain('data-variant="inline"');
      }
    }
  });

  it("opens the server render of home, before the way to text alerts and the heading; Every day follows, and the link to what the resident has told the CVH ends the screen (UAT 2026-11-04)", async () => {
    const home = PAGES.find((candidate) => candidate.name === "home")!;
    for (const lang of ["en", "ur"]) {
      const html = renderToStaticMarkup(await home.render(lang));
      const marker = html.indexOf('data-component="not-911"');
      const texts = html.indexOf('data-testid="home-get-text-alerts"');
      const heading = html.indexOf("<h1");
      const everyDay = html.indexOf('data-testid="home-every-day"');
      const link = html.indexOf('data-testid="choices-link"');
      expect(marker, `${lang}: the notice`).toBeGreaterThan(-1);
      expect(texts, `${lang}: text alerts`).toBeGreaterThan(marker);
      expect(heading, `${lang}: the heading`).toBeGreaterThan(texts);
      expect(everyDay, `${lang}: Every day`).toBeGreaterThan(heading);
      expect(link, `${lang}: the link`).toBeGreaterThan(everyDay);
      // Nothing of the screen comes before the notice.
      expect(html.indexOf('data-testid="home"'), lang).toBeLessThan(marker);

      // Every day is in the server render too, with its three destinations in the prototype's order: nothing about them depends on the phone.
      const section = html.slice(everyDay, html.indexOf("</section>", everyDay));
      const hrefs = [...section.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
      expect(hrefs, lang).toEqual([`/${lang}/directory`, `/${lang}/map`, `/${lang}/ready`]);
      expect(html.slice(texts, html.indexOf(">", texts)), lang).toContain(`/${lang}/text-alerts`);

      // After the link's own closing tag only closing tags remain: nothing follows it on the screen.
      const after = html.slice(html.indexOf("</a>", link) + "</a>".length);
      expect(after.replace(/<\/[a-z0-9]+>/g, ""), `${lang}: after the link`).toBe("");
    }
  });

  it("is still there when the guides and numbers could not be loaded: the pages then say so and still tell a resident to call 911", async () => {
    state.empty = true;
    for (const name of ["essential numbers", "Be ready"]) {
      const page = PAGES.find((candidate) => candidate.name === name)!;
      const html = renderToStaticMarkup(await page.render("en"));
      expect(hasNot911(html), name).toBe(1);
    }
    const numbers = renderToStaticMarkup(await PAGES.find((candidate) => candidate.name === "essential numbers")!.render("en"));
    expect(numbers).toContain('href="tel:911"');
    expect(numbers).toContain("Call 911 if someone");
  });

  it("is found by the check: a page without it has none", () => {
    expect(hasNot911("<main><h1>Power outage</h1></main>")).toBe(0);
  });

  it("is the one component: no page of the list writes its own copy of the words", () => {
    const sources = ["page.tsx", "[guide]/page.tsx", "numbers/page.tsx", "../../../ui/home/home-now.tsx", "../../../ui/alert/alert-detail.tsx", "../../../ui/alert/verified-explainer.tsx", "../offline/page.tsx"].map((file) => readFileSync(path.join(__dirname, file), "utf8"));
    for (const source of sources) {
      expect(source).toMatch(/<Not911 /);
      expect(source).not.toMatch(/not an emergency service/i);
      expect(source).not.toMatch(/className="n911/);
    }
  });
});
