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
const NOTE = (html: string, testId: string) => new RegExp(`data-testid="${testId}"[^>]*>(.*?)</div>`).exec(html)?.[1] ?? null;

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

describe("text with no translation yet", () => {
  it("is announced on the numbers page with the catalog's own x04 words, naming the language in its script", async () => {
    const note = NOTE(await numbers("ur"), "numbers-unavailable");

    expect(note).toContain(ur.x04.unavailable);
    expect(note).toContain(ur.x04.unavailableBody.replace("{lang}", "اردو"));
  });

  it("is announced on a partly translated guide the same way, and on a guide with nothing translated with the guide's own words", async () => {
    const part = NOTE(await guide("ur", "power"), "guide-unavailable");
    const all = NOTE(await guide("ur", "flood"), "guide-unavailable");

    expect(part).toContain(ur.x04.unavailable);
    expect(part).toContain(ur.x04.unavailableBody.replace("{lang}", "اردو"));
    expect(all).toContain(ur.R25.unavailable.replace("{lang}", "اردو"));
    expect(all).not.toContain(ur.x04.unavailable);
  });

  it("is announced once on Be ready when a guide's title shows in English, and not in English", async () => {
    const html = await ready("ur");
    const note = NOTE(html, "ready-unavailable");

    expect(html.match(/data-testid="ready-unavailable"/g)).toHaveLength(1);
    expect(note).toContain(ur.x04.unavailable);
    expect(note).toContain(ur.x04.unavailableBody.replace("{lang}", "اردو"));
    expect(await ready("en")).not.toContain("ready-unavailable");
  });

  it("is not announced on Be ready when every title is translated", async () => {
    const translated: ResidentContent = JSON.parse(JSON.stringify(content));
    for (const record of translated.guides) record.texts.title.ur = "عنوان";
    const source = await import("./source");
    vi.spyOn(source, "loadResidentContent").mockResolvedValue(translated);

    expect(await ready("ur")).not.toContain("ready-unavailable");
  });

  it("uses no English-only words of its own: the catalog has no partlyUnavailable text", () => {
    expect(JSON.stringify(en)).not.toContain("partlyUnavailable");
  });
});
