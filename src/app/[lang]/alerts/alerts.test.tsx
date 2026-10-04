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

const state = vi.hoisted(() => ({
  enabled: true,
  feed: undefined as unknown as FeedV1,
  reads: [] as string[],
  failing: false,
  /** The threads that closed, by slug: what `readClosedAlert` (the resident views) answers; the feed does not carry them (S05.03). */
  closed: new Map<string, unknown>(),
  closedReads: [] as string[],
}));

vi.mock("@/app/feedCache", () => ({
  residentAlertsEnabled: () => state.enabled,
  readCachedFeed: async (lang: string) => {
    state.reads.push(lang);
    if (state.failing) throw new Error("the feed could not be read");
    return state.feed;
  },
  readCachedClosedAlert: async (lang: string, slug: string) => {
    state.closedReads.push(`${lang}:${slug}`);
    const found = state.closed.get(slug);
    return found ? { thread: found, serverNow: "2026-10-01T15:00:00.000Z" } : null;
  },
}));
vi.mock("next-intl/server", () => ({
  setRequestLocale: () => undefined,
  getTranslations: async ({ locale, namespace }: { locale: string; namespace?: string }) =>
    createTranslator({ locale, messages: (locale === "ur" ? ur : en) as unknown as AbstractIntlMessages, namespace } as never),
}));
vi.mock("@/platform/config/env", () => ({ getEnv: () => ({ publicBaseUrl: "https://cvh.example.org" }) }));
// The building page's read: the register's address of a building, or none.
vi.mock("@/app/[lang]/buildings/[rsn]/source", () => ({
  loadBuilding: async (rsn: string) => (rsn === "4154146" ? { rsn, address: "4 Milepost Pl" } : rsn === "4154159" ? { rsn, address: "85-95 Thorncliffe Park Dr" } : null),
}));
vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({ replace: () => undefined }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

import SharedAlertPage, { generateMetadata as sharedMetadata } from "../a/[slug]/page";
import AlertPage, { generateMetadata } from "./[slug]/page";
import SharePage from "./[slug]/share/page";
import VerifiedPage from "./[slug]/verified/page";
import { SLUG, loadAlert } from "./source";

const feedOf = (...threads: ReturnType<typeof thread>[]): FeedV1 => ({
  v: 1,
  feed_version: 3,
  server_now: SERVER_NOW.toISOString(),
  threads,
  places: { buildings: [], neighbourhoods: [] },
});

// ICU writes a clock time with a narrow no-break space before AM and PM in some versions; the tests compare plain spaces.
const plain = (value: string | null | undefined) => value?.replace(/[\u202f\u00a0]/g, " ");

const params = (lang: string, slug: string) => ({ params: Promise.resolve({ lang, slug }) }) as never;
const html = async (page: (props: never) => Promise<unknown>, lang: string, slug: string) => renderToStaticMarkup((await page(params(lang, slug))) as ReactElement);

beforeEach(() => {
  state.enabled = true;
  state.failing = false;
  state.reads.length = 0;
  state.closed.clear();
  state.closedReads.length = 0;
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

  it("titles the page with the types of the alert, and describes it with the words of the entry that stands (the share preview says what the alert says)", async () => {
    state.feed = feedOf(thread({ types: ["elevator", "power"], entries: [englishEntry()] }));
    // The facts come first and are never cut: the verification, the place and the time (Toronto clock time, the feed's own "now"), then the words.
    const description = `Verified by the Hub · Thorncliffe Park · Posted today at 10:40 AM — ${englishEntry().text.body}`;

    const metadata = await generateMetadata(params("en", "kbcdfghj"));

    expect({ ...metadata, description: plain(metadata.description as string), openGraph: { title: "Elevator, Power", description: plain((metadata.openGraph as { description: string }).description) } }).toEqual({ title: "Elevator, Power", description, openGraph: { title: "Elevator, Power", description } });
    expect(await generateMetadata(params("en", "nosuchslug"))).toEqual({});
  });

  it("describes a corrected alert with the correction, never the wording it replaced: the feed, the alert and the share preview agree", async () => {
    const original = englishEntry({ n: 1, published_at: "2026-10-01T14:00:00.000Z" });
    const corrected = englishEntry({ n: 2, kind: "correction", supersedes_id: original.id, published_at: "2026-10-01T14:30:00.000Z", text: { lang: "en", body: "Power is out on floors 1 to 8.", machine: false, model: null, status: "source", source_hash: "a".repeat(64) } });
    state.feed = feedOf(thread({ entries: [original, corrected] }));

    const metadata = await generateMetadata(params("en", "kbcdfghj"));

    expect(plain(metadata.description)).toBe("Verified by the Hub · Thorncliffe Park · Updated today at 10:30 AM — Correction: Power is out on floors 1 to 8.");
    expect(metadata.description).not.toContain(original.text.body);
    const page = await html(AlertPage, "en", "kbcdfghj");
    expect(page).toContain("Power is out on floors 1 to 8.");
    expect(page).toContain('data-mark="corrected"');
  });

  it("finds the thread among several by its slug, never by position", async () => {
    state.feed = feedOf(thread({ slug: "aaaaaaaa", id: "0198a000-0000-7000-8000-000000000a01", entries: [englishEntry({ n: 1 })] }), thread({ slug: "bbbbbbbb", id: "0198a000-0000-7000-8000-000000000a02", types: ["power"], entries: [englishEntry({ n: 2 })] }));

    expect(await html(AlertPage, "en", "bbbbbbbb")).toContain('data-slug="bbbbbbbb"');
    expect(await html(AlertPage, "en", "aaaaaaaa")).toContain('data-slug="aaaaaaaa"');
  });
});

describe("a thread that closed (S05.03)", () => {
  const FINAL = "Power is back on all floors. If your power is still out, call Toronto Hydro.";
  const closedThread = (reason: string, entries = [englishEntry({ n: 1 }), englishEntry({ n: 2, kind: "final", published_at: "2026-10-01T14:55:00.000Z", text: { lang: "en", body: FINAL, machine: false, model: null, status: "source", source_hash: "a".repeat(64) } })]) =>
    thread({ slug: "closedaa", state: "closed", close_reason: reason, entries });

  it("opens from its address although the feed does not carry it, with how it closed, its final message and the entry before it", async () => {
    state.closed.set("closedaa", closedThread("resolved"));

    const page = await html(AlertPage, "en", "closedaa");

    expect(state.closedReads).toEqual(["en:closedaa"]);
    expect(page).toContain('data-testid="alert-closed"');
    expect(page).toContain('data-reason="resolved"');
    expect(page).toContain(FINAL);
    expect(page).toContain(ENGLISH);
  });

  it("is looked for only after the feed's open threads, and an open thread never reads the closed ones", async () => {
    await html(AlertPage, "en", "kbcdfghj");
    expect(state.closedReads).toEqual([]);
    await expect(AlertPage(params("en", "nosuchslug"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.closedReads).toEqual(["en:nosuchslug"]);
  });

  it("is not read at all while the launch gate is off, or for an address that cannot be a slug", async () => {
    state.closed.set("closedaa", closedThread("resolved"));
    state.enabled = false;
    await expect(AlertPage(params("en", "closedaa"))).rejects.toThrow("NEXT_NOT_FOUND");
    state.enabled = true;
    await expect(AlertPage(params("en", "../closedaa"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.closedReads).toEqual([]);
  });

  it("describes the page with the final message, the words of the entry that stands", async () => {
    state.closed.set("closedaa", closedThread("resolved"));

    const metadata = await generateMetadata(params("en", "closedaa"));

    expect(plain(metadata.title as string)).toBe("Elevator: Resolved today at 10:55 AM");
    expect(metadata.description).toBe(`Verified by the Hub · Thorncliffe Park — ${FINAL}`);
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

const building = (...rsns: string[]) => ({ scope: "buildings" as const, buildings: rsns.map((rsn) => ({ rsn, floors: null })), groups: [], types: ["elevator"] });
const description = async (lang: string, slug: string) => plain((await generateMetadata(params(lang, slug))).description as string);

describe("the preview of a thread says where it is (S05.08)", () => {
  it("names the building by its register address, and says how many more when there are many", async () => {
    state.feed = feedOf(thread({ audience: building("4154146"), entries: [englishEntry()] }));
    expect(await description("en", "kbcdfghj")).toBe(`Verified by the Hub \u00b7 4 Milepost Pl \u00b7 Posted today at 10:40 AM — ${ENGLISH}`);

    state.feed = feedOf(thread({ audience: building("4154146", "4154159", "1", "2", "3"), entries: [englishEntry()] }));
    expect(await description("en", "kbcdfghj")).toContain("4 Milepost Pl, 85-95 Thorncliffe Park Dr and 3 more \u00b7 Posted");
  });

  it("says nothing about the place, rather than guess one, when no building can be named", async () => {
    state.feed = feedOf(thread({ audience: building("1", "2"), entries: [englishEntry()] }));
    expect(await description("en", "kbcdfghj")).toBe(`Verified by the Hub \u00b7 Posted today at 10:40 AM — ${ENGLISH}`);
  });

  it("says \"Not yet verified\" for an alert the Hub has not checked", async () => {
    state.feed = feedOf(thread({ entries: [englishEntry({ verified: false })] }));
    expect(await description("en", "kbcdfghj")).toMatch(/^Not yet verified \u00b7 Thorncliffe Park \u00b7 Posted/);
  });
});

describe("the shared link's page reflects each change when it is fetched again (S05.08)", () => {
  const ORIGINAL = englishEntry({ n: 1, published_at: "2026-10-01T14:00:00.000Z" });
  const words = (body: string) => ({ lang: "en" as const, body, machine: false, model: null, status: "source" as const, source_hash: "a".repeat(64) });
  const preview = async () => {
    const metadata = await sharedMetadata(params("en", "kbcdfghj"));
    return { title: plain(metadata.title as string), description: plain(metadata.description as string), og: plain((metadata.openGraph as { description: string }).description) };
  };

  it("shows the alert, then the correction in its place, then the withdrawal, then the close: each state the moment the feed has it, never more than the feed behind", async () => {
    state.feed = feedOf(thread({ entries: [ORIGINAL] }));
    expect((await preview()).description).toBe(`Verified by the Hub \u00b7 Thorncliffe Park \u00b7 Posted today at 10:00 AM — ${ENGLISH}`);

    const correction = englishEntry({ n: 2, kind: "correction", supersedes_id: ORIGINAL.id, published_at: "2026-10-01T14:30:00.000Z", text: words("Power is out on floors 1 to 8.") });
    state.feed = feedOf(thread({ entries: [ORIGINAL, correction] }));
    const corrected = await preview();
    expect(corrected.description).toBe("Verified by the Hub \u00b7 Thorncliffe Park \u00b7 Updated today at 10:30 AM — Correction: Power is out on floors 1 to 8.");
    expect(corrected.og).toBe(corrected.description);

    const withdrawal = englishEntry({ n: 3, kind: "withdrawal", supersedes_id: ORIGINAL.id, published_at: "2026-10-01T14:40:00.000Z", text: words("This alert had wrong information. It has been withdrawn.") });
    delete withdrawal.phase;
    state.feed = feedOf();
    state.closed.set("kbcdfghj", thread({ state: "closed", close_reason: "withdrawn", entries: [ORIGINAL, withdrawal] }));
    const withdrawn = await preview();
    expect(withdrawn.title).toBe("Elevator: Withdrawn");
    expect(withdrawn.description).toBe("Verified by the Hub \u00b7 Thorncliffe Park — This alert had wrong information. It has been withdrawn.");
    expect(withdrawn.description).not.toContain(ENGLISH);

    const final = englishEntry({ n: 4, kind: "final", published_at: "2026-10-01T14:55:00.000Z", text: words("Power is back on all floors.") });
    state.closed.set("kbcdfghj", thread({ state: "closed", close_reason: "resolved", entries: [ORIGINAL, final] }));
    const closed = await preview();
    expect(closed.title).toBe("Elevator: Resolved today at 10:55 AM");
    expect(closed.description).toBe("Verified by the Hub \u00b7 Thorncliffe Park — Power is back on all floors.");
  });
});

describe("the share landing /a/{slug}?l={lang} (S05.08)", () => {
  it("shows the standard alert in the language of the address and follows the phone's saved language once loaded", async () => {
    const page = await html(SharedAlertPage, "en", "kbcdfghj");

    expect(page).toContain('data-testid="alert-detail"');
    expect(page).toContain(ENGLISH);
    expect(state.reads).toEqual(["en"]);
  });

  it("describes the thread in the language of `l`", async () => {
    state.feed = feedOf(thread({ entries: [entry()] }));

    const metadata = await sharedMetadata(params("ur", "kbcdfghj"));

    expect(state.reads).toEqual(["ur"]);
    expect(metadata.description).toContain(URDU);
    expect(metadata.title).toBe("لفٹ");
  });

  it("is a 404 with no detail for an unknown address, a drill's or a thread with no web-published entry (none of them is in the feed), and whatever the gate says", async () => {
    await expect(SharedAlertPage(params("en", "nosuchslug"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(SharedAlertPage(params("en", "../kbcdfghj"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await sharedMetadata(params("en", "nosuchslug"))).toEqual({});
    state.enabled = false;
    await expect(SharedAlertPage(params("en", "kbcdfghj"))).rejects.toThrow("NEXT_NOT_FOUND");
    expect(await sharedMetadata(params("en", "kbcdfghj"))).toEqual({});
  });

  it("opens a thread that closed, with its closed state", async () => {
    state.closed.set("closedaa", thread({ slug: "closedaa", state: "closed", close_reason: "expired", entries: [englishEntry({ n: 1 })] }));

    const page = await html(SharedAlertPage, "en", "closedaa");

    expect(page).toContain('data-reason="expired"');
  });
});

describe("share an alert (R-29, S05.08)", () => {
  it("shows the standard message: what, who and whether the Hub checked it, where, when, the 911 line and the link, with the share control", async () => {
    state.feed = feedOf(thread({ audience: building("4154146"), entries: [englishEntry()] }));

    const page = plain(await html(SharePage, "en", "kbcdfghj")) as string;

    expect(page).toContain('data-testid="share-message"');
    expect(page).toContain(ENGLISH);
    expect(page).toContain("<p class=\"share-box__line\" dir=\"auto\">Community alert from the Hub</p><p class=\"share-box__line\" dir=\"auto\">Verified by the Hub</p><p class=\"share-box__line\" dir=\"auto\">4 Milepost Pl</p><p class=\"share-box__line\" dir=\"auto\">Posted today at 10:40 AM</p>");
    expect(page).toContain("Not an emergency service. In danger? Call 911.");
    expect(page).toContain("Newest updates and any corrections: https://cvh.example.org/a/kbcdfghj?l=en");
    expect(page).toContain('data-testid="share-send"');
    expect(page).toContain("The CVH does not record who shares alerts or who you send them to.");
    expect(page).toContain("Nothing tailored to you is shared.");
  });

  it("links to the language of the page it was shared from, and says an alert that is not verified is not yet verified", async () => {
    state.feed = feedOf(thread({ entries: [entry({ verified: false })] }));

    const page = await html(SharePage, "ur", "kbcdfghj");

    expect(page).toContain("l=ur");
    expect(page).toContain(URDU);
    expect(page).toContain("ابھی تصدیق نہیں ہوئی");
  });

  it("is a 404 for what the alert page is a 404 for, and is not looked for while the gate is off", async () => {
    await expect(SharePage(params("en", "nosuchslug"))).rejects.toThrow("NEXT_NOT_FOUND");
    state.enabled = false;
    await expect(SharePage(params("en", "kbcdfghj"))).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
