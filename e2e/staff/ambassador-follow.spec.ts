// An ambassador follows their post and marks an incident resolved, in a browser (S08.04, A-03), against the production build with the identity fake and the
// translation fake (playwright.staff.config.ts): on a phone, from the page that says their post is posted, they open where it stands ("Live. Not yet verified"),
// correct it, and a second person approves the correction ("Corrected"); they withdraw another post and the Hub's approval withdraws it ("Withdrawn"); they send
// the final message of an alert about their building ("Mark resolved") and the alert stays open until a second person approves it; a post the Hub sent back
// reads "Returned to you" with the note; once a post is approved its texts' progress is shown. What is not theirs is refused by direct requests: another
// ambassador's post (even in the same building), another building's alert, and every role but an Ambassador.
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
const MINE_ADDRESS = "81 Ambassador Follow Dr";
const OTHER_ADDRESS = "83 Ambassador Follow Dr";

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

/** An Ambassador with their own password, assigned to every floor of this run's building (and, when asked, of the other). */
async function newAmbassador(rsns: string[] = [mine]) {
  const username = `amb${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const authUserId = memoryIdentityProvider({ file: fakeFile }).plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  const id = randomUUID();
  await sql`insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
            values (${id}, ${authUserId}, ${username}, 'Rashid', 'Follow', 'someone@example.org', 'ambassador', false)`;
  for (const rsn of rsns) await sql`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${id}, ${rsn}, true, ${id})`;
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

/** Posts an elevator problem for floors 1 to 3 (a lower-risk type: residents read it at once), or a fire alarm (which waits for the Hub); returns the page the person is on. */
async function postUpdate(page: Page, type: "Elevator" | "Fire alarm or evacuation", text: string) {
  await page.goto("/staff/ambassador/post");
  await page.getByRole("checkbox", { name: type }).check();
  await page.getByRole("radio", { name: /^A range of floors/ }).check();
  await page.getByLabel("From floor").selectOption({ label: "1" });
  await page.getByLabel("To floor").selectOption({ label: "3" });
  await page.getByRole("radio", { name: "There is a problem" }).check();
  await page.getByLabel(/^What is happening, in English/).fill(text);
  await page.getByRole("button", { name: "Post update: floors 1 to 3" }).click();
  await expect(page.getByTestId("post-done")).toBeVisible({ timeout: 60_000 });
}

const entriesBy = (authorId: string) => sql<{ id: string; alert_id: string; kind: string; status: string; web_published_at: Date | null; original_text: string }[]>`
  select id, alert_id, kind, status, web_published_at, original_text from alert_entry where author_id = ${authorId} order by created_at, id`;
const threadStatus = async (alertId: string) => (await sql`select status, closed_reason from alert where id = ${alertId}`)[0] as { status: string; closed_reason: string | null };

test("an ambassador sees their post is live and not yet verified, corrects it, and a second person's approval replaces it; the alert's texts and thread are untouched until then", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  const person = await newAmbassador();
  await signInAs(page, person);
  await postUpdate(page, "Elevator", "The elevator is out on floors 1 to 3. Use the stairs with care.");
  // A-02 says it is live and not yet verified, and links to where it stands.
  await expect(page.getByTestId("post-done-title")).toHaveText("Live. Not yet verified");
  await page.getByTestId("post-done-status").click();
  await expect(page).toHaveURL(/\/staff\/ambassador\/status\?entry=/);
  await expect(page.getByTestId("status-state").getByRole("heading")).toHaveText("Live. Not yet verified");
  await expect(page.getByTestId("status-yours")).toContainText("The elevator is out on floors 1 to 3.");
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
  expect((await page.request.get(page.url())).headers()["cache-control"]).toBe("no-store");

  const [original] = await entriesBy(person.id);
  expect(original).toMatchObject({ status: "pending_approval" });
  expect(original.web_published_at).not.toBeNull();

  // Correct it: a correction, live at once as "Not yet verified", replaces nothing until a second person approves it.
  await page.getByTestId("follow-correct").locator("summary").click();
  await page.locator("#follow-correct-text").fill("The elevator is out on floors 1 and 2 only. Use the stairs with care.");
  await page.getByRole("button", { name: "Send the correction" }).click();
  await expect(page.getByTestId("follow-done")).toContainText("Sent to the Hub", { timeout: 60_000 });
  await expect(page.getByTestId("follow-done")).toContainText("Residents read it now as");
  const entries = await entriesBy(person.id);
  const correction = entries.find((entry) => entry.kind === "correction");
  expect(correction).toMatchObject({ status: "pending_approval", original_text: "The elevator is out on floors 1 and 2 only. Use the stairs with care." });
  expect(correction?.web_published_at).not.toBeNull();
  expect((await sql`select status from alert_entry where id = ${original.id}`)[0].status).toBe("pending_approval");
  expect((await sql`select count(*)::int as n from delivery where entry_id in (${original.id}, ${correction!.id})`)[0].n).toBe(0);
  await page.reload();
  await expect(page.getByTestId("status-waiting")).toContainText("Your correction is waiting for the Hub.");
  await expect(page.getByTestId("follow-correct")).toHaveCount(0);

  const coordinator = await newCoordinator(sql);
  const hub = await personOnAPhone(browser, baseURL, coordinator);
  await approve(hub.page, { alertId: original.alert_id, entryId: correction!.id });
  await hub.context.close();

  await page.reload();
  await expect(page.getByTestId("status-state").getByRole("heading")).toHaveText("Corrected");
  await expect(page.getByTestId("status-state")).toContainText("Residents read instead: The elevator is out on floors 1 and 2 only.");
  expect((await sql`select status from alert_entry where id = ${original.id}`)[0].status).toBe("superseded");
  // The home words it as theirs, not the Hub's, and links to it.
  await page.goto("/staff");
  await expect(page.getByTestId("amb-post-state").first()).toHaveText(/Corrected|Approved|Verified by the Hub/);
  await expect(page.getByTestId("amb-post-link-status").first()).toHaveText("Where it stands");
});

test("an ambassador withdraws their own post: it waits for a second person, and the Hub's approval withdraws it", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  const person = await newAmbassador();
  await signInAs(page, person);
  await postUpdate(page, "Elevator", "The elevator is out on floors 1 to 3. Use the stairs with care.");
  const [original] = await entriesBy(person.id);
  await page.goto(`/staff/ambassador/status?entry=${original.id}`);
  await page.getByTestId("follow-withdraw").locator("summary").click();
  // A reason is needed.
  await page.getByRole("button", { name: "Withdraw this update" }).click();
  await expect(page.getByText("Choose why you are withdrawing it.")).toBeVisible();
  expect((await entriesBy(person.id)).filter((entry) => entry.kind === "withdrawal")).toEqual([]);
  await page.getByRole("radio", { name: "Duplicate of another alert" }).check();
  await page.getByRole("button", { name: "Withdraw this update" }).click();
  await expect(page.getByTestId("follow-done")).toContainText("Sent to the Hub", { timeout: 60_000 });
  const withdrawal = (await entriesBy(person.id)).find((entry) => entry.kind === "withdrawal");
  expect(withdrawal).toMatchObject({ status: "pending_approval", web_published_at: null, original_text: "This alert repeated another alert. It has been withdrawn." });
  // Residents keep reading it until a second person approves the withdrawal.
  expect((await sql`select status from alert_entry where id = ${original.id}`)[0].status).toBe("pending_approval");
  expect(await threadStatus(original.alert_id)).toEqual({ status: "open", closed_reason: null });

  const coordinator = await newCoordinator(sql);
  const hub = await personOnAPhone(browser, baseURL, coordinator);
  await approve(hub.page, { alertId: original.alert_id, entryId: withdrawal!.id });
  await hub.context.close();

  await page.goto(`/staff/ambassador/status?entry=${original.id}`);
  await expect(page.getByTestId("status-state").getByRole("heading")).toHaveText("Withdrawn");
  await expect(page.getByTestId("status-state")).toContainText("Residents read instead: This alert repeated another alert. It has been withdrawn.");
  expect(await threadStatus(original.alert_id)).toEqual({ status: "closed", closed_reason: "withdrawn" });
  await expect(page.getByTestId("follow")).toHaveCount(0);
});

test("an ambassador marks an alert about their building resolved: the final waits for a second person and the alert stays open until the Hub approves it", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  const person = await newAmbassador();
  await signInAs(page, person);
  await postUpdate(page, "Elevator", "The elevator is out on floors 1 to 3. Use the stairs with care.");
  const [original] = await entriesBy(person.id);
  const [{ slug }] = await sql<{ slug: string }[]>`select slug from alert where id = ${original.alert_id}`;
  await waitForFeedToList(page.request, "en", slug);

  // The home offers "Mark resolved" on an alert about exactly one building they are assigned to.
  await page.goto("/staff");
  await page.getByTestId("amb-alert-resolve").first().click();
  await expect(page).toHaveURL(/\/staff\/ambassador\/resolve\?alert=/);
  await expect(page.getByRole("heading", { level: 1, name: "Mark this alert resolved" })).toBeVisible();
  await expect(page.getByTestId("resolve-about")).toContainText("The elevator is out on floors 1 to 3.");
  // The words are needed; nothing is sent without them.
  await page.getByRole("button", { name: "Send the final message" }).click();
  await expect(page.getByText("Say what is happening, in English.").or(page.getByText("Write the words in English."))).toBeVisible();
  expect((await entriesBy(person.id)).filter((entry) => entry.kind === "final")).toEqual([]);
  await page.locator("#follow-resolve-text").fill("The elevator is working again on every floor.");
  await page.getByRole("button", { name: "Send the final message" }).click();
  await expect(page.getByTestId("follow-done")).toContainText("The alert stays open until the Hub approves your final message.", { timeout: 60_000 });

  const final = (await entriesBy(person.id)).find((entry) => entry.kind === "final");
  expect(final).toMatchObject({ status: "pending_approval", web_published_at: null, original_text: "The elevator is working again on every floor." });
  // Never closing the thread on its own.
  expect(await threadStatus(original.alert_id)).toEqual({ status: "open", closed_reason: null });
  // A second request while one waits is told so.
  await page.goto(`/staff/ambassador/resolve?alert=${original.alert_id}`);
  await expect(page.getByTestId("resolve-waiting")).toContainText("already waiting for the Hub");

  const coordinator = await newCoordinator(sql);
  const hub = await personOnAPhone(browser, baseURL, coordinator);
  await approve(hub.page, { alertId: original.alert_id, entryId: final!.id });
  await hub.context.close();
  expect(await threadStatus(original.alert_id)).toEqual({ status: "closed", closed_reason: "resolved" });
  // A closed alert is not theirs to resolve again.
  await page.goto(`/staff/ambassador/resolve?alert=${original.alert_id}`);
  await expect(page.getByTestId("resolve-refused")).toContainText("This alert cannot be marked resolved by you.");
});

test("a post the Hub sent back reads 'Returned to you' with its note, and one the Hub approved shows how its texts are going", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  const person = await newAmbassador();
  await signInAs(page, person);
  await postUpdate(page, "Fire alarm or evacuation", "The fire alarm is sounding on floors 1 to 3.");
  const [waiting] = await entriesBy(person.id);
  await page.goto(`/staff/ambassador/status?entry=${waiting.id}`);
  await expect(page.getByTestId("status-state").getByRole("heading")).toHaveText("Waiting for the Hub");
  // Nothing residents read yet: nothing to correct or withdraw.
  await expect(page.getByTestId("follow-correct")).toHaveCount(0);
  await expect(page.getByTestId("follow-withdraw")).toHaveCount(0);

  const coordinator = await newCoordinator(sql);
  const hub = await personOnAPhone(browser, baseURL, coordinator);
  await hub.page.goto(`/staff/alerts/approve?alert=${waiting.alert_id}&entry=${waiting.id}`);
  await hub.page.getByTestId("return-button").click();
  await hub.page.getByTestId("return-note").fill("Say which building and which floors.");
  await hub.page.getByTestId("send-back-button").click();
  await expect(hub.page.getByTestId("locked-note")).toContainText("sent back to its author", { timeout: 30_000 });

  await page.reload();
  await expect(page.getByTestId("status-state").getByRole("heading")).toHaveText("Returned to you");
  await expect(page.getByTestId("status-note")).toHaveText("Note from the Hub: Say which building and which floors.");

  // A second fire post, approved: "Approved" and the progress of its texts (the sample environment queues none for nobody subscribed).
  await postUpdate(page, "Fire alarm or evacuation", "The fire alarm is sounding on floors 1 to 3. Leave by the stairs.");
  const second = (await entriesBy(person.id)).find((entry) => entry.id !== waiting.id)!;
  await approve(hub.page, { alertId: second.alert_id, entryId: second.id });
  await hub.context.close();
  await page.goto(`/staff/ambassador/status?entry=${second.id}`);
  await expect(page.getByTestId("status-state").getByRole("heading")).toHaveText("Approved");
  await expect(page.getByTestId("status-progress")).toContainText("Text messages");
  await expect(page.getByTestId("status-progress")).toContainText(/No text messages were queued for this update\.|waiting to be sent/);
});

test("what is not theirs is refused by direct requests: another ambassador's post, another building's alert, and every role but an Ambassador", async ({ page, browser, baseURL }) => {
  test.setTimeout(240_000);
  const author = await newAmbassador();
  const neighbour = await newAmbassador();
  const stranger = await newAmbassador([other]);

  // The author's live post.
  await signInAs(page, author);
  await postUpdate(page, "Elevator", "The elevator is out on floors 1 to 3. Use the stairs with care.");
  const [theirs] = await entriesBy(author.id);

  // A neighbour assigned to the same building: the page does not know the post, and a direct request is refused out of scope and changes nothing.
  const next = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const nextPage = await next.newPage();
  await signInAs(nextPage, neighbour);
  await nextPage.goto(`/staff/ambassador/status?entry=${theirs.id}`);
  await expect(nextPage.getByTestId("status-not-found")).toContainText("could not be found, or it is not yours");
  const base = { v: 1, alert_id: theirs.alert_id, entry_id: randomUUID(), key: randomUUID() };
  const correct = await nextPage.request.post("/api/staff/ambassador/follow", {
    data: { ...base, action: "correct", target: theirs.id, phase: "problem", valid: { mode: "resolved" }, text: "Changed by a neighbour." },
    headers: { "content-type": "application/json" },
  });
  expect(await correct.json()).toMatchObject({ state: "refused", outcome: "OUT_OF_SCOPE" });
  const withdraw = await nextPage.request.post("/api/staff/ambassador/follow", {
    data: { ...base, entry_id: randomUUID(), key: randomUUID(), action: "withdraw", target: theirs.id, reason: "duplicate", text: "" },
    headers: { "content-type": "application/json" },
  });
  expect(await withdraw.json()).toMatchObject({ state: "refused", outcome: "OUT_OF_SCOPE" });
  expect(await entriesBy(neighbour.id)).toEqual([]);
  expect((await entriesBy(author.id)).map((entry) => entry.kind)).toEqual(["update"]);
  await next.close();

  // An ambassador of another building: refused by the guard itself (403, audited), for a correction, a withdrawal and the final message.
  const away = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const awayPage = await away.newPage();
  await signInAs(awayPage, stranger);
  for (const data of [
    { ...base, entry_id: randomUUID(), key: randomUUID(), action: "correct", target: theirs.id, phase: "problem", valid: { mode: "resolved" }, text: "x" },
    { ...base, entry_id: randomUUID(), key: randomUUID(), action: "withdraw", target: theirs.id, reason: "duplicate", text: "" },
    { ...base, entry_id: randomUUID(), key: randomUUID(), action: "resolve", text: "Over." },
  ]) {
    const refused = await awayPage.request.post("/api/staff/ambassador/follow", { data, headers: { "content-type": "application/json" } });
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toEqual({ error: "forbidden" });
    expect(refused.headers()["cache-control"]).toBe("no-store");
  }
  await awayPage.goto(`/staff/ambassador/resolve?alert=${theirs.alert_id}`);
  await expect(awayPage.getByTestId("resolve-refused")).toBeVisible();
  await awayPage.goto(`/staff/ambassador/status?entry=${theirs.id}`);
  await expect(awayPage.getByTestId("status-not-found")).toBeVisible();
  await away.close();
  expect((await sql`select count(*)::int as n from alert_entry where alert_id = ${theirs.alert_id}`)[0].n).toBe(1);
  // The refusals were recorded.
  expect((await sql`select count(*)::int as n from audit_event where actor_staff_id = ${stranger.id} and outcome = 'refused'`)[0].n).toBeGreaterThanOrEqual(3);

  // The Hub's own people do not follow up here: a Coordinator who sends it changes nothing, and reads "not found" on the status page.
  const coordinator = await newCoordinator(sql);
  const hub = await personOnAPhone(browser, baseURL, coordinator);
  const hubRequest = await hub.page.request.post("/api/staff/ambassador/follow", {
    data: { ...base, entry_id: randomUUID(), key: randomUUID(), action: "correct", target: theirs.id, phase: "problem", valid: { mode: "resolved" }, text: "Changed by the Hub." },
    headers: { "content-type": "application/json" },
  });
  expect(await hubRequest.json()).toMatchObject({ state: "refused", outcome: "NOT_ALLOWED" });
  await hub.page.goto(`/staff/ambassador/status?entry=${theirs.id}`);
  await expect(hub.page.getByTestId("status-not-found")).toBeVisible();
  await hub.context.close();
  expect((await entriesBy(coordinator.id)).length).toBe(0);
});
