// The on-call numbers in a browser (S06.07), against the production build with the identity fake (playwright.staff.config.ts): an Admin at aal2 adds
// and removes a number on "On-call numbers", the list shows only its last four digits, the change is audited without the number or the name, the
// roles that cannot manage the list are told so and have no menu item, and every Hub screen carries "Sending is failing" while the health job has
// found the sender failing; every Admin and Coordinator screen names every open condition, and the heartbeat the outside check calls (S09.01).
// Every number is fictional (555). Nothing here sends a text: the server runs with SMS_MODE=log.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { memoryTotpSecret, totpCode } from "../../src/modules/identity/adapters/memoryTotp";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";

const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
const pepper = process.env.STAFF_PASSWORD_PEPPER;

let sql: postgres.Sql;

async function clearState() {
  await sql`delete from oncall_roster`;
  await sql`update health_condition set active = false, since = null, last_alerted_at = null, last_event_id = null, checked_at = null`;
  await sql`update health_heartbeat set completed_at = null`;
}

test.beforeAll(async () => {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
});

test.afterAll(async () => {
  await clearState();
  await sql?.end({ timeout: 5 });
});

let auditMark = 0;

test.beforeEach(async () => {
  await clearState();
  [{ max: auditMark }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
});

type Role = "ambassador" | "coordinator" | "director" | "admin";

/** A new account on its own password, with an authenticator enrolled when the role has one. */
async function newAccount(role: Role) {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  const enrolled = role === "admin" || role === "coordinator";
  if (enrolled) fake.enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Ann', 'Okafor', 'someone@example.org', ${role}, false, ${enrolled ? new Date() : null})`;
  return { id, username, password, authUserId, enrolled };
}

/** Signs in to the Hub, entering the authenticator code when the role has one (aal2). */
async function signInToTheHub(page: Page, role: Role) {
  const account = await newAccount(role);
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(account.username);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (account.enrolled) {
    await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(account.authUserId)));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/staff$/);
  return account;
}

async function expectNoHorizontalScroll(page: Page) {
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth, "document scrollWidth <= clientWidth").toBeLessThanOrEqual(root.clientWidth);
}

const audits = () => sql`select action, actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > ${auditMark} and action like 'oncall.%' order by id`;
const denials = (actor: string) => sql`select meta from audit_event where id > ${auditMark} and action = 'permission.denied' and actor_staff_id = ${actor} order by id`;
const roster = () => sql`select label, phone, added_by from oncall_roster order by created_at, id`;
const failingBanner = (page: Page) => page.getByTestId("health-banner");

test("an Admin adds on-call numbers, sees only their last four digits, and removes one; each change is audited without the number or the name", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const admin = await signInToTheHub(page, "admin");

  const side = page.getByTestId("hub-side");
  await side.getByRole("link", { name: "On-call numbers" }).click();
  await expect(page).toHaveURL(/\/staff\/oncall$/);
  await expect(page.getByRole("heading", { level: 1, name: "On-call numbers" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(side.getByRole("link", { name: "On-call numbers" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("oncall-rule")).toContainText("no alert except a drill can be approved while this list is empty");
  await expect(page.getByTestId("oncall-empty")).toContainText("No on-call number is set.");
  await expect(page.getByTestId("oncall-count")).toHaveText("0 on-call numbers");

  // A name and a number are required.
  await expect(page.getByLabel("Name or role")).toHaveAttribute("required", "");
  await expect(page.getByLabel("Mobile number")).toHaveAttribute("required", "");

  // A number that is not Canadian is refused by the server, and nothing changes.
  await page.getByLabel("Name or role").fill("IT lead");
  await page.getByLabel("Mobile number").fill("020 7946 0958");
  await page.getByRole("button", { name: "Add number" }).click();
  await expect(page.getByTestId("oncall-error")).toHaveText("That is not a Canadian mobile number. Use ten digits, for example 416-555-0123.");
  expect(await roster()).toEqual([]);

  await page.getByLabel("Name or role").fill("IT lead");
  await page.getByLabel("Mobile number").fill("(416) 555-0123");
  await page.getByRole("button", { name: "Add number" }).click();
  await expect(page.getByTestId("oncall-answer")).toContainText("IT lead was added. The list now has 1 number.");
  await expect(page.getByTestId("oncall-count")).toHaveText("1 on-call number");
  await expect(page.getByTestId("oncall-row")).toHaveCount(1);
  await expect(page.getByTestId("oncall-list")).toContainText("IT lead");
  await expect(page.getByTestId("oncall-list")).toContainText("+1 ••• ••• 0123");
  // The same number again, written another way, is refused.
  await page.getByLabel("Name or role").fill("Again");
  await page.getByLabel("Mobile number").fill("1-416-555-0123");
  await page.getByRole("button", { name: "Add number" }).click();
  await expect(page.getByTestId("oncall-error")).toHaveText("That number is already on the list.");

  await page.getByLabel("Name or role").fill("Priya");
  await page.getByLabel("Mobile number").fill("647 555 0199");
  await page.getByRole("button", { name: "Add number" }).click();
  await expect(page.getByTestId("oncall-answer")).toContainText("Priya was added. The list now has 2 numbers.");
  await expect(page.getByTestId("oncall-row")).toHaveCount(2);

  // Nothing on the page, in any form, holds a whole number.
  const html = await page.content();
  expect(html).not.toContain("4165550123");
  expect(html).not.toContain("416-555-0123".replace(/-/g, " "));
  expect(html).not.toContain("6475550199");

  expect(await roster()).toEqual([
    { label: "IT lead", phone: "+14165550123", added_by: admin.id },
    { label: "Priya", phone: "+16475550199", added_by: admin.id },
  ]);

  await page.getByRole("button", { name: "Remove IT lead" }).click();
  await expect(page.getByTestId("oncall-answer")).toContainText("IT lead was removed. The list now has 1 number.");
  await expect(page.getByTestId("oncall-row")).toHaveCount(1);
  expect((await roster()).map((row) => row.label)).toEqual(["Priya"]);

  // In the order they happened: the refused number, the first add, the duplicate, the second add and the removal. Only the roster's size, or for a
  // refusal its reason, is in any of them.
  const trail = await audits();
  expect(trail.map((a) => [a.action, a.actor_staff_id, a.subject_type, a.outcome, a.meta])).toEqual([
    ["oncall.added", admin.id, "oncall_roster", "refused", { reason: "validation" }],
    ["oncall.added", admin.id, "oncall_roster", "ok", { roster_size: 1 }],
    ["oncall.added", admin.id, "oncall_roster", "refused", { reason: "duplicate" }],
    ["oncall.added", admin.id, "oncall_roster", "ok", { roster_size: 2 }],
    ["oncall.removed", admin.id, "oncall_roster", "ok", { roster_size: 1 }],
  ]);
  const everything = JSON.stringify(await sql`select * from audit_event where id > ${auditMark}`);
  for (const secret of ["4165550123", "6475550199", "IT lead", "Priya"]) expect(everything).not.toContain(secret);
});

test("a phone shows the list and the form without a sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInToTheHub(page, "admin");
  await sql`insert into oncall_roster (id, label, phone, added_by) select ${randomUUID()}, 'Priya Sharma, Hub Director weekends', '+16475550199', id from staff_account order by created_at desc limit 1`;
  await page.goto("/staff/oncall");

  await expect(page.getByTestId("oncall-row")).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "On-call numbers" })).toBeVisible();
});

test("the roles that cannot manage the list are told so, have no menu item, and a direct post of either action is refused and audited", async ({ page, browser, baseURL }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const admin = await signInToTheHub(adminPage, "admin");
  await adminPage.goto("/staff/oncall");
  await adminPage.getByLabel("Name or role").fill("IT lead");
  await adminPage.getByLabel("Mobile number").fill("416-555-0123");
  await adminPage.getByRole("button", { name: "Add number" }).click();
  await expect(adminPage.getByTestId("oncall-row")).toHaveCount(1);

  // The Admin's page carries both actions' ids in its forms (the add form, and the Remove form of the one entry).
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const fieldsOf = async (marker: string) => {
    const html = await (await adminPage.request.get("/staff/oncall")).text();
    const form = [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([text]) => text).find((text) => text.includes(marker));
    if (!form) throw new Error(`no form with ${marker}`);
    return [...form.matchAll(/<input\b[^>]*>/g)].flatMap(([tag]) => {
      const name = /\bname="([^"]*)"/.exec(tag)?.[1];
      return name === undefined ? [] : [[unescape(name), unescape(/\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "")] as [string, string]];
    });
  };
  const addFields = await fieldsOf('name="number"');
  const removeFields = await fieldsOf('name="id"');
  expect(addFields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);
  expect(removeFields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);

  // A Coordinator signs in at aal2 as well, and is a role the policy refuses: no menu item and the refusal on the page.
  await page.setViewportSize({ width: 390, height: 844 });
  const coordinator = await signInToTheHub(page, "coordinator");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "On-call numbers" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/staff/oncall");
  await expect(page.getByText("Only an Admin can change the on-call numbers.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add number" })).toHaveCount(0);

  const post = async (fields: [string, string][], extra: Record<string, string> = {}) => {
    const body = new FormData();
    for (const [name, value] of fields) body.append(name, value);
    for (const [name, value] of Object.entries(extra)) body.append(name, value);
    const response = await page.request.post("/staff/oncall", { multipart: body, headers: { origin: baseURL as string } });
    expect(response.status()).toBe(200);
  };
  await post(addFields, { label: "Intruder", number: "416-555-0100" });
  await post(removeFields.filter(([name]) => name !== "id"), { id: (await sql`select id from oncall_roster`)[0].id as string });
  expect((await roster()).map((row) => row.label)).toEqual(["IT lead"]);
  await adminContext.close();

  expect((await denials(coordinator.id)).map((denied) => denied.meta)).toEqual([
    { status: 403, route: "/staff/oncall", permission: "oncall.manage", reason: "forbidden" },
    { status: 403, route: "/staff/oncall", permission: "oncall.manage", reason: "forbidden" },
  ]);
  expect(admin.id).not.toBe(coordinator.id);
});

test("every Hub screen says 'Sending is failing' while the health job has found the stuck queue or no sender, to every role, and stops when it clears", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInToTheHub(page, "ambassador");
  await expect(failingBanner(page)).toHaveCount(0);

  // As the health job leaves it when it finds the queue stuck.
  await sql`update health_condition set active = true, since = now() - interval '12 minutes', last_alerted_at = now() where condition = 'queue_stuck'`;
  for (const path of ["/staff", "/staff/buildings", "/staff/coverage"]) {
    await page.goto(path);
    await expect(failingBanner(page), path).toBeVisible();
    await expect(failingBanner(page), path).toContainText("Sending is failing");
    await expect(failingBanner(page), path).toContainText("Texts have waited more than 5 minutes to be sent.");
    await expect(failingBanner(page), path).toContainText("Tell IT now.");
  }
  await expectNoHorizontalScroll(page);

  await sql`update health_condition set active = true, since = now() - interval '4 minutes' where condition = 'sender_stalled'`;
  await page.goto("/staff");
  await expect(failingBanner(page)).toContainText("No sender has run for more than 3 minutes while texts are waiting.");

  // Twilio refusing the sign-in is the sender failing too (S09.01 follow-up): everyone is shown it.
  await sql`update health_condition set active = false, since = null where condition in ('queue_stuck', 'sender_stalled')`;
  await sql`update health_condition set active = true, since = now() where condition = 'provider_auth'`;
  await page.goto("/staff");
  await expect(failingBanner(page)).toContainText("Sending is failing");
  await expect(failingBanner(page)).toContainText("Twilio refused the CVH sign-in, so texts are not being sent.");

  // The other conditions do not mean the sender is failing: an Ambassador is not shown them.
  await sql`update health_condition set active = false, since = null where condition = 'provider_auth'`;
  await sql`update health_condition set active = true, since = now() where condition not in ('queue_stuck', 'sender_stalled', 'provider_auth')`;
  await page.goto("/staff");
  await expect(failingBanner(page)).toHaveCount(0);
});

test("every Admin and Coordinator screen names each open health condition in plain words until it clears, and says when the health check has stopped (S09.01)", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInToTheHub(page, "coordinator");
  await expect(failingBanner(page)).toHaveCount(0);

  await sql`update health_condition set active = true, since = now() - interval '20 minutes' where condition in ('publish_failed', 'job_failed', 'cap_overrun')`;
  for (const path of ["/staff", "/staff/coverage"]) {
    await page.goto(path);
    await expect(failingBanner(page), path).toContainText("Something is not working");
    await expect(failingBanner(page), path).toContainText("The last directory publish failed. Residents still see the previous directory.");
    await expect(failingBanner(page), path).toContainText("A scheduled job failed in the last 10 minutes");
    await expect(failingBanner(page), path).toContainText("went over the monthly text message spending cap");
    await expect(failingBanner(page), path).toContainText("Tell IT now.");
  }
  await expectNoHorizontalScroll(page);

  // It clears when the health job finds the conditions clear.
  await sql`update health_condition set active = false, since = null`;
  await page.goto("/staff");
  await expect(failingBanner(page)).toHaveCount(0);

  // A health check that ran and stopped (pg_cron stopped, or the job keeps failing) is named; one that never ran (this database) is not.
  await sql`update health_heartbeat set completed_at = now() - interval '5 minutes'`;
  await page.goto("/staff");
  await expect(failingBanner(page)).toContainText("The health check has not run for more than 3 minutes");
  await sql`update health_heartbeat set completed_at = now()`;
  await page.goto("/staff");
  await expect(failingBanner(page)).toHaveCount(0);

  // An Admin sees the same.
  await sql`update health_condition set active = true, since = now() where condition = 'translation_fallback'`;
  await page.context().clearCookies();
  await signInToTheHub(page, "admin");
  await expect(failingBanner(page)).toContainText("with a whole language in English, because its translation failed");
});

test("the heartbeat answers 200 with no body while all is well, else 503 naming the cause, with no cookie (S09.01 and its follow-up)", async ({ request }) => {
  // The route reuses one answer for up to 10 s (HEARTBEAT_CACHE_MS), so after each change the test waits for the new answer.
  test.setTimeout(90_000);
  const expectAnswer = async (method: "get" | "head", status: number, body = "") => {
    await expect.poll(async () => (await request[method]("/api/health/heartbeat")).status(), { message: method, timeout: 15_000, intervals: [500, 1000] }).toBe(status);
    const response = await request[method]("/api/health/heartbeat");
    expect(response.status(), method).toBe(status);
    expect(response.headers()["set-cookie"], method).toBeUndefined();
    expect(response.headers()["cache-control"], method).toBe("no-store");
    // HEAD has no body; GET's 503 carries the cause's code and nothing else.
    expect(await response.text(), method).toBe(method === "head" ? "" : body);
  };
  // Never run.
  await expectAnswer("get", 503, "health_job_stale");
  await sql`update health_heartbeat set completed_at = now()`;
  await expectAnswer("get", 200);
  await expectAnswer("head", 200);
  await sql`update health_heartbeat set completed_at = now() - interval '3 minutes 5 seconds'`;
  await expectAnswer("get", 503, "health_job_stale");
  await expectAnswer("head", 503);

  // Twilio refusing the sign-in: not for a refusal the health job found 5 minutes ago (one that passes clears before 10), but after 10 minutes.
  await sql`update health_heartbeat set completed_at = now()`;
  await sql`update health_condition set active = true, since = now() - interval '5 minutes' where condition = 'provider_auth'`;
  await expectAnswer("get", 200);
  await sql`update health_condition set since = now() - interval '11 minutes' where condition = 'provider_auth'`;
  await expectAnswer("get", 503, "provider_auth");
  await expectAnswer("head", 503);
  await sql`update health_condition set active = false, since = null where condition = 'provider_auth'`;
  await expectAnswer("get", 200);
});
