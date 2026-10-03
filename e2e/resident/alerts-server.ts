// The second server of the resident page tests (S04.08): the same production build, started with CVH_FAKE_FEED_FILE so the feed and the alert
// pages have the threads of fixtures/feed.json to show. The first server has no alerts, so every existing page and baseline is what it was; only
// e2e/resident/alerts.spec.ts talks to this one. Its port is the first server's plus 500 (E2E_ALERTS_PORT overrides it), so two checkouts on one
// machine that use different E2E_PORTs do not meet.
import path from "node:path";

const base = Number(process.env.E2E_PORT ?? "3000");

export const ALERTS_PORT = process.env.E2E_ALERTS_PORT ?? String(base + 500);
export const ALERTS_URL = `http://localhost:${ALERTS_PORT}`;
export const FEED_FIXTURE = path.join(__dirname, "fixtures", "feed.json");
