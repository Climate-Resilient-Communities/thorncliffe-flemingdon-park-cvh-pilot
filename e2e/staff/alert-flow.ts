import { randomBytes, randomUUID } from "node:crypto";
import { expect, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import type postgres from "postgres";
import { memoryTotpSecret, totpCode } from "../../src/modules/identity/adapters/memoryTotp";
import { identityFake, pepperedPassword } from "./helpers";

// What the resident end-to-end tests of the staff run (e2e/staff/resident-*.spec.ts) need of the Hub: two Coordinators, a building to write
// about, an acknowledgement submitted by one and approved by the other, the way approval.spec.ts does it, with the identity fake and the
// translation fake (no model is called, nothing leaves this machine). The same approval a person makes on a phone is what publishes the alert,
// so what a resident then sees is the real thing, end to end.

export type Role = "coordinator" | "admin";

export interface Person {
  id: string;
  username: string;
  password: string;
  authUserId: string;
}

/** A building of this run (a register number no real building uses) with floors, and the two neighbourhoods the feed lists. */
export async function newBuilding(sql: postgres.Sql, address: string) {
  const rsn = String(700_000_000 + Math.floor(Math.random() * 99_999_999));
  await sql`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await sql`insert into building (rsn, neighbourhood_id, address, latitude, longitude, storeys, facts_updated_at)
            values (${rsn}, 'TP', ${address}, 43.7, -79.34, 4, '2026-10-01T12:00:00Z')`;
  for (const [index, label] of ["G", "1", "2", "3", "4"].entries()) {
    await sql`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${randomUUID()}, ${rsn}, ${label}, ${index}, true)`;
  }
  return rsn;
}

/** A Coordinator with their authenticator, ready to sign in. */
export async function newCoordinator(sql: postgres.Sql, role: Role = "coordinator"): Promise<Person> {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const authUserId = identityFake().plant(`${username}@staff.cvh.invalid`, { password: pepperedPassword(password), createdAt: new Date() });
  identityFake().enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Dana', 'Okafor', 'someone@example.org', ${role}, false, ${new Date()})`;
  return { id, username, password, authUserId };
}

export async function signIn(page: Page, person: Person) {
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(person.username);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff\/sign-in\/code$/);
  await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(person.authUserId)));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/staff$/);
}

/** A person in a browser of their own (two sign-ins never share cookies), on a phone. */
export async function personOnAPhone(browser: Browser, baseURL: string | undefined, person: Person) {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await signIn(page, person);
  return { context, page };
}

/**
 * Waits until the feed, as the server answers it for `lang`, lists a thread with this slug. The server keeps the feed for 15 seconds in its data cache
 * and serves a stale answer once while it builds a fresh one, so what a test wrote straight into the database (no approval, so nothing expired the
 * cache) shows within a few seconds, not at once. The answer is then fresh.
 */
export async function waitForFeedToList(request: APIRequestContext, lang: string, slug: string, timeout = 45_000) {
  await expect
    .poll(async () => ((await (await request.get(`/api/feed?lang=${lang}`)).json()) as { threads: { slug: string }[] }).threads.map((thread) => thread.slug), { timeout, message: `the ${lang} feed lists ${slug}` })
    .toContain(slug);
}

/**
 * What a messaging app reads of the shared address `/a/{slug}?l={lang}` right now (S05.08): the status and the Open Graph title and description of the page the
 * recipient would open, with no cookie and no redirect. The address is asked as the app asks it, straight after a change: the approving transaction expires the feed's
 * cache (`revalidateTag(..., { expire: 0 })`), so a change shows at once, which is stricter than the 15 seconds the story allows.
 */
export async function sharedPreview(request: APIRequestContext, slug: string, lang = "en") {
  const response = await request.get(`/a/${slug}?l=${lang}`, { maxRedirects: 0 });
  const html = await response.text();
  const meta = (key: string) => {
    const found = new RegExp(`<meta (?:name|property)="${key}" content="([^"]*)"`).exec(html);
    return found?.[1].replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[  ]/g, " ");
  };
  return {
    status: response.status(),
    cookies: response.headersArray().filter(({ name }) => name.toLowerCase() === "set-cookie"),
    title: meta("og:title"),
    description: meta("og:description"),
    html,
  };
}

export interface EntryRef {
  alertId: string;
  entryId: string;
}

/** The author logs an elevator disruption for the building and submits its acknowledgement: one pending entry with its fifteen frozen translations. */
export async function submitAnAcknowledgement(page: Page, rsn: string): Promise<EntryRef> {
  await page.goto("/staff/alerts/log");
  await page.getByLabel("Elevator", { exact: true }).check();
  await page.getByRole("radio", { name: /^Buildings/ }).check();
  await page.getByTestId(`building-${rsn}`).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/staff\/alerts\/ack\?alert=[0-9a-f-]+&entry=[0-9a-f-]+$/);
  const url = new URL(page.url());
  const ref = { alertId: url.searchParams.get("alert") as string, entryId: url.searchParams.get("entry") as string };
  await page.getByTestId("submit-button").click();
  await expect(page.getByTestId("pending-panel")).toBeVisible({ timeout: 60_000 });
  return ref;
}

/** The approver opens the entry on their phone and presses Approve; returns once the page says the alert is published. */
export async function approve(page: Page, ref: EntryRef) {
  await page.goto(`/staff/alerts/approve?alert=${ref.alertId}&entry=${ref.entryId}`);
  await page.getByTestId("approve-button").click();
  await expect(page.getByTestId("locked-note")).toContainText("approved and is published", { timeout: 30_000 });
}
