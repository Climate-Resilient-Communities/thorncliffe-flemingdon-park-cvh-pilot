// What the Be ready pages write of the numbers and of text that is not translated yet (S02.10), rendered the way the
// server renders them from the sample guides of the page tests.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import type { ResidentContent } from "@/modules/directory";

const root = path.join(__dirname, "..", "..", "..", "..");
const content: ResidentContent = JSON.parse(readFileSync(path.join(root, "e2e", "resident", "fixtures", "guides.json"), "utf8"));

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: (locale === "ur" ? ur : en) as unknown as AbstractIntlMessages, namespace } as never),
}));
vi.mock("./source", () => ({
  loadResidentContent: async () => JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "..", "e2e", "resident", "fixtures", "guides.json"), "utf8")),
  loadBuildingContacts: async () => [],
}));

import ReadyPage from "./page";
import GuidePage from "./[guide]/page";
import NumbersPage from "./numbers/page";

const query = Promise.resolve({});
const numbers = async (lang: string) => renderToStaticMarkup((await NumbersPage({ params: Promise.resolve({ lang }), searchParams: query })) as ReactElement);
const guide = async (lang: string, id: string) => renderToStaticMarkup((await GuidePage({ params: Promise.resolve({ lang, guide: id }), searchParams: query })) as ReactElement);
const ready = async (lang: string) => renderToStaticMarkup((await ReadyPage({ params: Promise.resolve({ lang }), searchParams: query })) as ReactElement);

describe("the numbers' format", () => {
  it("writes a ten-digit number the way the buildings' contacts are written, in the text and in what a screen reader says, and dials it unchanged", async () => {
    const html = await numbers("en");

    expect(html).toContain(">(416) 542-8000</bdi>");
    expect(html).not.toContain("416-542-8000");
    expect(html).toContain('aria-label="Call Report a power outage to Toronto Hydro, (416) 542-8000"');
    expect(html).toContain('href="tel:+14165428000"');
    expect(html).toContain(">(416) 421-8997</bdi>");
  });

  it("leaves 211, 311 and 911 as they are", async () => {
    const html = await numbers("en");

    expect(html).toContain('data-testid="number-211-digits"');
    expect(html).toMatch(/number-211-digits[^>]*>211</);
    expect(html).toMatch(/number-311-digits[^>]*>311</);
    expect(html).toContain('aria-label="Call Help finding community, social and government services, 211"');
    expect(html).toMatch(/numbers-911-digits[^>]*><bdi dir="ltr">911</);
  });
});

// Product-owner decision 2026-10-09 (pilot): no "not yet available in this language" note anywhere; English standing in for a
// translation is shown silently, marked lang="en" dir="ltr" on its own element for the browser and a screen reader.
describe("text with no translation yet", () => {
  const NOTES = ["numbers-unavailable", "guide-unavailable", "ready-unavailable"];

  it("is shown in English with no note on the numbers page, marked lang=en", async () => {
    const html = await numbers("ur");

    for (const id of NOTES) expect(html).not.toContain(`data-testid="${id}"`);
    expect(html).not.toContain(ur.x04.unavailable);
    expect(html).toMatch(/lang="en" dir="ltr" data-translation="unavailable"/);
  });

  it("is shown in English with no note on a partly translated guide and on a guide with nothing translated", async () => {
    for (const id of ["power", "flood"]) {
      const html = await guide("ur", id);

      for (const note of NOTES) expect(html).not.toContain(`data-testid="${note}"`);
      expect(html).not.toContain(ur.x04.unavailable);
      expect(html).not.toContain(ur.R25.unavailable.replace("{lang}", "اردو"));
      expect(html).toMatch(/lang="en" dir="ltr" data-translation="unavailable"/);
    }
  });

  it("is shown in English with no note on Be ready when a guide's title has no translation", async () => {
    const html = await ready("ur");

    expect(html).not.toContain('data-testid="ready-unavailable"');
    expect(html).not.toContain(ur.x04.unavailable);
    expect(html).toMatch(/lang="en" dir="ltr" data-translation="unavailable"/);
  });

  it("shows a translated title in the page language, unmarked", async () => {
    const translated: ResidentContent = JSON.parse(JSON.stringify(content));
    for (const record of translated.guides) record.texts.title.ur = "عنوان";
    const source = await import("./source");
    vi.spyOn(source, "loadResidentContent").mockResolvedValue(translated);

    const html = await ready("ur");
    expect(html).toContain("عنوان");
    expect(html).not.toContain('data-testid="ready-unavailable"');
  });

  it("uses no English-only words of its own: the catalog has no partlyUnavailable text", () => {
    expect(JSON.stringify(en)).not.toContain("partlyUnavailable");
  });
});
