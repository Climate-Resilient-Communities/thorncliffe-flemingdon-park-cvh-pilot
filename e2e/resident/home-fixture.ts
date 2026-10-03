import type { Page, Route } from "@playwright/test";
import { BUILDINGS } from "./choices-fixture";

// FeedV1 answers for the home tests (S02.11). The resident server in these tests has no database, so /api/feed is
// answered here with the shape of FeedV1 (its contract is checked in src/contracts/feed.test.ts and, against the real
// route, in no-cookies.spec.ts). Dates are on or before 2026-10-01.

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
  await page.route("**/api/feed**", async (route: Route) => {
    const request = route.request();
    seen.push({ url: request.url(), headers: await request.allHeaders(), body: request.postData() ?? "" });
    const answer = answers[Math.min(seen.length - 1, answers.length - 1)];
    return answer === "unavailable"
      ? route.fulfill({ status: 503, json: { error: { code: "FEED_UNAVAILABLE", message_key: "feed.unavailable" } } })
      : route.fulfill({ json: answer, headers: { "Cache-Control": "no-store" } });
  });
  return seen;
}
