// How soon a resident sees an approved alert (S04.08, AD-17), end to end against the production build with a real database
// (playwright.staff.config.ts), with the resident's clock controlled: a resident has home open, visible and online, and its polls succeed; a
// second Coordinator approves an acknowledgement through the Hub exactly as on a phone; the alert is on the resident's screen within 75 seconds of
// the approval (the edge's 15 seconds plus the phone's 60-second poll: a proposed engineering budget, not a service guarantee).
//
// What is real: the Hub's approval (it raises the feed version and expires the feed's tag after it commits), the feed route and its Cache-Control
// header, the database, the page and its 60-second poll. What is controlled: the resident's browser clock (Playwright's page.clock, so the minute
// of polling takes no real minute), and the edge, which a local `next start` does not have: it is a small stand-in in front of /api/feed that keeps
// an answer for as long as the ROUTE's own `s-maxage` says, measured on the same controlled clock, as a shared cache does. So the 15 seconds in the
// test are the 15 seconds the route sends, and the 60 are the page's own interval; nothing here assumes either.
//
// The case measured is the worst one: another resident refreshed the edge copy just before the approval, so the next poll is answered with that
// copy (still without the alert) and the one after it, a minute later, finds it.
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import postgres from "postgres";
import { FEED_EDGE_MAX_AGE_SECONDS, FEED_VISIBILITY_BUDGET_MS } from "../../src/contracts/feed";
import { FEED_POLL_MS } from "../../src/ui/home/feed-poll";
import { newBuilding, newCoordinator, personOnAPhone, submitAnAcknowledgement } from "./alert-flow";
import { openDatabase } from "./helpers";

let sql: postgres.Sql;

test.beforeAll(() => {
  sql = openDatabase();
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

interface Reply {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** A shared cache in front of the feed, on the test's controlled clock: it keeps an answer for the `s-maxage` the route sent, never longer. */
class Edge {
  /** Milliseconds on the controlled clock since the resident's page opened. */
  now = 0;
  private copies = new Map<string, { at: number; reply: Reply; ttl: number }>();
  /** Every answer given, for the message of a failure. */
  readonly served: { at: number; from: "edge" | "origin"; threads: number }[] = [];

  async through(url: string, origin: () => Promise<Reply>): Promise<Reply> {
    const copy = this.copies.get(url);
    if (copy && this.now - copy.at < copy.ttl) {
      this.served.push({ at: this.now, from: "edge", threads: JSON.parse(copy.reply.body).threads?.length ?? 0 });
      return copy.reply;
    }
    const reply = await origin();
    const sMaxAge = /(?:^|[ ,])s-maxage=(\d+)/.exec(reply.headers["cache-control"] ?? "")?.[1];
    this.copies.set(url, { at: this.now, reply, ttl: sMaxAge === undefined ? 0 : Number(sMaxAge) * 1000 });
    this.served.push({ at: this.now, from: "origin", threads: JSON.parse(reply.body).threads?.length ?? 0 });
    return reply;
  }

  /** The edge's rule as the route states it (for the test to compare with the budget), read from the last answer it kept. */
  ttlMs(url: string): number | undefined {
    return this.copies.get(url)?.ttl;
  }
}

const reply = async (response: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Reply> => ({ status: response.status(), headers: response.headers(), body: await response.text() });

test("an approved alert is on a resident's screen within 75 seconds of its approval, with the page open and its clock controlled", async ({ browser, baseURL, request }) => {
  const rsn = await newBuilding(sql, "66 Visibility Test Dr");
  const author = await newCoordinator(sql);
  const approver = await newCoordinator(sql);

  // The Hub: one Coordinator writes and submits the acknowledgement; another has the approval page open on a phone, ready to press Approve.
  const writer = await personOnAPhone(browser, baseURL, author);
  const ref = await submitAnAcknowledgement(writer.page, rsn);
  const slug = (await sql`select slug from alert where id = ${ref.alertId}`)[0].slug as string;
  // The server keeps the feed for 15 seconds and serves a stale answer once; one made by an earlier run must not be what the resident opens on.
  await expect
    .poll(async () => Date.now() - Date.parse(((await (await request.get("/api/feed?lang=en")).json()) as { server_now: string }).server_now), { timeout: 45_000 })
    .toBeLessThan(5_000);
  const second = await personOnAPhone(browser, baseURL, approver);
  await second.page.goto(`/staff/alerts/approve?alert=${ref.alertId}&entry=${ref.entryId}`);
  await expect(second.page.getByTestId("approve-button")).toBeVisible();

  // The resident: a returning visitor with home open. The clock is installed and paused before the page loads, so nothing in it moves until the
  // test moves it; the edge stands in front of /api/feed.
  const edge = new Edge();
  const resident = await browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [{ origin: baseURL as string, localStorage: [{ name: "cvh.choices", value: JSON.stringify({ v: 1, welcomed: true }) }] }] },
  });
  try {
    await resident.route(/\/api\/feed\?/, async (route) => {
      const upstream = await edge.through(route.request().url(), async () => reply(await route.fetch()));
      await route.fulfill({ status: upstream.status, headers: upstream.headers, body: upstream.body });
    });
    const page: Page = await resident.newPage();
    const start = new Date("2026-10-01T15:00:00.000Z");
    await page.clock.install({ time: start });
    await page.clock.pauseAt(new Date(start.getTime() + 10_000));
    await page.goto("/en");
    await expect(page.getByTestId("home-now")).toHaveAttribute("data-feed", "ready", { timeout: 30_000 });
    // Other alerts of the run (the Hub's own tests approve some) may already be there: the count is the starting point, and this alert is not among them.
    const baseline = edge.served[0]?.threads ?? -1;
    expect(edge.served).toEqual([{ at: 0, from: "origin", threads: baseline }]);
    expect(baseline).toBeGreaterThanOrEqual(0);
    await expect(page.getByTestId(`alert-card-${slug}`)).toHaveCount(0);
    // The edge keeps an answer for exactly what the route says: the 15 seconds of the budget.
    expect(edge.ttlMs(`${baseURL}/api/feed?lang=en`)).toBe(FEED_EDGE_MAX_AGE_SECONDS * 1000);

    /** Moves the resident's clock, and the edge's, forward together; the page's timers that fall due fire as the clock passes them. */
    const advance = async (ms: number) => {
      edge.now += ms;
      await page.clock.runFor(ms);
    };
    const settled = (answers: number) => expect.poll(() => edge.served.length, { message: JSON.stringify(edge.served) }).toBe(answers);

    // 47 seconds in, another resident's request refreshes the edge's copy: it has no alert yet. The approval follows at once.
    await advance(47_000);
    const other = await edge.through(`${baseURL}/api/feed?lang=en`, async () => reply(await request.get("/api/feed?lang=en")));
    expect(JSON.parse(other.body).threads).toHaveLength(baseline);
    const approvedAt = edge.now;
    await second.page.getByTestId("approve-button").click();
    await expect(second.page.getByTestId("locked-note")).toContainText("approved and is published", { timeout: 30_000 });
    expect((await sql`select web_published_at from alert_entry where id = ${ref.entryId}`)[0].web_published_at).not.toBeNull();
    // The origin has it at once: approval expired the feed's tag after it committed, so the next read waits for a fresh answer (AD-17).
    const origin = JSON.parse(await (await request.get("/api/feed?lang=en")).text());
    expect(origin.threads.map((thread: { slug: string }) => thread.slug)).toContain(slug);
    expect(origin.threads).toHaveLength(baseline + 1);

    // 60 seconds in: the phone's first poll since it opened. The edge still holds the copy made 13 seconds ago, so the answer has no alert.
    await advance(13_000);
    await settled(3);
    expect(edge.served.at(-1)).toEqual({ at: approvedAt + 13_000, from: "edge", threads: baseline });
    await expect(page.getByTestId(`alert-card-${slug}`)).toHaveCount(0);

    // Up to the second before the next poll, the resident has still not seen it.
    await advance(FEED_POLL_MS - 1_000);
    await expect(page.getByTestId(`alert-card-${slug}`)).toHaveCount(0);
    expect(edge.served).toHaveLength(3);

    // 120 seconds in: the next poll. The copy is 73 seconds old, so the edge asks the origin, and the alert is on the screen.
    await advance(1_000);
    await settled(4);
    expect(edge.served.at(-1)).toEqual({ at: approvedAt + 13_000 + FEED_POLL_MS, from: "origin", threads: baseline + 1 });
    await expect(page.getByTestId(`alert-card-${slug}`)).toBeVisible({ timeout: 30_000 });
    const seenAfter = edge.now - approvedAt;

    expect(seenAfter).toBe(13_000 + FEED_POLL_MS);
    expect(seenAfter, `seen ${seenAfter} ms after approval; budget ${FEED_VISIBILITY_BUDGET_MS} ms; answers ${JSON.stringify(edge.served)}`).toBeLessThanOrEqual(FEED_VISIBILITY_BUDGET_MS);
    // The words on the card are the alert the Hub approved, in the resident's language.
    await expect(page.getByTestId(`alert-card-${slug}`)).toContainText("Elevator");
    await expect(page.getByTestId(`alert-card-${slug}`).getByTestId("alert-verification")).toHaveText("Verified by the Hub");
  } finally {
    await resident.close();
    await writer.context.close();
    await second.context.close();
  }
});
