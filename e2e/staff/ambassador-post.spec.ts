// An ambassador posts an update or incident for their floors in a browser (S08.02, A-02), against the production build with the identity fake and the translation
// fake (playwright.staff.config.ts): on a phone, from their home, they choose the building's floors, what is happening, where things stand and the text, see the
// attribution residents will read before they press, and the post waits for the Hub as an ambassador's post (O-07) that a Coordinator approves; residents then
// read it as the building ambassador's. Without signal the post is held in the open page (nothing in the phone's storage) and sent with the same key when signal
// returns. Other puts the 911 block first and needs its line. A building they are not assigned to is refused by a direct request. In a drill the post is
// practice: marked as an exercise, and residents never read it.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";
import { approve, newBuilding, newCoordinator, personOnAPhone, waitForFeedToList } from "./alert-flow";

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
  await expect(page.getByTestId("post-done")).toContainText("Waiting for the Hub", { timeout: 60_000 });
  expect(await storage(page)).toEqual({ local: 0, session: 0, databases: 0, caches: 0 });

  const [entry] = await entriesBy(person.id);
  expect(entry).toMatchObject({ status: "pending_approval", attributed_rsn: mine, version: 1 });

  // The Hub's second person reviews it as an ambassador's post (O-07) and approves it.
  const coordinator = await newCoordinator(sql);
  const hub = await personOnAPhone(browser, baseURL, coordinator);
  await hub.page.goto(`/staff/alerts/approve?alert=${entry.alert_id}&entry=${entry.id}`);
  await expect(hub.page.getByRole("heading", { level: 1, name: "Review an ambassador post" })).toBeVisible();
  await approve(hub.page, { alertId: entry.alert_id, entryId: entry.id });
  await hub.context.close();

  const [{ slug }] = await sql<{ slug: string }[]>`select slug from alert where id = ${entry.alert_id}`;
  await waitForFeedToList(page.request, "en", slug);
  const feed = (await (await page.request.get("/api/feed?lang=en")).json()) as { threads: { slug: string; entries: { attribution: unknown; verified: boolean }[] }[] };
  expect(feed.threads.find((thread) => thread.slug === slug)?.entries[0]).toMatchObject({ verified: true, attribution: { role: "ambassador", rsn: mine } });
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
  await expect(page.getByTestId("post-done")).toContainText("Waiting for the Hub", { timeout: 60_000 });
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

test("in a drill the post is practice: marked as an exercise on the screen, kept apart on the home, and never read by residents", async ({ page }) => {
  test.setTimeout(120_000);
  const person = await newAmbassador();
  // A drill about the building, running, with an approved acknowledgement (inserted directly, the lifecycle's trigger off, as the database tests do).
  const coordinator = await newCoordinator(sql);
  const alertId = randomUUID();
  const hash = randomBytes(32).toString("hex");
  const slug = `drl${randomBytes(4).toString("hex")}`.slice(0, 10);
  await sql.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${coordinator.id}, true)`;
    await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, true, now() - interval '1 hour', ${coordinator.id}, ${slug})`;
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies, submitted_at,
                                       approved_by, approved_at, approved_version, approved_hash, web_published_at)
             values (${randomUUID()}, ${alertId}, 'ack', 'approved', ${coordinator.id}, ${[coordinator.id]}, 'Drill: the elevator is out.', ${["elevator"]},
                     ${tx.json({ scope: "buildings", buildings: [{ rsn: mine, floors: null }], groups: [], types: ["elevator"] })}, 'problem', now() + interval '1 day', 1, ${hash},
                     ${tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } })}, now() - interval '30 minutes', ${coordinator.id}, now() - interval '20 minutes', 1, ${hash}, now() - interval '20 minutes')`;
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
  });

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
