// Ambassador assignments and the coverage view in a browser (S01.14), against the production build with the
// identity fake (playwright.staff.config.ts): an Admin at aal2 finds Coverage in the Hub's menu, assigns an
// Ambassador to all floors and to chosen floors (ticked, and as a range), is refused with the reason, removes an
// assignment, and sees the floor-removal refusal list the Ambassador; a Coordinator and a Director see the coverage
// read-only, an Ambassador sees neither the item nor the page; every change is audited. S08.06: an Admin changes which types start a check-in
// round, and a Director reads them.
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
/** This run's building: a number of 9 digits no register uses. */
const RSN = String(700_000_000 + Math.floor(Math.random() * 99_999_999));
const ADDRESS = "55 Coverage Test Dr";
const LABELS = ["G", "1", "2", "3", "4", "5", "6", "7", "8"];

test.beforeAll(async () => {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
  await sql`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await sql`insert into building (rsn, neighbourhood_id, address, latitude, longitude, storeys, facts_updated_at)
            values (${RSN}, 'TP', ${ADDRESS}, 43.7, -79.34, 8, '2026-10-01T12:00:00Z')`;
  for (const [index, label] of LABELS.entries()) {
    await sql`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${randomUUID()}, ${RSN}, ${label}, ${index}, true)`;
  }
});

// Each test starts with no assignment to this building.
test.beforeEach(async () => {
  await sql`delete from ambassador_assignment where rsn = ${RSN}`;
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

type Role = "ambassador" | "coordinator" | "director" | "admin";
const NEEDS_CODE: readonly Role[] = ["admin", "coordinator"];

async function newAccount(role: Role, names: { first: string; last: string } = { first: "Bea", last: "Okafor" }) {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  if (NEEDS_CODE.includes(role)) fake.enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, ${names.first}, ${names.last}, 'someone@example.org', ${role}, false, ${NEEDS_CODE.includes(role) ? new Date() : null})`;
  return { id, username, password, authUserId, name: `${names.first} ${names.last}` };
}

async function signIn(page: Page, role: Role) {
  const person = await newAccount(role);
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(person.username);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (NEEDS_CODE.includes(role)) {
    await expect(page).toHaveURL(/\/staff\/sign-in\/code$/);
    await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(person.authUserId)));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/staff$/);
  return person;
}

/** An Ambassador to assign, with a name no other test uses. */
const ambassador = () => newAccount("ambassador", { first: "Ola", last: `Cov${randomBytes(3).toString("hex")}` });

const labelsOf = async (staffId: string) =>
  (
    await sql`
      select f.label from ambassador_assignment_floor a join building_floor f on f.id = a.floor_id
       where a.staff_id = ${staffId} and a.rsn = ${RSN} order by f.sort_order`
  ).map((row) => row.label as string);
const assignmentRow = async (staffId: string) => (await sql`select all_floors, assigned_by from ambassador_assignment where staff_id = ${staffId} and rsn = ${RSN}`)[0];
const floorState = (page: Page, label: string) => page.locator("li[data-testid^='floor-']").filter({ has: page.locator(".hub-cover__label", { hasText: new RegExp(`^${label}$`) }) });

test("an Ambassador has no Coverage item and sees a refusal on the page", async ({ page }) => {
  await signIn(page, "ambassador");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId("hub-side").getByRole("link", { name: "Coverage" })).toHaveCount(0);

  await page.goto("/staff/coverage");
  await expect(page.locator(`p[role="alert"]`)).toHaveText("Only an Admin, a Coordinator or a Director can see coverage.");
  await expect(page.getByRole("link", { name: ADDRESS })).toHaveCount(0);
});

for (const role of ["coordinator", "director"] as const) {
  test(`a ${role} sees the coverage of a building in words, read-only: no form and no button`, async ({ page }) => {
    const person = await ambassador();
    await sql.begin(async (tx) => {
      await tx`delete from ambassador_assignment where staff_id = ${person.id}`;
      await tx`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${person.id}, ${RSN}, false, ${person.id})`;
      await tx`insert into ambassador_assignment_floor (staff_id, rsn, floor_id) select ${person.id}, ${RSN}, id from building_floor where rsn = ${RSN} and label in ('G', '1', '2')`;
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, role);

    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Coverage" }).click();
    await expect(page).toHaveURL(/\/staff\/coverage$/);
    await expect(page.getByRole("heading", { level: 1, name: "Ambassador coverage" })).toBeVisible();
    const item = page.getByTestId(`coverage-${RSN}`);
    await expect(item).toContainText("Floors covered: 3 of 9.");
    await expect(item).toContainText("Covered: G, 1, 2");
    await expect(item).toContainText("Not covered: 3, 4, 5, 6, 7, 8");
    const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

    await item.getByRole("link", { name: `Coverage of ${ADDRESS}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: ADDRESS })).toBeVisible();
    await expect(floorState(page, "G")).toContainText(`Covered by ${person.name}`);
    await expect(floorState(page, "8")).toContainText("Not covered");
    await expect(page.getByTestId(`assignment-${person.id}`)).toContainText(`${person.name}. Floors G, 1, 2.`);
    await expect(page.getByRole("button", { name: "Assign" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Remove/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Assign an ambassador" })).toHaveCount(0);
  });
}

test("an Admin assigns an ambassador to all floors and to chosen floors, is refused with the reason, removes it, and every change is audited", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = await signIn(page, "admin");
  const nia = await ambassador();
  const since = (await sql`select coalesce(max(id), 0)::int as max from audit_event`)[0].max as number;

  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Coverage" }).click();
  await expect(page).toHaveURL(/\/staff\/coverage$/);
  await page.getByTestId(`coverage-${RSN}`).getByRole("link", { name: `Coverage of ${ADDRESS}` }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/coverage\\?building=${RSN}$`));
  await expect(page.getByRole("heading", { level: 1, name: ADDRESS })).toBeVisible();
  await expect(page.getByText("Thorncliffe Park. No floor is covered.")).toBeVisible();
  await expect(page.getByText("No ambassador is assigned to this building.")).toBeVisible();
  for (const label of LABELS) await expect(floorState(page, label)).toContainText("Not covered");

  // Nothing chosen, no scope (none is pre-selected), "only the floors chosen here" with no floor, "all floors" with a floor
  // ticked, and a range with one end are refused with the reason. (The form is reset after each answer.)
  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.locator("#assign-error")).toHaveText("Choose an ambassador.");
  await page.getByLabel("Ambassador", { exact: true }).selectOption({ label: nia.name });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.locator("#assign-error")).toHaveText("Choose which floors: all floors, or only the floors you pick.");
  await page.getByLabel("Ambassador", { exact: true }).selectOption({ label: nia.name });
  await page.getByLabel("All floors, including floors added later").check();
  await page.getByLabel("2", { exact: true }).check();
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.locator("#assign-error")).toHaveText(
    "You chose all floors but also picked floors or a range. Choose all floors on their own, or choose only the floors you pick.",
  );
  await page.getByLabel("Ambassador", { exact: true }).selectOption({ label: nia.name });
  await page.getByLabel("Only the floors chosen here").check();
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.locator("#assign-error")).toHaveText("Choose at least one floor, or choose all floors.");
  await page.getByLabel("Ambassador", { exact: true }).selectOption({ label: nia.name });
  await page.getByLabel("Only the floors chosen here").check();
  await page.getByLabel("From floor").selectOption({ label: "5" });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.locator("#assign-error")).toHaveText("Choose both ends of the range of floors, or neither.");
  expect(await assignmentRow(nia.id)).toBeUndefined();

  // All floors: every floor reads as covered, in words, and the list says so.
  await page.getByLabel("Ambassador", { exact: true }).selectOption({ label: nia.name });
  await page.getByLabel("All floors, including floors added later").check();
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Assignment saved.");
  expect(await assignmentRow(nia.id)).toEqual({ all_floors: true, assigned_by: admin.id });
  await expect(page.getByText("Thorncliffe Park. Every floor is covered.")).toBeVisible();
  await expect(page.getByTestId(`assignment-${nia.id}`)).toContainText(`${nia.name}. All floors.`);
  for (const label of LABELS) await expect(floorState(page, label)).toContainText(`Covered by ${nia.name}`);

  // Chosen floors, ticked and as a range (5 to 7 by the building's own order): the rest read as not covered.
  await page.getByLabel("Ambassador", { exact: true }).selectOption({ label: nia.name });
  await page.getByLabel("Only the floors chosen here").check();
  await page.getByLabel("2", { exact: true }).check();
  await page.getByLabel("From floor").selectOption({ label: "5" });
  await page.getByLabel("To floor").selectOption({ label: "7" });
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  // The page already says "Assignment saved." from the first save: wait for the second to be stored.
  await expect.poll(() => labelsOf(nia.id)).toEqual(["2", "5", "6", "7"]);
  await expect(page.getByRole("status")).toHaveText("Assignment saved.");
  expect(await assignmentRow(nia.id)).toEqual({ all_floors: false, assigned_by: admin.id });
  await expect(page.getByText("Thorncliffe Park. Floors covered: 4 of 9.")).toBeVisible();
  await expect(page.getByTestId(`assignment-${nia.id}`)).toContainText(`${nia.name}. Floors 2, 5, 6, 7.`);
  for (const label of ["2", "5", "6", "7"]) await expect(floorState(page, label)).toContainText(`Covered by ${nia.name}`);
  for (const label of ["G", "1", "3", "4", "8"]) await expect(floorState(page, label)).toContainText("Not covered");

  // The list shows it in words too.
  await page.goto("/staff/coverage");
  const item = page.getByTestId(`coverage-${RSN}`);
  await expect(item).toContainText("Floors covered: 4 of 9.");
  await expect(item).toContainText("Covered: 2, 5, 6, 7");
  await expect(item).toContainText("Not covered: G, 1, 3, 4, 8");

  // Remove it: the first click only asks, "Keep" changes nothing, and "Yes, remove" removes. The person stays.
  await page.goto(`/staff/coverage?building=${RSN}`);
  await page.getByRole("button", { name: `Remove ${nia.name}`, exact: true }).click();
  await expect(page.locator(`p[role="alert"]`)).toHaveText(`Remove ${nia.name} from this building? They stay an ambassador and stop covering it.`);
  expect(await assignmentRow(nia.id)).toBeDefined();
  await page.getByRole("button", { name: `Keep ${nia.name}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Remove ${nia.name}`, exact: true })).toBeVisible();
  expect(await assignmentRow(nia.id)).toBeDefined();
  await page.getByRole("button", { name: `Remove ${nia.name}`, exact: true }).click();
  await page.getByRole("button", { name: `Yes, remove ${nia.name}`, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Assignment removed.");
  expect(await assignmentRow(nia.id)).toBeUndefined();
  await expect(page.getByText("No ambassador is assigned to this building.")).toBeVisible();
  expect((await sql`select status from staff_account where id = ${nia.id}`)[0].status).toBe("active");

  expect(await sql`select action, outcome, subject_id, meta from audit_event where id > ${since} and actor_staff_id = ${admin.id} order by id`).toMatchObject([
    { action: "assignment.saved", outcome: "refused", subject_id: RSN, meta: { reason: "validation" } },
    { action: "assignment.saved", outcome: "refused", subject_id: RSN, meta: { reason: "validation" } },
    { action: "assignment.saved", outcome: "ok", subject_id: RSN, meta: { staff_id: nia.id, rsn: RSN, floor_ids: null } },
    // Replacing the whole-building assignment records what it was (null), and removing records the floors it listed.
    { action: "assignment.saved", outcome: "ok", subject_id: RSN, meta: { staff_id: nia.id, rsn: RSN, previous_floor_ids: null } },
    { action: "assignment.removed", outcome: "ok", subject_id: RSN, meta: { staff_id: nia.id, rsn: RSN, floor_ids: expect.any(Array) } },
  ]);
});

test("a suspended ambassador is listed as not covering now, and their floors are not covered", async ({ page }) => {
  const person = await ambassador();
  await sql`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${person.id}, ${RSN}, true, ${person.id})`;
  await sql`update staff_account set status = 'suspended' where id = ${person.id}`;
  await signIn(page, "admin");

  await page.goto(`/staff/coverage?building=${RSN}`);
  const row = page.getByTestId(`assignment-${person.id}`);
  await expect(row).toContainText(`${person.name}. All floors.`);
  await expect(row).toContainText("Not covering now: the account is suspended.");
  await expect(floorState(page, "G")).toContainText("Not covered");
  // The Admin can still remove it.
  await row.getByRole("button", { name: `Remove ${person.name}`, exact: true }).click();
  await row.getByRole("button", { name: `Yes, remove ${person.name}`, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Assignment removed.");
  expect(await assignmentRow(person.id)).toBeUndefined();
});

test("a floor an ambassador is assigned to cannot be removed: the refusal lists them, and the floor goes once they are removed", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = await signIn(page, "admin");
  const person = await ambassador();
  await page.goto(`/staff/coverage?building=${RSN}`);
  await page.getByLabel("Ambassador", { exact: true }).selectOption({ label: person.name });
  await page.getByLabel("Only the floors chosen here").check();
  await page.getByLabel("8", { exact: true }).check();
  await page.getByRole("button", { name: "Assign", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Assignment saved.");
  const since = (await sql`select coalesce(max(id), 0)::int as max from audit_event`)[0].max as number;

  await page.goto(`/staff/buildings?building=${RSN}`);
  const floor = page.locator("li[data-testid^='floor-']").filter({ has: page.locator(`input[name="label"][value="8"]`) });
  await floor.getByRole("button", { name: "Remove floor 8", exact: true }).click();
  await floor.getByRole("button", { name: "Yes, remove floor 8", exact: true }).click();
  await expect(floor.getByRole("alert")).toHaveText("Reassign or remove the ambassadors on this floor first");
  await expect(floor).toContainText(`Ambassadors on this floor: ${person.name}`);
  expect((await sql`select count(*)::int as n from building_floor where rsn = ${RSN} and label = '8'`)[0].n).toBe(1);
  expect(await sql`select action, outcome, meta from audit_event where id > ${since} and actor_staff_id = ${admin.id} order by id`).toMatchObject([
    { action: "building.floor_removed", outcome: "refused", meta: { reason: "floor_has_assignments", label: "8", assignments: 1 } },
  ]);

  // Remove the assignment, and the floor can go.
  await page.goto(`/staff/coverage?building=${RSN}`);
  await page.getByRole("button", { name: `Remove ${person.name}`, exact: true }).click();
  await page.getByRole("button", { name: `Yes, remove ${person.name}`, exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Assignment removed.");
  await page.goto(`/staff/buildings?building=${RSN}`);
  await floor.getByRole("button", { name: "Remove floor 8", exact: true }).click();
  await floor.getByRole("button", { name: "Yes, remove floor 8", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Floor 8 removed.");
});

test("a building that is not there says so", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/staff/coverage?building=123");
  await expect(page.locator(`p[role="alert"]`)).toHaveText("That building does not exist.");
});

// S08.06: which types of disruption start a check-in round, below the list. The round types are the whole database's, so the test puts the pilot's
// (heat and power) back whatever happens.
test("an Admin changes which types start a check-in round, audited with the types before and after; a Director reads them in words", async ({ page, browser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = await signIn(page, "admin");
  try {
    await page.goto("/staff/coverage");
    const rounds = page.getByTestId("round-types");
    await expect(rounds.getByTestId("round-types-current")).toHaveText("Types that start a round now: Heat, Power.");
    await rounds.getByRole("checkbox", { name: "Power", exact: true }).uncheck();
    // The residents' texts name heat and power: leaving Power unticked needs the confirmation box, and without it nothing changes.
    await expect(rounds.getByTestId("round-types-resident-texts")).toContainText("check-ins are for heat warnings and power outages");
    await rounds.getByRole("button", { name: "Save round types" }).click();
    await expect(rounds.getByTestId("round-types-error")).toHaveText(
      "Nothing changed. Heat or Power is unticked, so the residents' check-in texts would be inaccurate. Tick the box to confirm, then save again.",
    );
    expect((await sql`select id from disruption_type where checkin order by id`).map((row) => row.id)).toEqual(["heat", "power"]);
    await rounds.getByRole("checkbox", { name: "Power", exact: true }).uncheck();
    await rounds.getByTestId("round-types-confirm").check();
    await rounds.getByRole("button", { name: "Save round types" }).click();
    await expect(rounds.getByTestId("round-types-answer")).toHaveText("Saved. Types that start a round from the next approval: Heat.");
    await expect(rounds.getByTestId("round-types-current")).toHaveText("Types that start a round now: Heat.");
    expect((await sql`select id from disruption_type where checkin order by id`).map((row) => row.id)).toEqual(["heat"]);
    const [audit] = await sql`select outcome, subject_type, meta from audit_event where action = 'round_types.changed' and actor_staff_id = ${admin.id} order by id desc limit 1`;
    expect(audit).toMatchObject({ outcome: "ok", subject_type: "disruption_type", meta: { round_types: ["heat"], previous: ["heat", "power"] } });
    // The same again (confirmed) changes nothing, and says so.
    await rounds.getByTestId("round-types-confirm").check();
    await rounds.getByRole("button", { name: "Save round types" }).click();
    await expect(rounds.getByTestId("round-types-error")).toHaveText("Nothing to change: those are the round types already.");

    const other = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const director = await other.newPage();
    await signIn(director, "director");
    await director.goto("/staff/coverage");
    await expect(director.getByTestId("round-types-current")).toHaveText("Types that start a round now: Heat.");
    await expect(director.getByTestId("round-types-read-only")).toHaveText("Only an Admin can change which types start a round.");
    await expect(director.getByTestId("round-types").locator("form, button, input")).toHaveCount(0);
    await other.close();
  } finally {
    await sql`update disruption_type set checkin = (id in ('heat', 'power'))`;
  }
});
