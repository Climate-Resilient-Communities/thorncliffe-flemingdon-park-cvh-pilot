// An ambassador posts an update or incident for their floors in a browser (S08.02, A-02), against the production build with the identity fake and the translation
// fake (playwright.staff.config.ts): on a phone, from their home, they choose the building's floors, what is happening, where things stand and the text, see the
// attribution residents will read before they press, and the post waits for the Hub as an ambassador's post (O-07) that a Coordinator approves; residents then
// read it as the building ambassador's. Without signal the post is held in the open page (nothing in the phone's storage) and sent with the same key when signal
// returns. Other puts the 911 block first and needs its line. A building they are not assigned to is refused by a direct request. In a drill the post is
// practice: marked as an exercise, and residents never read it.
//
// S08.03: a lower-risk post (here an elevator) is on the web from its submit, marked "Not yet verified", before the Hub has looked at it (the feed, the alert's
// address and the shared link); the approval then makes it "Verified by the Hub". "Other" and fire appear nowhere until approved. The Hub discarding a post
// residents already read withdraws it: residents read "Withdrawn" in its place and nothing is queued.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";
import { approve, newBuilding, newCoordinator, personOnAPhone, sharedPreview, waitForFeedToList } from "./alert-flow";

const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
const pepper = process.env.STAFF_PASSWORD_PEPPER;

let sql: postgres.Sql;
let mine: string;
let other: string;
const MINE_ADDRESS = "71 Ambassador Post Dr";
const OTHER_ADDRESS = "73 Ambassador Post Dr";

test.beforeAll(async () => {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
  mine = await newBuilding(sql, MINE_ADDRESS);
  other = await newBuilding(sql, OTHER_ADDRESS);
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

/** An Ambassador with their own password, assigned to every floor of this run's building. */
async function newAmbassador() {
  const username = `amb${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const authUserId = memoryIdentityProvider({ file: fakeFile }).plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  const id = randomUUID();
  await sql`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
            values (${id}, ${authUserId}, ${username}, 'Rashid', 'Post', 'someone@example.org', 'ambassador', false)`;
  await sql`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${id}, ${mine}, true, ${id})`;
  return { id, username, password };
}

async function signInAs(page: Page, person: { username: string; password: string }) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(person.username);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

/** The phone's storage after a post: nothing in it, whatever happened. */
const storage = (page: Page) =>
  page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    databases: (await indexedDB.databases()).length,
    caches: "caches" in window ? (await caches.keys()).length : 0,
  }));

/** Fills the form: Elevator, floors 1 to 3, a problem, the text. */
async function fillPost(page: Page, text: string) {
  await page.getByRole("checkbox", { name: "Elevator" }).check();
  await page.getByRole("radio", { name: /^A range of floors/ }).check();
  await page.getByLabel("From floor").selectOption({ label: "1" });
  await page.getByLabel("To floor").selectOption({ label: "3" });
  await page.getByRole("radio", { name: "There is a problem" }).check();
  await page.getByLabel(/^What is happening, in English/).fill(text);
}

/** The first entry of the thread with this slug as the feed tells residents, or null when the feed does not list it. */
async function entryOf(request: Page["request"], slug: string) {
  const feed = (await (await request.get("/api/feed?lang=en")).json()) as { threads: { slug: string; entries: { attribution: unknown; verified: boolean }[] }[] };
  return feed.threads.find((thread) => thread.slug === slug)?.entries[0] ?? null;
}

const entriesBy = (authorId: string) => sql<{ id: string; alert_id: string; status: string; attributed_rsn: string | null; version: number }[]>`
  select id, alert_id, status, attributed_rsn, version from alert_entry where author_id = ${authorId} order by created_at`;

test("an ambassador posts for their floors from their home, sees the attribution first, and the Hub approves it as an ambassador's post residents read as the building's", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const person = await newAmbassador();
  await signInAs(page, person);
  await page.getByTestId("amb-post-link").click();
  await expect(page).toHaveURL(/\/staff\/ambassador\/post$/);
  await expect(page.getByRole("heading", { level: 1, name: "Post a building update" })).toBeVisible();
  // The attribution residents will read is shown before Submit, never the person's name.
  await expect(page.getByTestId("post-appears-as")).toHaveText(`This will appear as: Building ambassador, ${MINE_ADDRESS}`);
  await expect(page.getByTestId("post-bar")).not.toContainText("Rashid");
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

  await fillPost(page, "The elevator is out on floors 1 to 3. Use the stairs with care.");
  await page.getByRole("button", { name: "Post update: floors 1 to 3" }).click();
  await expect(page.getByTestId("post-done")).toContainText("Live. Not yet verified", { timeout: 60_000 });
  expect(await storage(page)).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });

  const [entry] = await entriesBy(person.id);
  expect(entry).toMatchObject({ status: "pending_approval", attributed_rsn: mine, version: 1 });

  // An elevator is a lower-risk type (D-1): residents already read it, marked "Not yet verified", before the Hub has looked at it.
  const [{ slug }] = await sql<{ slug: string }[]>`select slug from alert where id = ${entry.alert_id}`;
  await waitForFeedToList(page.request, "en", slug);
  expect((await entryOf(page.request, slug))).toMatchObject({ verified: false, attribution: { role: "ambassador", rsn: mine } });
  const unverifiedPage = await page.request.get(`/en/alerts/${slug}`);
  expect(unverifiedPage.status()).toBe(200);
  expect(await unverifiedPage.text()).toContain("Not yet verified");
  expect((await sharedPreview(page.request, slug)).description).toContain("Not yet verified");

  // The Hub's second person reviews it as an ambassador's post (O-07), told that residents already read it, and approves it.
  const coordinator = await newCoordinator(sql);
  const hub = await personOnAPhone(browser, baseURL, coordinator);
  await hub.page.goto(`/staff/alerts/approve?alert=${entry.alert_id}&entry=${entry.id}`);
  await expect(hub.page.getByRole("heading", { level: 1, name: "Review an ambassador post" })).toBeVisible();
  await expect(hub.page.getByTestId("live-note")).toContainText('Residents already read this post on the web, marked "Not yet verified".');
  // A post residents already read never returns to draft: Approve and Discard only.
  await expect(hub.page.getByTestId("return-button")).toHaveCount(0);
  await approve(hub.page, { alertId: entry.alert_id, entryId: entry.id });
  await hub.context.close();

  await expect.poll(async () => (await entryOf(page.request, slug))?.verified, { timeout: 45_000 }).toBe(true);
  expect(await entryOf(page.request, slug)).toMatchObject({ verified: true, attribution: { role: "ambassador", rsn: mine } });
  expect((await sql`select web_published_at < approved_at as before from alert_entry where id = ${entry.id}`)[0].before).toBe(true);
});

test("the Hub discarding a post residents already read withdraws it: residents read 'Withdrawn' in its place and no text is queued", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const person = await newAmbassador();
  await signInAs(page, person);
  await page.goto("/staff/ambassador/post");
  await fillPost(page, "The elevator is out on floors 1 to 3. Use the stairs with care.");
  await page.getByRole("button", { name: "Post update: floors 1 to 3" }).click();
  await expect(page.getByTestId("post-done")).toContainText("Live. Not yet verified", { timeout: 60_000 });
  const [entry] = await entriesBy(person.id);
  const [{ slug }] = await sql<{ slug: string }[]>`select slug from alert where id = ${entry.alert_id}`;
  await waitForFeedToList(page.request, "en", slug);

  const coordinator = await newCoordinator(sql);
  const hub = await personOnAPhone(browser, baseURL, coordinator);
  await hub.page.goto(`/staff/alerts/approve?alert=${entry.alert_id}&entry=${entry.id}`);
  await hub.page.getByTestId("discard-button").click();
  await expect(hub.page.getByText('they see "Withdrawn" in its place')).toBeVisible();
  await hub.page.getByTestId("discard-confirm-button").click();
  await expect(hub.page.getByTestId("locked-note")).toBeVisible({ timeout: 30_000 });
  await hub.context.close();

  // The entry is superseded by a system withdrawal, never discarded or returned to draft; the thread had nothing else, so it closed as withdrawn.
  expect((await sql`select status, discard_reason from alert_entry where id = ${entry.id}`)[0]).toMatchObject({ status: "superseded", discard_reason: null });
  expect((await sql`select kind, status from alert_entry where supersedes_id = ${entry.id}`)[0]).toEqual({ kind: "withdrawal", status: "published_system" });
  expect((await sql`select status, closed_reason from alert where id = ${entry.alert_id}`)[0]).toEqual({ status: "closed", closed_reason: "withdrawn" });
  expect((await sql`select count(*)::int as n from delivery where entry_id = ${entry.id}`)[0].n).toBe(0);
  await expect.poll(async () => (await entryOf(page.request, slug)) === null, { timeout: 45_000 }).toBe(true);
  const closedPage = await page.request.get(`/en/alerts/${slug}`);
  expect(closedPage.status()).toBe(200);
  expect(await closedPage.text()).toContain("Withdrawn");
});

test("Other appears nowhere until the Hub approves it: not in the feed, not at its address, not in the shared link", async ({ page, browser, baseURL }) => {
  test.setTimeout(180_000);
  const person = await newAmbassador();
  await signInAs(page, person);
  await page.goto("/staff/ambassador/post");
  await page.getByRole("checkbox", { name: "Other" }).check();
  await page.getByRole("radio", { name: /^A range of floors/ }).check();
  await page.getByLabel("From floor").selectOption({ label: "1" });
  await page.getByLabel("To floor").selectOption({ label: "3" });
  await page.getByRole("radio", { name: "There is a problem" }).check();
  await page.getByLabel(/^Say what is happening, in one line/).fill("The front door does not lock and a stranger is inside.");
  await page.getByRole("button", { name: "Post update: floors 1 to 3" }).click();
  await expect(page.getByTestId("post-done")).toContainText("Waiting for the Hub", { timeout: 60_000 });
  const [entry] = await entriesBy(person.id);
  expect(entry).toMatchObject({ status: "pending_approval" });
  const [{ slug, web_published_at: publishedAtSubmit }] = await sql<{ slug: string; web_published_at: Date | null }[]>`select a.slug, e.web_published_at from alert a join alert_entry e on e.alert_id = a.id where e.id = ${entry.id}`;
  expect(publishedAtSubmit).toBeNull();
  const feed = (await (await page.request.get("/api/feed?lang=en")).json()) as { threads: { slug: string }[] };
  expect(feed.threads.map((thread) => thread.slug)).not.toContain(slug);
  expect((await page.request.get(`/en/alerts/${slug}`)).status()).toBe(404);
  expect((await page.request.get(`/a/${slug}?l=en`)).status()).toBe(404);

  const coordinator = await newCoordinator(sql);
  const hub = await personOnAPhone(browser, baseURL, coordinator);
  await hub.page.goto(`/staff/alerts/approve?alert=${entry.alert_id}&entry=${entry.id}`);
  await expect(hub.page.getByTestId("live-note")).toHaveCount(0);
  await expect(hub.page.getByTestId("return-button")).toBeVisible();
  await approve(hub.page, { alertId: entry.alert_id, entryId: entry.id });
  await hub.context.close();
  await waitForFeedToList(page.request, "en", slug);
  expect(await entryOf(page.request, slug)).toMatchObject({ verified: true, attribution: { role: "ambassador", rsn: mine } });
});

test("without signal the post is held in the open page, says so, and is sent with the same key when signal returns; nothing is stored on the phone", async ({ page, context }) => {
  test.setTimeout(120_000);
  const person = await newAmbassador();
  await signInAs(page, person);
  await page.goto("/staff/ambassador/post");
  await fillPost(page, "No water on floors 1 to 3 since this morning.");
  await context.setOffline(true);
  await page.getByRole("button", { name: /^Post update:/ }).click();
  await expect(page.getByTestId("post-unsent")).toContainText("Not sent yet. Keep this page open; it sends when you have signal.");
  await expect(page.getByTestId("post-unsent")).toContainText("If you close this page, this update is lost.");
  await expect(page.getByRole("button", { name: /^Post update:/ })).toBeDisabled();
  expect(await entriesBy(person.id)).toEqual([]);
  expect(await storage(page)).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });

  await context.setOffline(false);
  await expect(page.getByTestId("post-done")).toContainText("Live. Not yet verified", { timeout: 60_000 });
  const entries = await entriesBy(person.id);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ status: "pending_approval", version: 1 });
  expect((await sql`select count(*)::int as n from alert_submit_attempt where entry_id = ${entries[0].id}`)[0].n).toBe(1);
  expect(await storage(page)).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });
});

test("Other puts the 911 block first and needs a line of text", async ({ page }) => {
  const person = await newAmbassador();
  await signInAs(page, person);
  await page.goto("/staff/ambassador/post");
  await expect(page.locator('[data-component="not-911"]')).toHaveCount(0);
  await page.getByRole("checkbox", { name: "Other" }).check();
  await expect(page.locator('[data-component="not-911"]')).toContainText("If someone is in danger, call 911.");
  const top = async (selector: string) => (await page.locator(selector).first().boundingBox())!.y;
  expect(await top('[data-component="not-911"]')).toBeLessThan(await top("#post-text"));
  await page.getByRole("radio", { name: "There is a problem" }).check();
  await page.getByRole("button", { name: /^Post update:/ }).click();
  await expect(page.getByText("Other needs one line: say what is happening.")).toBeVisible();
  expect(await entriesBy(person.id)).toEqual([]);
});

test("a building the ambassador is not assigned to is refused by a direct request, before anything is made", async ({ page }) => {
  const person = await newAmbassador();
  await signInAs(page, person);
  const body = {
    v: 1,
    into: null,
    alert_id: randomUUID(),
    entry_id: randomUUID(),
    key: randomUUID(),
    rsn: other,
    floors: { mode: "all" },
    types: ["elevator"],
    phase: "problem",
    valid: { mode: "resolved" },
    text: "The elevator is out.",
  };
  const refused = await page.request.post("/api/staff/ambassador/posts", { data: body, headers: { "content-type": "application/json" } });
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toEqual({ error: "forbidden" });
  expect(refused.headers()["cache-control"]).toBe("no-store");
  expect(await entriesBy(person.id)).toEqual([]);
});

/** A running thread about one building with an approved acknowledgement, inserted directly (the lifecycle's trigger off, as the database tests do). */
async function runningThread(opts: { isDrill: boolean; rsn: string; text: string }): Promise<{ alertId: string; slug: string }> {
  const coordinator = await newCoordinator(sql);
  const alertId = randomUUID();
  const hash = randomBytes(32).toString("hex");
  const slug = `${opts.isDrill ? "drl" : "run"}${randomBytes(4).toString("hex")}`.slice(0, 10);
  await sql.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${coordinator.id}, true)`;
    await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, ${opts.isDrill}, now() - interval '1 hour', ${coordinator.id}, ${slug})`;
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies, submitted_at,
                                       approved_by, approved_at, approved_version, approved_hash, web_published_at)
             values (${randomUUID()}, ${alertId}, 'ack', 'approved', ${coordinator.id}, ${[coordinator.id]}, ${opts.text}, ${["elevator"]},
                     ${tx.json({ scope: "buildings", buildings: [{ rsn: opts.rsn, floors: null }], groups: [], types: ["elevator"] })}, 'problem', now() + interval '1 day', 1, ${hash},
                     ${tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } })}, now() - interval '30 minutes', ${coordinator.id}, now() - interval '20 minutes', 1, ${hash}, now() - interval '20 minutes')`;
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
  });
  return { alertId, slug };
}

test("an update into a running alert about another building is refused by a direct request for their own building, and nothing is made", async ({ page }) => {
  const person = await newAmbassador();
  const elsewhere = await runningThread({ isDrill: false, rsn: other, text: "The elevator is out at the other building." });
  await signInAs(page, person);
  // The home never offers it: the alert is about a building they are not assigned to.
  await expect(page.getByTestId("amb-active")).not.toContainText("The elevator is out at the other building.");
  const body = {
    v: 1,
    into: elsewhere.alertId,
    alert_id: randomUUID(),
    entry_id: randomUUID(),
    key: randomUUID(),
    rsn: mine,
    floors: { mode: "all" },
    types: ["elevator"],
    phase: "problem",
    valid: { mode: "resolved" },
    text: "The elevator is out.",
  };
  const refused = await page.request.post("/api/staff/ambassador/posts", { data: body, headers: { "content-type": "application/json" } });
  expect(await refused.json()).toMatchObject({ state: "refused", outcome: "OUT_OF_SCOPE" });
  expect(await entriesBy(person.id)).toEqual([]);
});

test("in a drill the post is practice: marked as an exercise on the screen, kept apart on the home, and never read by residents", async ({ page }) => {
  test.setTimeout(120_000);
  const person = await newAmbassador();
  // A drill about the building, running, with an approved acknowledgement.
  const { alertId, slug } = await runningThread({ isDrill: true, rsn: mine, text: "Drill: the elevator is out." });

  await signInAs(page, person);
  await expect(page.getByTestId("amb-drills")).toContainText("Drill: the elevator is out.");
  await expect(page.getByTestId("amb-active")).not.toContainText("Drill: the elevator is out.");
  await page.getByTestId("amb-drill").getByRole("link", { name: "Post a practice update" }).click();
  await expect(page.getByTestId("post-exercise")).toHaveText("Exercise: this post is practice. It goes to the Hub only, never to residents.");
  await expect(page.getByText("Practice: this goes to the Hub only. Nothing is sent to residents.")).toBeVisible();
  await page.getByRole("radio", { name: "Work is under way" }).check();
  await page.getByLabel(/^What is happening, in English/).fill("Practice: the elevator company is on site.");
  await page.getByRole("button", { name: "Post update: whole building" }).click();
  await expect(page.getByTestId("post-done")).toContainText("Practice post saved", { timeout: 60_000 });
  const [entry] = await entriesBy(person.id);
  expect(entry).toMatchObject({ alert_id: alertId, status: "pending_approval" });
  // Residents never read a drill: not in the feed, and its address is not found.
  const feed = (await (await page.request.get("/api/feed?lang=en")).json()) as { threads: { slug: string }[] };
  expect(feed.threads.map((thread) => thread.slug)).not.toContain(slug);
  expect((await page.request.get(`/a/${slug}`)).status()).toBe(404);
});
