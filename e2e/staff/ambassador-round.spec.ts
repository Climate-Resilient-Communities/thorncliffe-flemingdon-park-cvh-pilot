// "My round" in a browser (S08.07, A-04), against the production build with the identity fake (playwright.staff.config.ts): an Ambassador opens it from their
// home during an open heat round and sees the requests on the floors they cover, each number a call or a text link; the round lives only in the page (the
// automated check of the service worker's caches, localStorage, sessionStorage, IndexedDB and cookies); a tap is sent at once with signal, and without signal
// the marks wait in the page, in order, are counted, warn before leaving and go when signal returns; in the background, with the browser's timers suspended
// (a clock jump), a return at 9 minutes keeps the round and one at 10 minutes clears it and every unsent mark ("Reload your round with signal"); back
// navigation after leaving reads the round again from the server, and a restore from the page cache (its events in the browser's order) after 10 minutes
// says to reload and reads nothing until asked; late marks are told
// "The Hub has been told", "This request has ended" and, after 2 hours, "This round has ended" with the Hub's number; and a direct request from an Ambassador
// who does not cover a floor gets counts only for it and is refused a mark there. Every number is fictional (555-01xx).
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import type postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";
import { newBuilding } from "./alert-flow";
import { openDatabase } from "./helpers";

const ROUND_PAGE = "/staff/ambassador/round";
const ROUND_ROUTE = "/api/staff/ambassador/round";
const MARK_ROUTE = "/api/staff/ambassador/marks";
const TEN_MINUTES = 10 * 60 * 1000;

let sql: postgres.Sql;
const threads: string[] = [];

test.beforeAll(async () => {
  sql = openDatabase();
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
});

test.afterAll(async () => {
  // This run's rounds end, so no other test's feed or home lists them.
  for (const alertId of threads) {
    await sql`delete from checkin where alert_id = ${alertId}`;
    await sql.begin(async (tx) => {
      await tx.unsafe("alter table alert disable trigger alert_guard");
      await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${alertId}`;
      await tx.unsafe("alter table alert enable trigger alert_guard");
    });
  }
  await sql?.end({ timeout: 5 });
});

interface Person {
  id: string;
  username: string;
  password: string;
}

async function account(role: "ambassador" | "coordinator" | "admin"): Promise<Person> {
  const username = `rnd${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const authUserId = memoryIdentityProvider({ file: process.env.CVH_FAKE_IDENTITY_FILE }).plant(`${username}@staff.cvh.invalid`, {
    password: pepperPassword(process.env.STAFF_PASSWORD_PEPPER as string, password),
    createdAt: new Date(),
  });
  const id = randomUUID();
  await sql`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
            values (${id}, ${authUserId}, ${username}, 'Rashid', 'Round', 'someone@example.org', ${role}, false)`;
  return { id, username, password };
}

/** An Ambassador of these floors of the building (labels). */
async function ambassadorOf(rsn: string, labels: string[]): Promise<Person> {
  const person = await account("ambassador");
  await sql.begin(async (tx) => {
    await tx`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${person.id}, ${rsn}, false, ${person.id})`;
    await tx`insert into ambassador_assignment_floor (staff_id, rsn, floor_id) select ${person.id}, ${rsn}, id from building_floor where rsn = ${rsn} and label in ${tx(labels)}`;
  });
  return person;
}

let serial = 0;
/**
 * A round of this run: a building with floors G to 4, an open heat thread about it (an update the Hub approved, residents read), three residents asking for
 * a check-in (floor 1 by call, floor 2 by text, floor 3 by call) with their rows, and an Ambassador of floors 1 and 2.
 */
async function aRound() {
  const rsn = await newBuilding(sql, `${40 + (serial % 50)} Round Test Dr`);
  serial += 1;
  const floorOf = async (label: string) => ((await sql`select id from building_floor where rsn = ${rsn} and label = ${label}`)[0] as { id: string }).id;
  const author = await account("coordinator");
  const approver = await account("admin");
  const alertId = randomUUID();
  const slug = randomBytes(5).toString("hex");
  const hash = randomBytes(32).toString("hex");
  const audience = { scope: "buildings", buildings: [{ rsn, floors: null }], groups: [], types: ["heat"] };
  await sql.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${author.id}, true)`;
    await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, false, ${new Date(Date.now() - 600_000)}, ${author.id}, ${slug})`;
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies,
                                      submitted_at, approved_by, approved_at, approved_version, approved_hash, web_published_at)
             values (${randomUUID()}, ${alertId}, 'update', 'approved', ${author.id}, ${[author.id]}, 'Extreme heat until Thursday. Cooling centres are open.', ${["heat"]},
                     ${tx.json(audience)}, 'problem', ${new Date(Date.now() + 86_400_000)}, 1, ${hash}, ${tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } })},
                     ${new Date(Date.now() - 300_000)}, ${approver.id}, ${new Date(Date.now() - 240_000)}, 1, ${hash}, ${new Date(Date.now() - 240_000)})`;
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
  });
  threads.push(alertId);
  const residents: { id: string; phone: string; roundRef: string; shown: string }[] = [];
  for (const [label, method] of [["1", "call"], ["2", "text"], ["3", "call"]] as const) {
    const id = randomUUID();
    const floor = await floorOf(label);
    const phone = `+1416555${String(100 + ((serial * 7 + residents.length) % 100)).padStart(4, "0")}`;
    await sql`delete from subscriber where phone = ${phone}`;
    await sql`insert into subscriber (id, phone, lang, neighbourhood_id, groups, consent_version, started_by, checkin_method, checkin_consent_version, where_i_live_rsn, where_i_live_floor_id)
              values (${id}, ${phone}, 'en', 'TP', '{}', '2026-10-02.1', 'web', ${method}, '2026-10-06.1', ${rsn}, ${floor})`;
    await sql`insert into subscriber_place (id, subscriber_id, rsn, floor_id) values (${randomUUID()}, ${id}, ${rsn}, ${floor})`;
    const [row] = await sql`insert into checkin (id, alert_id, subscriber_id, rsn, floor_id, method) values (${randomUUID()}, ${alertId}, ${id}, ${rsn}, ${floor}, ${method}) returning round_ref`;
    residents.push({ id, phone, roundRef: (row as { round_ref: string }).round_ref, shown: `(416) 555-${phone.slice(-4)}` });
  }
  const ambassador = await ambassadorOf(rsn, ["1", "2"]);
  return { rsn, alertId, residents, ambassador };
}

async function signIn(page: Page, person: Person) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(person.username);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

const rowOf = (page: Page, roundRef: string) => page.locator(`[data-round-ref="${roundRef}"]`);
const statusOf = async (roundRef: string) => (await sql`select status, cardinality(mark_ids)::int as marks from checkin where round_ref = ${roundRef}`)[0] as { status: string; marks: number };

/** The page goes to the background, or comes back to the front, as the browser says it (`visibilitychange`). */
const setVisibility = (page: Page, state: "hidden" | "visible") =>
  page.evaluate((next) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => next });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => next === "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);

/** Everything the phone could keep: localStorage and sessionStorage (every key and value), IndexedDB, every URL in the Cache API (the service worker's caches), and the cookies. */
async function phoneStorage(page: Page) {
  const inPage = await page.evaluate(async () => {
    const cached: string[] = [];
    if ("caches" in window) for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) cached.push(request.url);
    const entries = (storage: Storage) => Object.fromEntries(Array.from({ length: storage.length }, (_, index) => storage.key(index) as string).map((key) => [key, storage.getItem(key)]));
    return { local: entries(localStorage), session: entries(sessionStorage), databases: (await indexedDB.databases()).map((database) => database.name), cached };
  });
  return { ...inPage, cookies: await page.context().cookies() };
}

/** What the phone held before the round was opened (the resident app keeps its own choices; the staff session is a cookie). */
type Held = Awaited<ReturnType<typeof phoneStorage>>;

/**
 * Asserts the phone holds nothing of the round: storage, IndexedDB and cookies as they were before it was opened, no cached staff address, and no number or
 * round_ref anywhere in them.
 */
async function expectNothingOnThePhone(page: Page, residents: { phone: string; roundRef: string }[], before: Held) {
  const held = await phoneStorage(page);
  expect(held.local, "localStorage as before").toEqual(before.local);
  expect(held.session, "sessionStorage as before").toEqual(before.session);
  expect(held.databases, "no IndexedDB database").toEqual([]);
  expect(held.cached.filter((url) => /\/staff|\/api\/staff/.test(url)), "the service worker's caches hold no staff page or call").toEqual([]);
  expect(held.cookies.map((cookie) => cookie.name).sort(), "no cookie was added").toEqual(before.cookies.map((cookie) => cookie.name).sort());
  const everything = JSON.stringify([held.local, held.session, held.cached, held.cookies.map((cookie) => cookie.value)]);
  for (const resident of residents) {
    expect(everything).not.toContain(resident.phone.slice(2));
    expect(everything).not.toContain(resident.roundRef);
  }
}

test("an Ambassador opens My round from their home: the requests on their floors as call and text links, and nothing of it on the phone", async ({ page }) => {
  test.setTimeout(120_000);
  const { residents, ambassador } = await aRound();
  // The resident app's service worker is installed on this phone (a resident page first), so it is there to keep anything it would keep.
  await page.goto("/en");
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, undefined, { timeout: 60_000 });
  await signIn(page, ambassador);
  const before = await phoneStorage(page);

  await expect(page.getByTestId("amb-round-count")).toHaveText("2 check-in requests on your floors");
  const pageAnswer = page.waitForResponse((response) => new URL(response.url()).pathname === ROUND_PAGE && response.request().resourceType() === "document");
  const roundAnswer = page.waitForResponse((response) => new URL(response.url()).pathname === ROUND_ROUTE);
  await page.getByTestId("amb-round-link").click();
  expect((await pageAnswer).headers()["cache-control"]).toContain("no-store");
  const answered = await roundAnswer;
  expect(answered.request().method()).toBe("POST");
  expect(answered.headers()["cache-control"]).toContain("no-store");

  await expect(page.getByRole("heading", { level: 1, name: "My round" })).toBeVisible();
  const [onFirst, onSecond, onThird] = residents;
  await expect(rowOf(page, onFirst!.roundRef).getByRole("link", { name: `Call ${onFirst!.shown}` })).toHaveAttribute("href", `tel:${onFirst!.phone}`);
  await expect(rowOf(page, onSecond!.roundRef).getByRole("link", { name: `Text ${onSecond!.shown}` })).toHaveAttribute("href", `sms:${onSecond!.phone}`);
  await expect(page.getByText("Floor 1", { exact: true })).toBeVisible();
  // Floor 3 is not theirs: counts only, never the number.
  await expect(page.getByTestId("round-floor-counts")).toContainText("1 to do · 0 done · 0 not reached · 0 need help");
  await expect(page.locator("body")).not.toContainText(onThird!.shown);
  await expect(rowOf(page, onThird!.roundRef)).toHaveCount(0);
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

  // The page is under the service worker's control, which neither answers nor keeps it.
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expectNothingOnThePhone(page, residents, before);
});

test("a tap with signal is sent at once; without signal marks wait in order, are counted, warn before leaving, and go when signal returns", async ({ page }) => {
  test.setTimeout(120_000);
  const { alertId, residents, ambassador } = await aRound();
  const [onFirst, onSecond] = residents;
  await signIn(page, ambassador);
  const before = await phoneStorage(page);
  const sent: { mark_id: string; round_ref: string; status: string }[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === MARK_ROUTE) sent.push(request.postDataJSON() as (typeof sent)[number]);
  });
  await page.goto(ROUND_PAGE);
  await rowOf(page, onFirst!.roundRef).getByRole("button", { name: "Done" }).click();
  await expect.poll(() => statusOf(onFirst!.roundRef)).toEqual({ status: "done", marks: 1 });
  await expect(rowOf(page, onFirst!.roundRef).getByTestId("round-marked")).toHaveText("Marked: Done");

  // A mark sent again with its id changes nothing.
  const again = await page.request.post(MARK_ROUTE, { data: { v: 1, mark_id: sent[0]!.mark_id, round_ref: onFirst!.roundRef, status: "done" } });
  expect(await again.json()).toEqual({ outcome: "already" });
  expect(await statusOf(onFirst!.roundRef)).toEqual({ status: "done", marks: 1 });

  await page.context().setOffline(true);
  await expect(page.getByTestId("round-offline")).toBeVisible();
  await rowOf(page, onFirst!.roundRef).getByRole("button", { name: "Not reached" }).click();
  await rowOf(page, onSecond!.roundRef).getByRole("button", { name: "Needs help" }).click();
  await expect(page.getByTestId("round-waiting")).toHaveText("2 marks are waiting to be sent. Keep this page open until marks are sent");
  await expect(rowOf(page, onSecond!.roundRef).getByTestId("round-not-sent")).toBeVisible();
  expect(await statusOf(onFirst!.roundRef)).toEqual({ status: "done", marks: 1 });
  await expectNothingOnThePhone(page, residents, before);

  // Leaving while marks wait: the browser asks first (the page stays when the person says no).
  const asked = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const dialog = await asked;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  expect(page.isClosed()).toBe(false);

  await page.context().setOffline(false);
  await expect(page.getByTestId("round-waiting")).toHaveCount(0, { timeout: 30_000 });
  await expect.poll(() => statusOf(onFirst!.roundRef)).toEqual({ status: "not_reached", marks: 2 });
  expect(await statusOf(onSecond!.roundRef)).toEqual({ status: "needs_help", marks: 1 });
  // In the order they were made, each with its own id.
  const later = sent.slice(1).filter((body, index, all) => all.findIndex((other) => other.mark_id === body.mark_id) === index);
  expect(later.map((body) => [body.round_ref, body.status])).toEqual([[onFirst!.roundRef, "not_reached"], [onSecond!.roundRef, "needs_help"]]);
  expect(new Set(sent.map((body) => body.mark_id)).size).toBe(3);
  // Not reached and needs help each told the Hub once.
  expect((await sql`select status from checkin_escalation where alert_id = ${alertId} order by status`).map((row) => row.status)).toEqual(["needs_help", "not_reached"]);
});

test("in the background with suspended timers: back at 9 minutes the round is kept; at 10 minutes it and every unsent mark are gone", async ({ page }) => {
  test.setTimeout(120_000);
  const { residents, ambassador } = await aRound();
  const [onFirst] = residents;
  await signIn(page, ambassador);
  await page.clock.install();
  let marksSent = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === MARK_ROUTE) marksSent += 1;
  });
  await page.goto(ROUND_PAGE);
  await expect(rowOf(page, onFirst!.roundRef)).toBeVisible();
  await page.context().setOffline(true);
  await rowOf(page, onFirst!.roundRef).getByRole("button", { name: "Needs help" }).click();
  await expect(page.getByTestId("round-waiting")).toContainText("1 mark is waiting to be sent.");

  // Hidden for 9 minutes: the clock jumps and no timer runs (as a phone suspends them); the round and the waiting mark are still there.
  await setVisibility(page, "hidden");
  let hiddenAt = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(hiddenAt + 9 * 60 * 1000);
  await setVisibility(page, "visible");
  await expect(rowOf(page, onFirst!.roundRef)).toBeVisible();
  await expect(page.getByTestId("round-waiting")).toContainText("1 mark is waiting to be sent.");

  // Hidden again, for 10 minutes: everything is cleared before the page is drawn again.
  await setVisibility(page, "hidden");
  hiddenAt = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(hiddenAt + TEN_MINUTES);
  await setVisibility(page, "visible");
  await expect(page.getByTestId("round-cleared")).toContainText("Reload your round with signal");
  await expect(page.locator("[data-round-ref]")).toHaveCount(0);
  await expect(page.getByTestId("round-waiting")).toHaveCount(0);
  for (const resident of residents) await expect(page.locator("body")).not.toContainText(resident.shown);

  // Signal comes back: the cleared mark is never sent; the round is read again only when asked.
  await page.context().setOffline(false);
  await page.clock.runFor(30_000);
  expect(marksSent).toBe(0);
  expect(await statusOf(onFirst!.roundRef)).toEqual({ status: "pending", marks: 0 });
  await page.getByRole("button", { name: "Reload my round" }).click();
  await expect(rowOf(page, onFirst!.roundRef)).toBeVisible();
});

test("back navigation after leaving reads the round again from the server; a restore from the page cache after 10 minutes says to reload", async ({ page }) => {
  test.setTimeout(120_000);
  const { residents, ambassador } = await aRound();
  const [onFirst] = residents;
  await signIn(page, ambassador);
  const before = await phoneStorage(page);
  let reads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === ROUND_ROUTE) reads += 1;
  });
  await page.goto(ROUND_PAGE);
  await expect(rowOf(page, onFirst!.roundRef)).toBeVisible();
  await page.getByRole("link", { name: "Back to my building" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`${ROUND_PAGE}$`));
  await expect(rowOf(page, onFirst!.roundRef)).toBeVisible();
  expect(reads, "the round was read again from the server, never from the phone").toBeGreaterThanOrEqual(2);
  await expectNothingOnThePhone(page, residents, before);

  // A page put in the browser's page cache, its events in Chromium's order (leaving: pagehide, then hidden; restored: visible, then pageshow): pagehide
  // clears the round at once; a restore within 10 minutes reads it again; after 10 minutes the page says to reload and reads nothing until asked.
  await page.clock.install();
  const leave = async () => {
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await setVisibility(page, "hidden");
  };
  const restore = async () => {
    await setVisibility(page, "visible");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
  };
  await leave();
  await expect(page.locator("[data-round-ref]")).toHaveCount(0);
  let leftAt = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(leftAt + 9 * 60 * 1000);
  await restore();
  await expect(rowOf(page, onFirst!.roundRef)).toBeVisible();
  await leave();
  leftAt = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(leftAt + TEN_MINUTES);
  const readsBefore = reads;
  await restore();
  await expect(page.getByTestId("round-cleared")).toContainText("Reload your round with signal");
  // It stays so: the round is not read again by itself (the restore's pageshow comes after the visibilitychange that cleared it).
  await page.waitForTimeout(1_000);
  expect(reads, "the round was not read again after 10 minutes away").toBe(readsBefore);
  await expect(page.getByTestId("round-cleared")).toBeVisible();
  await expect(page.locator("[data-round-ref]")).toHaveCount(0);
  await page.getByRole("button", { name: "Reload my round" }).click();
  await expect(rowOf(page, onFirst!.roundRef)).toBeVisible();
  expect(reads).toBe(readsBefore + 1);
});

test("late marks: 'The Hub has been told' and 'This request has ended' on a request that ended; after 2 hours 'This round has ended' with the Hub's number", async ({ page }) => {
  test.setTimeout(120_000);
  const { alertId, residents, ambassador } = await aRound();
  const [onFirst, onSecond] = residents;
  await signIn(page, ambassador);
  await page.goto(ROUND_PAGE);
  await expect(rowOf(page, onSecond!.roundRef)).toBeVisible();
  // While the page is open, both requests leave the round (withdrawn): the first just now, the second more than 2 hours ago.
  for (const resident of [onFirst!, onSecond!]) {
    await sql`update checkin set outcome = 'withdrawn', tallied_at = now(), subscriber_id = null, method = null, closed_at = now() where round_ref = ${resident.roundRef}`;
  }
  await sql.begin(async (tx) => {
    await tx.unsafe("alter table checkin disable trigger checkin_update_guard");
    await tx`update checkin set closed_at = now() - interval '3 hours' where round_ref = ${onSecond!.roundRef}`;
    await tx.unsafe("alter table checkin enable trigger checkin_update_guard");
  });

  await rowOf(page, onFirst!.roundRef).getByRole("button", { name: "Not reached" }).click();
  await expect(rowOf(page, onFirst!.roundRef).getByTestId("round-note")).toHaveText("The Hub has been told; call the Hub if you can");
  await rowOf(page, onFirst!.roundRef).getByRole("button", { name: "Done" }).click();
  await expect(rowOf(page, onFirst!.roundRef).getByTestId("round-note")).toHaveText("This request has ended");
  await rowOf(page, onSecond!.roundRef).getByRole("button", { name: "Needs help" }).click();
  const ended = rowOf(page, onSecond!.roundRef).getByTestId("round-note");
  await expect(ended).toHaveText("This round has ended. If someone needs help, call the Hub at (416) 421-8997");
  await expect(ended.getByRole("link")).toHaveAttribute("href", "tel:+14164218997");

  expect(await sql`select round_ref, status, late, raised_by from checkin_escalation where alert_id = ${alertId}`).toEqual([
    { round_ref: onFirst!.roundRef, status: "not_reached", late: true, raised_by: ambassador.id },
  ]);
});

test("a direct request from an Ambassador who does not cover a floor: counts only for it, and a mark there is refused and recorded", async ({ page }) => {
  test.setTimeout(120_000);
  const { rsn, residents } = await aRound();
  const [onFirst, , onThird] = residents;
  const other = await ambassadorOf(rsn, ["3"]);
  await signIn(page, other);
  const answer = await page.request.post(ROUND_ROUTE, { data: { v: 1 } });
  expect(answer.status()).toBe(200);
  expect(answer.headers()["cache-control"]).toContain("no-store");
  const round = (await answer.json()) as { rounds: { buildings: { address: string; floors: { kind: string; label: string; requests?: { round_ref: string; phone: string }[] }[] }[] }[] };
  const mine = round.rounds.flatMap((thread) => thread.buildings).flatMap((building) => building.floors);
  expect(mine.filter((floor) => floor.kind === "contacts").flatMap((floor) => floor.requests ?? []).map((request) => [request.round_ref, request.phone])).toContainEqual([onThird!.roundRef, onThird!.phone]);
  expect(JSON.stringify(round)).not.toContain(onFirst!.phone);

  const since = ((await sql`select coalesce(max(id), 0)::int as max from audit_event`)[0] as { max: number }).max;
  const refused = await page.request.post(MARK_ROUTE, { data: { v: 1, mark_id: randomUUID(), round_ref: onFirst!.roundRef, status: "needs_help" } });
  expect(refused.status()).toBe(403);
  expect(await statusOf(onFirst!.roundRef)).toEqual({ status: "pending", marks: 0 });
  expect(await sql`select action, outcome, meta->>'reason' as reason from audit_event where id > ${since} and actor_staff_id = ${other.id}`).toEqual([
    { action: "permission.denied", outcome: "refused", reason: "out_of_scope" },
  ]);
});
