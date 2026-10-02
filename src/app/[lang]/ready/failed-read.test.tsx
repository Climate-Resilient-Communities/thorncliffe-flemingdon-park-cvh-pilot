// A failed database read must not remove the 911 block (AR-27). Here the real source.ts runs and the two reads under it
// reject, the way a database outage does: every Be ready page then says the content could not be loaded, and still
// draws the 911 block and a way to call 911.
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

const reads = vi.hoisted(() => ({ content: vi.fn(), contacts: vi.fn() }));

vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: (locale === "ur" ? ur : en) as unknown as AbstractIntlMessages, namespace } as never),
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => fn }));
vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()), cache: (fn: unknown) => fn }));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ fakeGuidesFile: undefined, fakeBuildingsFile: undefined }) }));
vi.mock("@/platform/db", () => ({ getDb: () => ({}) }));
vi.mock("@/modules/directory", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/directory")>()), readResidentContent: reads.content }));
vi.mock("@/modules/places", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/places")>()), listBuildingContacts: reads.contacts }));

import ReadyPage from "./page";
import GuidePage from "./[guide]/page";
import NumbersPage from "./numbers/page";

const query = Promise.resolve({});
const numbers = async (lang: string) => renderToStaticMarkup((await NumbersPage({ params: Promise.resolve({ lang }), searchParams: query })) as ReactElement);
const guide = async (lang: string, id: string) => renderToStaticMarkup((await GuidePage({ params: Promise.resolve({ lang, guide: id }), searchParams: query })) as ReactElement);
const ready = async (lang: string) => renderToStaticMarkup((await ReadyPage({ params: Promise.resolve({ lang }), searchParams: query })) as ReactElement);
const count911 = (html: string) => (html.match(/data-component="not-911"/g) ?? []).length;

beforeEach(() => {
  reads.content.mockReset().mockRejectedValue(new Error("connection refused"));
  reads.contacts.mockReset().mockRejectedValue(new Error("connection refused"));
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("when the database cannot be read", () => {
  it("the numbers page says so, and keeps the 911 block and the call 911 link", async () => {
    for (const lang of ["en", "ur"]) {
      const html = await numbers(lang);

      expect(count911(html), lang).toBe(1);
      expect(html, lang).toContain('href="tel:911"');
      expect(html, lang).toContain('data-testid="numbers-none"');
    }
  });

  it("a guide page says the guides could not be loaded instead of a 404, and keeps the 911 block and the call 911 link", async () => {
    for (const lang of ["en", "ur"]) {
      const html = await guide(lang, "power");

      expect(count911(html), lang).toBe(1);
      expect(html, lang).toContain('href="tel:911"');
      expect(html, lang).toContain('data-testid="guide-none"');
    }
  });

  it("Be ready says the guides could not be loaded, and keeps the 911 block", async () => {
    const html = await ready("en");

    expect(count911(html)).toBe(1);
    expect(html).toContain('data-testid="ready-none"');
  });

  it("a guide that does not exist is still a 404 while the guides can be read", async () => {
    reads.content.mockReset().mockResolvedValue(content);

    await expect(guide("en", "no-such-guide")).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(count911(await guide("en", "power"))).toBe(1);
  });
});
