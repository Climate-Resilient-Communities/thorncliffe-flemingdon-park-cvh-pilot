// Buildings and floors in a browser (S01.13), against the production build with the identity fake
// (playwright.staff.config.ts): an Admin at aal2 finds Buildings in the Hub's menu, opens a building,
// renames, adds and removes floors, is refused bad labels with the reason, and confirms the building,
// each change audited; an Ambassador sees no Buildings item and a refusal on the page.
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
const RSN = String(900_000_000 + Math.floor(Math.random() * 99_999_999));
const ADDRESS = "77 Test Park Dr";

test.beforeAll(async () => {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
  await sql`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  await sql`insert into building (rsn, neighbourhood_id, address, latitude, longitude, storeys, elevators, emergency_power, cooling_room, air_conditioning, barrier_free_entrance, facts_updated_at)
            values (${RSN}, 'TP', ${ADDRESS}, 43.7, -79.34, 14, 3, true, null, 'None', false, '2026-10-01T12:00:00Z')`;
  for (let floor = 1; floor <= 14; floor += 1) {
    await sql`insert into building_floor (id, rsn, label, sort_order) values (${randomUUID()}, ${RSN}, ${String(floor)}, ${floor})`;
  }
});

test.afterAll(async () => {
  await sql?.end({ timeout: 5 });
});

type Role = "ambassador" | "admin";

async function newAccount(role: Role) {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  if (role === "admin") fake.enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, 'Bea', 'Okafor', 'someone@example.org', ${role}, false, ${role === "admin" ? new Date() : null})`;
  return { id, username, password, authUserId };
}

async function signIn(page: Page, role: Role) {
  const person = await newAccount(role);
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(person.username);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  if (role === "admin") {
    await expect(page).toHaveURL(/\/staff\/sign-in\/code$/);
    await page.getByLabel("6-digit code").fill(totpCode(memoryTotpSecret(person.authUserId)));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect(page).toHaveURL(/\/staff$/);
  return person;
}

const floorLabels = async () => (await sql`select label from building_floor where rsn = ${RSN} order by sort_order`).map((row) => row.label as string);
const floorRow = (page: Page, label: string) => page.locator("li[data-testid^='floor-']").filter({ has: page.locator(`input[name="label"][value="${label}"]`) });

test("an Ambassador has no Buildings item and sees a refusal on the page", async ({ page }) => {
  await signIn(page, "ambassador");
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByTestId("hub-side").getByRole("link", { name: "Buildings" })).toHaveCount(0);

  await page.goto("/staff/buildings");
  await expect(page.locator(`p[role="alert"]`)).toHaveText("Only an Admin can change buildings and floors.");
  await expect(page.getByRole("button", { name: "Rename" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Add a floor" })).toHaveCount(0);
});

test("an Admin edits a building's floors and confirms it, and every change is audited", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = await signIn(page, "admin");
  const since = (await sql`select coalesce(max(id), 0)::int as max from audit_event`)[0].max as number;

  // Buildings is in the menu under Administration, and the page lists the building by neighbourhood.
  await page.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Buildings" }).click();
  await expect(page).toHaveURL(/\/staff\/buildings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Buildings and floors" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Thorncliffe Park \(\d+\)$/ })).toBeVisible();
  const item = page.getByTestId(`building-${RSN}`);
  await expect(item).toContainText("14 storeys in the register. 14 floors.");
  await expect(page.getByTestId(`building-${RSN}-confirmed`)).toHaveText("Floors not confirmed");
  await item.getByRole("link", { name: `Edit floors of ${ADDRESS}` }).click();
  await expect(page).toHaveURL(new RegExp(`/staff/buildings\\?building=${RSN}$`));
  await expect(page.getByRole("heading", { level: 1, name: ADDRESS })).toBeVisible();
  await expect(page.locator(".layout-screen__body")).toBeVisible();
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

  // The register's facts, with "Not known" where it is silent.
  for (const line of ["Storeys: 14", "Elevators: 3", "Emergency power: Yes", "Cooling room: Not known", "Air conditioning: None", "Barrier-free entrance: No", "Last updated Oct 1, 2026"]) {
    await expect(page.getByText(line)).toBeVisible();
  }

  // Rename floor 3 to 3A: the page says so, and the floor keeps its id and its place.
  const [{ id: floorId }] = await sql`select id from building_floor where rsn = ${RSN} and label = '3'`;
  await floorRow(page, "3").getByLabel("Label of the floor now called 3").fill("3A");
  await floorRow(page, "3").getByRole("button", { name: "Rename floor 3", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Floor 3 is now called 3A.");
  expect((await sql`select label from building_floor where id = ${floorId}`)[0].label).toBe("3A");
  await expect(floorRow(page, "3A")).toHaveCount(1);
  await expect(floorRow(page, "3")).toHaveCount(0);

  // A label the rules refuse is refused with the reason, shows what was typed and saves nothing.
  const before = await floorLabels();
  await floorRow(page, "4").getByLabel("Label of the floor now called 4").fill("123456789");
  await floorRow(page, "4").getByRole("button", { name: "Rename floor 4", exact: true }).click();
  await expect(floorRow(page, "123456789").getByRole("alert")).toHaveText("A label can have at most 8 characters.");
  await page.getByLabel("Label", { exact: true }).fill("3 a");
  await page.getByRole("button", { name: "Add floor" }).click();
  await expect(page.locator("#add-floor-error")).toHaveText("This building already has a floor with that label. Labels count as the same when they differ only by capital letters or spaces.");
  await page.getByLabel("Label", { exact: true }).fill("2.5");
  await page.getByRole("button", { name: "Add floor" }).click();
  await expect(page.locator("#add-floor-error")).toHaveText("Use only letters, digits, spaces and hyphens in a label, with at least one letter or digit.");
  await page.getByLabel("Label", { exact: true }).fill("   ");
  await page.getByRole("button", { name: "Add floor" }).click();
  await expect(page.locator("#add-floor-error")).toHaveText("Enter a label for the floor.");
  expect(await floorLabels()).toEqual(before);

  // No floor 13; a ground floor G and a lobby L below floor 1.
  // Removing asks first: the first tap changes nothing, "Keep" cancels, and only the confirm button removes.
  await expect(page.getByRole("button", { name: "Remove floor 13", exact: true })).toHaveCount(1);
  await floorRow(page, "13").getByRole("button", { name: "Remove floor 13", exact: true }).click();
  await expect(floorRow(page, "13").getByRole("alert")).toHaveText("Remove floor 13? This cannot be undone.");
  expect(await floorLabels()).toContain("13");
  await floorRow(page, "13").getByRole("button", { name: "Keep floor 13", exact: true }).click();
  await expect(floorRow(page, "13").getByRole("alert")).toHaveCount(0);
  expect(await floorLabels()).toContain("13");
  await floorRow(page, "13").getByRole("button", { name: "Remove floor 13", exact: true }).click();
  await floorRow(page, "13").getByRole("button", { name: "Yes, remove floor 13", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Floor 13 removed.");
  expect(await floorLabels()).not.toContain("13");
  await page.getByLabel("Label", { exact: true }).fill("G");
  await page.getByLabel("Where it goes").selectOption("bottom");
  await page.getByRole("button", { name: "Add floor" }).click();
  await expect(page.getByRole("status")).toHaveText("Floor G added.");
  await page.getByLabel("Label", { exact: true }).fill("L");
  await page.getByLabel("Where it goes").selectOption("bottom");
  await page.getByRole("button", { name: "Add floor" }).click();
  await expect(page.getByRole("status")).toHaveText("Floor L added.");
  expect(await floorLabels()).toEqual(["L", "G", "1", "2", "3A", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14"]);
  await expect(page.locator("input[name='label'][aria-label^='Label of the floor']").first()).toHaveValue("L");

  // Mark the building confirmed: every floor becomes confirmed, and the button goes.
  await page.getByRole("button", { name: "Mark building confirmed" }).click();
  await expect(page.getByRole("status")).toHaveText("Building confirmed with 15 floors.");
  await expect(page.getByRole("button", { name: "Mark building confirmed" })).toHaveCount(0);
  await expect(page.getByTestId("building-confirmed")).toHaveText(/^Floors confirmed [A-Z][a-z]{2} \d{1,2}, \d{4}$/);
  await expect(page.getByTestId("building-confirmed")).toHaveAttribute("data-confirmed", "true");
  const [confirmed] = await sql`select floors_confirmed_by, (select count(*)::int from building_floor where rsn = ${RSN} and confirmed) as confirmed_floors from building where rsn = ${RSN}`;
  expect(confirmed).toEqual({ floors_confirmed_by: admin.id, confirmed_floors: 15 });

  expect(await sql`select action, outcome, subject_id from audit_event where id > ${since} and actor_staff_id = ${admin.id} order by id`).toEqual([
    { action: "building.floor_renamed", outcome: "ok", subject_id: RSN },
    { action: "building.floor_renamed", outcome: "refused", subject_id: RSN },
    { action: "building.floor_added", outcome: "refused", subject_id: RSN },
    { action: "building.floor_added", outcome: "refused", subject_id: RSN },
    { action: "building.floor_added", outcome: "refused", subject_id: RSN },
    { action: "building.floor_removed", outcome: "ok", subject_id: RSN },
    { action: "building.floor_added", outcome: "ok", subject_id: RSN },
    { action: "building.floor_added", outcome: "ok", subject_id: RSN },
    { action: "building.confirmed", outcome: "ok", subject_id: RSN },
  ]);
});

test("a building that is not there says so, and a building no longer in the register is flagged", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/staff/buildings?building=123");
  await expect(page.locator(`p[role="alert"]`)).toHaveText("That building does not exist.");

  const gone = String(800_000_000 + Math.floor(Math.random() * 99_999_999));
  await sql`insert into building (rsn, neighbourhood_id, address, latitude, longitude, storeys, facts_updated_at, not_in_register_since)
            values (${gone}, 'FP', '9 Gone Ct', 43.7, -79.33, null, now(), now())`;
  await page.goto("/staff/buildings");
  await expect(page.getByTestId(`building-${gone}`)).toContainText("Not in latest register");
  await page.goto(`/staff/buildings?building=${gone}`);
  await expect(page.getByText("The latest import did not find this building in the City register.")).toBeVisible();
  await expect(page.getByText("This building has no floors yet.")).toBeVisible();
});

test("an Admin enters, changes and removes the building contact: owned by the Hub, dated, audited, and refused with the reason when wrong", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const admin = await signIn(page, "admin");
  const rsn = String(700_000_000 + Math.floor(Math.random() * 99_999_999));
  await sql`insert into building (rsn, neighbourhood_id, address, latitude, longitude, storeys, facts_updated_at)
            values (${rsn}, 'TP', '5 Contact Ct', 43.7, -79.34, 3, '2026-09-28T12:00:00Z')`;
  const since = (await sql`select coalesce(max(id), 0)::int as max from audit_event`)[0].max as number;
  const saved = () => sql`select contact_role, contact_phone, contact_owner, contact_updated_at is not null as dated from building where rsn = ${rsn}`;

  await page.goto(`/staff/buildings?building=${rsn}`);
  await expect(page.getByRole("heading", { level: 2, name: "Building contact" })).toBeVisible();
  await expect(page.getByTestId("contact-current")).toHaveText('No contact entered yet. Residents see "Not known".');

  const role = page.getByLabel("Role", { exact: true });
  const phone = page.getByLabel("Phone number");
  const workNumber = page.getByLabel("This is a work or office number the building agreed to publish.");
  const save = page.getByRole("button", { name: "Save contact" });

  // The role is a fixed list of three, and the confirmation is a required checkbox.
  expect(await role.locator("option").evaluateAll((options) => options.map((option) => [(option as HTMLOptionElement).value, option.textContent]))).toEqual([
    ["", "Choose a role"],
    ["superintendent", "Superintendent"],
    ["building_management", "Building management"],
    ["property_office", "Property office"],
  ]);
  await expect(workNumber).toHaveAttribute("required", "");
  await expect(workNumber).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Remove contact" })).toHaveCount(0);

  // Half a contact, and a number that is not one, are refused with the reason, and nothing is saved.
  await role.selectOption("superintendent");
  await workNumber.check();
  await save.click();
  await expect(page.locator("#contact-error")).toHaveText("Enter a phone number for this role, or remove the contact.");
  await expect(role).toHaveValue("superintendent");
  await expect(workNumber).toBeChecked();
  await phone.fill("555-0123");
  await save.click();
  await expect(page.locator("#contact-error")).toHaveText("Enter a 10-digit phone number, like 416 555 0123.");
  expect(await saved()).toEqual([{ contact_role: null, contact_phone: null, contact_owner: null, dated: false }]);

  // Without the confirmation the browser does not send the form; and if it were sent anyway, the server refuses it.
  await phone.fill("(416) 555-0123");
  await workNumber.uncheck();
  expect(await workNumber.evaluate((box) => (box as HTMLInputElement).checkValidity())).toBe(false);
  await workNumber.evaluate((box) => box.removeAttribute("required"));
  await save.click();
  await expect(page.locator("#contact-error")).toHaveText("Confirm that this is a work or office number the building agreed to publish.");
  expect(await saved()).toEqual([{ contact_role: null, contact_phone: null, contact_owner: null, dated: false }]);

  // A good one is saved with the Hub as its owner and a date, the number in E.164, and the page says so.
  await workNumber.check();
  await save.click();
  await expect(page.getByRole("status")).toHaveText("Building contact saved.");
  expect(await saved()).toEqual([{ contact_role: "superintendent", contact_phone: "+14165550123", contact_owner: "hub", dated: true }]);
  await expect(page.getByTestId("contact-current")).toContainText("Provided by the Hub, last updated ");
  await expect(phone).toHaveValue("(416) 555-0123");
  await expect(role).toHaveValue("superintendent");
  // Each save is confirmed again.
  await expect(workNumber).not.toBeChecked();

  // Saving it again unchanged is refused; changing the number is saved.
  await workNumber.check();
  await save.click();
  await expect(page.locator("#contact-error")).toHaveText("Nothing to change: the contact is already saved like this.");
  await phone.fill("416 555 0199");
  await save.click();
  await expect(page.getByRole("status")).toHaveText("Building contact saved.");
  // The notice is the same as after the first save, so wait for the row, not the notice.
  await expect.poll(async () => (await saved())[0].contact_phone).toBe("+14165550199");

  // "Remove contact" removes it, with no confirmation needed.
  await page.getByRole("button", { name: "Remove contact" }).click();
  await expect(page.getByRole("status")).toHaveText("Building contact removed.");
  expect(await saved()).toEqual([{ contact_role: null, contact_phone: null, contact_owner: null, dated: false }]);

  expect(await sql`select action, outcome, subject_id, meta from audit_event where id > ${since} and actor_staff_id = ${admin.id} order by id`).toEqual([
    { action: "building.contact_changed", outcome: "refused", subject_id: rsn, meta: { reason: "validation" } },
    { action: "building.contact_changed", outcome: "refused", subject_id: rsn, meta: { reason: "validation" } },
    { action: "building.contact_changed", outcome: "refused", subject_id: rsn, meta: { reason: "validation" } },
    { action: "building.contact_changed", outcome: "ok", subject_id: rsn, meta: {} },
    { action: "building.contact_changed", outcome: "refused", subject_id: rsn, meta: { reason: "conflict" } },
    { action: "building.contact_changed", outcome: "ok", subject_id: rsn, meta: {} },
    { action: "building.contact_changed", outcome: "ok", subject_id: rsn, meta: { cleared: true } },
  ]);
});
