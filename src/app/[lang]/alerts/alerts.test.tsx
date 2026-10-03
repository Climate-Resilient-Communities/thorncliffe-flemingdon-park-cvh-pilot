// The alert pages (R-07, R-28; S04.08) as the server renders them: found by the slug in the feed's own answer for the language, a 404 for anything
// else, and nothing at all while the launch gate is off. The feed is the app's cached read (src/app/feedCache.ts), faked here.
import { createTranslator, type AbstractIntlMessages } from "next-intl";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedV1 } from "@/contracts/feed";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import { ENGLISH, SERVER_NOW, URDU, englishEntry, entry, thread } from "@/ui/alert/alert-test-helpers";

const state = vi.hoisted(() => ({ enabled: true, feed: undefined as unknown as FeedV1, reads: [] as string[], failing: false }));

vi.mock("@/app/feedCache", () => ({
  residentAlertsEnabled: () => state.enabled,
  readCachedFeed: async (lang: string) => {
    state.reads.push(lang);
    if (state.failing) throw new Error("the feed could not be read");
    return state.feed;
  },
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: (locale === "ur" ? ur : en) as unknown as AbstractIntlMessages, namespace } as never),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import AlertPage, { generateMetadata } from "./[slug]/page";
import VerifiedPage from "./[slug]/verified/page";
import { SLUG, loadAlert } from "./source";

const feedOf = (...threads: ReturnType<typeof thread>[]): FeedV1 => ({
  v: 1,
  feed_version: 3,
  server_now: SERVER_NOW.toISOString(),
  threads,
  places: { buildings: [], neighbourhoods: [] },
});

const params = (lang: string, slug: string) => ({ params: Promise.resolve({ lang, slug }) }) as never;
const html = async (page: (props: never) => Promise<unknown>, lang: string, slug: string) => renderToStaticMarkup((await page(params(lang, slug))) as ReactElement);

beforeEach(() => {
  state.enabled = true;
  state.failing = false;
  state.reads.length = 0;
  state.feed = feedOf(thread({ entries: [englishEntry()] }));
});

describe("the alert page", () => {
  it("shows the alert the feed has at that slug, in the language of the address", async () => {
    const page = await html(AlertPage, "en", "kbcdfghj");

    expect(page).toContain('data-testid="alert-detail"');
    expect(page).toContain(ENGLISH);
    expect(state.reads).toEqual(["en"]);
  });

  it("reads the feed of the page's language, so the text is that language's", async () => {
    state.feed = feedOf(thread({ entries: [entry()] }));

    const page = await html(AlertPage, "ur", "kbcdfghj");

    expect(state.reads).toEqual(["ur"]);
    expect(page).toContain(URDU);
    expect(page).toContain('href="/ur/ready/elevator#during"');
  });

  it("is a 404 for a slug the feed has no thread at: an unknown address, and an alert the feed does not carry (a drill, a closed or an unpublished one)", async () => {
    await expect(AlertPage(params("en", "nosuchslug"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(VerifiedPage(params("en", "nosuchslug"))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(["", "KBCDFGHJ", "short", "kbcdfghj-1", "../kbcdfghj", "kbcdfghj%20", "a".repeat(17)])("is a 404 for the slug %j, without reading anything", async (slug) => {
    await expect(AlertPage(params("en", slug))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.reads).toEqual([]);
  });

  it("is a 404, whatever the feed holds and without reading it, while RESIDENT_ALERTS_ENABLED is off (production until E05)", async () => {
    state.enabled = false;

    await expect(AlertPage(params("en", "kbcdfghj"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(VerifiedPage(params("en", "kbcdfghj"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.reads).toEqual([]);
    expect(await generateMetadata(params("en", "kbcdfghj"))).toEqual({});
  });

  it("is a 404 for a language that is not a launch language", async () => {
    await expect(AlertPage(params("xx", "kbcdfghj"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.reads).toEqual([]);
  });

  it("lets the error page answer when the feed cannot be read, rather than saying there is no such alert", async () => {
    state.failing = true;

    await expect(AlertPage(params("en", "kbcdfghj"))).rejects.toThrow("the feed could not be read");
  });

  it("titles the page with the types of the alert", async () => {
    state.feed = feedOf(thread({ types: ["elevator", "power"], entries: [englishEntry()] }));

    expect(await generateMetadata(params("en", "kbcdfghj"))).toEqual({ title: "Elevator, Power" });
    expect(await generateMetadata(params("en", "nosuchslug"))).toEqual({});
  });

  it("finds the thread among several by its slug, never by position", async () => {
    state.feed = feedOf(thread({ slug: "aaaaaaaa", id: "0198a000-0000-7000-8000-000000000a01", entries: [englishEntry({ n: 1 })] }), thread({ slug: "bbbbbbbb", id: "0198a000-0000-7000-8000-000000000a02", types: ["power"], entries: [englishEntry({ n: 2 })] }));

    expect(await html(AlertPage, "en", "bbbbbbbb")).toContain('data-slug="bbbbbbbb"');
    expect(await html(AlertPage, "en", "aaaaaaaa")).toContain('data-slug="aaaaaaaa"');
  });
});

describe("the page of what verified means", () => {
  it("is about the alert it was opened from, and is found the way the alert is", async () => {
    const page = await html(VerifiedPage, "en", "kbcdfghj");

    expect(page).toContain('data-testid="verified-explainer"');
    expect(page).toContain('href="/en/alerts/kbcdfghj"');
    expect(state.reads).toEqual(["en"]);
  });
});

describe("the slug", () => {
  it("is the shape the database allows: lowercase letters and digits, 6 to 16 (alert_slug_valid)", () => {
    expect(SLUG.test("kbcdfghj")).toBe(true);
    expect(SLUG.test("abcde")).toBe(false);
    expect(SLUG.test("abcdefghijklmnopq")).toBe(false);
    expect(SLUG.test("ABCDEFGH")).toBe(false);
    expect(SLUG.test("abc_efgh")).toBe(false);
  });

  it("is looked for among the feed's open threads only, as the language's feed lists them", async () => {
    expect(await loadAlert("en", "kbcdfghj")).toMatchObject({ thread: { slug: "kbcdfghj" }, serverNow: SERVER_NOW });
    expect(await loadAlert("en", "zzzzzzzz")).toBeNull();
  });
});
