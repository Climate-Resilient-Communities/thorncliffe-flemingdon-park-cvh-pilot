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

const root = path.join(__dirname, "..", "..", "..", "..");
const content: ResidentContent = JSON.parse(readFileSync(path.join(root, "e2e", "resident", "fixtures", "guides.json"), "utf8"));

const state = vi.hoisted(() => ({ content: undefined as unknown as ResidentContent, empty: false }));

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: (locale === "ur" ? ur : en) as unknown as AbstractIntlMessages, namespace } as never),
}));
vi.mock("./source", () => ({
  loadResidentContent: async () => (state.empty ? { guides: [], numbers: [] } : state.content),
  loadBuildingContacts: async () => [],
}));

import ReadyPage from "./page";
import GuidePage from "./[guide]/page";
import NumbersPage from "./numbers/page";

/** The marker the 911 block carries (src/ui/emergency/not-911.tsx). */
export const hasNot911 = (html: string) => (html.match(/data-component="not-911"/g) ?? []).length;

type Render = (lang: string) => Promise<ReactElement>;

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
];

beforeEach(() => {
  state.content = content;
  state.empty = false;
});

describe("the 911 block", () => {
  it("is on every guide, the essential-numbers page and Be ready, exactly once, in English and in Urdu", async () => {
    for (const { name, render } of PAGES) {
      for (const lang of ["en", "ur"]) {
        const html = renderToStaticMarkup(await render(lang));
        expect(hasNot911(html), `${name} (${lang})`).toBe(1);
      }
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
    const sources = ["page.tsx", "[guide]/page.tsx", "numbers/page.tsx"].map((file) => readFileSync(path.join(__dirname, file), "utf8"));
    for (const source of sources) {
      expect(source).toMatch(/<Not911 /);
      expect(source).not.toMatch(/not an emergency service/i);
      expect(source).not.toMatch(/className="n911/);
    }
  });
});
