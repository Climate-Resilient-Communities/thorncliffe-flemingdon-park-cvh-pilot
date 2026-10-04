import type { Page, Route } from "@playwright/test";
import { BUILDINGS } from "./choices-fixture";

// FeedV1 answers for the home tests (S02.11). The resident server in these tests has no database, so /api/feed is
// answered here with the shape of FeedV1 (its contract is checked in src/contracts/feed.test.ts and, against the real
// route, in no-cookies.spec.ts). Dates are on or before 2026-10-01.

/**
 * The feed's URL, and only it: `/api/feed/archive` (S05.07) is another request, which a test answers with stubArchive. A glob such as `**\/api/feed**` would catch both.
 */
export const FEED_URL = /\/api\/feed(\?[^/]*)?$/;

export type Status = "none" | "active" | "in_progress" | "resolved";
export type Place = { status: Status; verified?: boolean };

export const NOW = "2026-10-01T12:00:00.000Z";

/** A feed with every pilot building and both neighbourhoods at none, except the places given. */
export function feedOf(version: number, places: { buildings?: Record<string, Place>; neighbourhoods?: Record<string, Place> } = {}) {
  const state = (place?: Place) => ({ status: place?.status ?? "none", verified: place?.verified ?? true });
  return {
    v: 1,
    feed_version: version,
    server_now: NOW,
    threads: [] as unknown[],
    places: {
      buildings: BUILDINGS.map(({ rsn }) => ({ rsn, ...state(places.buildings?.[rsn]) })),
      neighbourhoods: ["TP", "FP"].map((id) => ({ id, ...state(places.neighbourhoods?.[id]) })),
    },
  };
}

export type FeedAnswer = ReturnType<typeof feedOf> | "unavailable";

/**
 * Answers /api/feed from `answers` in order (the last one repeats), and records every request's URL, headers and body.
 * `seen` is the list of requests made.
 */
export async function stubFeed(page: Page, answers: FeedAnswer[]) {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  await page.route(FEED_URL, async (route: Route) => {
    const request = route.request();
    seen.push({ url: request.url(), headers: await request.allHeaders(), body: request.postData() ?? "" });
    const answer = answers[Math.min(seen.length - 1, answers.length - 1)];
    return answer === "unavailable"
      ? route.fulfill({ status: 503, json: { error: { code: "FEED_UNAVAILABLE", message_key: "feed.unavailable" } } })
      : route.fulfill({ json: answer, headers: { "Cache-Control": "no-store" } });
  });
  return seen;
}

/** A closed thread as the archive answers it (ArchiveV1): the feed's thread with how and when it closed. */
export function closedThread(slug: string, rsn: string, over: Record<string, unknown> = {}) {
  return {
    id: `0198a000-0000-7000-8000-0000000007${slug.charCodeAt(0) % 90}`,
    slug,
    types: ["power"],
    audience: { scope: "buildings", buildings: [{ rsn, floors: null }], groups: [], types: ["power"] },
    state: "closed",
    close_reason: "resolved",
    closed_at: "2026-10-01T11:00:00.000Z",
    valid_until: "2026-10-01T11:00:00.000Z",
    entries: [
      {
        id: `0198a000-0000-7000-8000-0000000008${slug.charCodeAt(0) % 90}`,
        kind: "final",
        verified: true,
        attribution: { role: "hub" },
        published_at: "2026-10-01T11:00:00.000Z",
        text: { lang: "en", body: "Power is back on.", machine: false, model: null, status: "source", source_hash: "a".repeat(64) },
        original: { lang: "en", body: "Power is back on." },
      },
    ],
    ...over,
  };
}

/** Answers /api/feed/archive with one page of `threads`, or as unavailable, and records every request's URL, headers and body. */
export async function stubArchive(page: Page, threads: unknown[] | "unavailable") {
  const seen: { url: string; headers: Record<string, string>; body: string }[] = [];
  await page.route(/\/api\/feed\/archive(\?[^/]*)?$/, async (route: Route) => {
    const request = route.request();
    seen.push({ url: request.url(), headers: await request.allHeaders(), body: request.postData() ?? "" });
    return threads === "unavailable"
      ? route.fulfill({ status: 503, json: { error: { code: "FEED_UNAVAILABLE", message_key: "feed.unavailable" } } })
      : route.fulfill({ json: { v: 1, page: 1, has_more: false, server_now: NOW, threads }, headers: { "Cache-Control": "no-store" } });
  });
  return seen;
}
