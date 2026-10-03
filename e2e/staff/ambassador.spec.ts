// The Ambassador's home in a browser (S08.01, A-01), against the production build with the identity fake (playwright.staff.config.ts): an Ambassador signs in on a
// phone and, at the Hub's home, sees the open alerts about the building they are assigned to (not another building's) and their own post with its state; the page is
// no-store; an Admin removing the assignment takes the building, its alert and the post off with the very next load; a suspended Ambassador gets 401; a Coordinator
// gets the Hub's incidents list, not this home.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";

const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
const pepper = process.env.STAFF_PASSWORD_PEPPER;

let sql: postgres.Sql;
const suffix = () => String(Math.floor(Math.random() * 900_000_000) + 100_000_000);
/** This run's two buildings: numbers of 9 digits no register uses. */
const MINE = suffix();
const OTHER = suffix();
const MINE_ADDRESS = "61 Ambassador Home Dr";
const OTHER_ADDRESS = "63 Ambassador Home Dr";
const SLUGS = ["ambhomea01", "ambhomeb01", "ambhomep01"];
let author: string;
let approver: string;

test.beforeAll(async () => {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  sql = postgres(ownerUrl, { max: 1, onnotice: () => {} });
  await sql`delete from sign_in_failure`;
  await sql`delete from sign_in_lock`;
  await sql`insert into neighbourhood (id, name, fsa) values ('TP', 'Thorncliffe Park', 'M4H'), ('FP', 'Flemingdon Park', 'M3C') on conflict do nothing`;
  for (const [rsn, address] of [[MINE, MINE_ADDRESS], [OTHER, OTHER_ADDRESS]]) {
    await sql`insert into building (rsn, neighbourhood_id, address, latitude, longitude, storeys, facts_updated_at) values (${rsn}, 'TP', ${address}, 43.7, -79.34, 4, '2026-10-01T12:00:00Z')`;
    for (const [index, label] of ["G", "1", "2", "3"].entries()) await sql`insert into building_floor (id, rsn, label, sort_order, confirmed) values (${randomUUID()}, ${rsn}, ${label}, ${index}, true)`;
  }
  author = (await newAccount("coordinator", "Hub", "Author")).id;
  approver = (await newAccount("coordinator", "Hub", "Approver")).id;
});

test.afterAll(async () => {
  await sql?.begin(async (tx) => {
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    await tx`delete from alert_entry where alert_id in (select id from alert where slug = any (${SLUGS}))`;
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
    await tx`delete from alert where slug = any (${SLUGS})`;
  });
  await sql?.end({ timeout: 5 });
});

type Role = "ambassador" | "coordinator";
const NEEDS_CODE: readonly Role[] = ["coordinator"];

async function newAccount(role: Role, first = "Ola", last = `Home${randomBytes(3).toString("hex")}`) {
  const username = `${role.slice(0, 3)}${randomBytes(3).toString("hex")}`;
  const password = `${username} own password`;
  const fake = memoryIdentityProvider({ file: fakeFile });
  const authUserId = fake.plant(`${username}@staff.cvh.invalid`, { password: pepperPassword(pepper as string, password), createdAt: new Date() });
  if (NEEDS_CODE.includes(role)) fake.enrol(authUserId);
  const id = randomUUID();
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, factor_enrolled_at)
    values (${id}, ${authUserId}, ${username}, ${first}, ${last}, 'someone@example.org', ${role}, false, ${NEEDS_CODE.includes(role) ? new Date() : null})`;
  return { id, username, password, authUserId };
}

/** An alert thread with one entry inserted directly (the lifecycle's triggers off), as the database tests do. */
async function seedAlert(opts: { slug: string; rsn: string; authorId: string; text: string; status: "approved" | "pending_approval"; publishedAt: Date | null }) {
  const alertId = randomUUID();
  const entryId = randomUUID();
  const hash = randomBytes(32).toString("hex");
  const audience = { scope: "buildings", buildings: [{ rsn: opts.rsn, floors: null }], groups: [], types: ["power"] };
  await sql.begin(async (tx) => {
    await tx`select set_config('cvh.actor_id', ${author}, true)`;
    await tx`insert into alert (id, is_drill, reported_at, created_by, slug) values (${alertId}, false, now() - interval '1 hour', ${author}, ${opts.slug})`;
    await tx.unsafe("alter table alert_entry disable trigger alert_entry_guard");
    const approved = opts.status === "approved";
    await tx`insert into alert_entry (id, alert_id, kind, status, author_id, editor_ids, original_text, types, audience, phase, valid_until, version, content_hash, sms_bodies, submitted_at,
                                       approved_by, approved_at, approved_version, approved_hash, web_published_at)
             values (${entryId}, ${alertId}, 'ack', ${opts.status}, ${opts.authorId}, ${[opts.authorId]}, ${opts.text}, ${["power"]}, ${tx.json(audience)}, 'problem', now() + interval '1 day', 1, ${hash},
                     ${tx.json({ en: { body: "x", encoding: "gsm7", segments: 1 } })}, now() - interval '30 minutes', ${approved ? approver : null}, ${approved ? new Date(Date.now() - 20 * 60_000) : null},
                     ${approved ? 1 : null}, ${approved ? hash : null}, ${opts.publishedAt})`;
    await tx.unsafe("alter table alert_entry enable trigger alert_entry_guard");
  });
}

async function signInAs(page: Page, person: { username: string; password: string }) {
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(person.username);
  await page.getByLabel("Password", { exact: true }).fill(person.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test("an Ambassador's home lists the alerts about their building and their own post, not another building's, and goes with the assignment", async ({ page }) => {
  const person = await newAccount("ambassador");
  await sql`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${person.id}, ${MINE}, true, ${person.id})`;
  await seedAlert({ slug: SLUGS[0], rsn: MINE, authorId: author, text: "Power is out at 61 Ambassador Home Dr.", status: "approved", publishedAt: new Date() });
  await seedAlert({ slug: SLUGS[1], rsn: OTHER, authorId: author, text: "Water is off at 63 Ambassador Home Dr.", status: "approved", publishedAt: new Date() });
  await seedAlert({ slug: SLUGS[2], rsn: MINE, authorId: person.id, text: "No water on floor 3.", status: "pending_approval", publishedAt: null });

  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs(page, person);
  await expect(page).toHaveURL(/\/staff$/);

  await expect(page.getByRole("heading", { level: 1, name: "My building" })).toBeVisible();
  await expect(page.getByTestId("assigned")).toContainText("You are the ambassador for 61 Ambassador Home Dr, all floors.");
  await expect(page.getByTestId("amb-alert")).toHaveCount(1);
  await expect(page.getByTestId("amb-alert")).toContainText("Power is out at 61 Ambassador Home Dr.");
  await expect(page.getByTestId("amb-alert").getByRole("link", { name: "See what residents read" })).toHaveAttribute("href", `/en/alerts/${SLUGS[0]}`);
  await expect(page.getByTestId("amb-post")).toHaveCount(1);
  await expect(page.getByTestId("amb-post")).toContainText("No water on floor 3.");
  await expect(page.getByTestId("amb-post-state")).toHaveText("Waiting for the Hub");
  await expect(page.getByTestId("amb-round")).toContainText("No check-in round right now.");
  await expect(page.getByText("Water is off at 63 Ambassador Home Dr.")).toHaveCount(0);
  const root = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);

  // Every response of the home is no-store, and the Hub's home no longer shows the incidents list to an Ambassador.
  const response = await page.request.get("/staff");
  expect(response.headers()["cache-control"]).toBe("no-store");
  await expect(page.getByRole("heading", { name: "Open incidents" })).toHaveCount(0);

  // The assignment is removed: the very next load has no building, no alert and no post.
  await sql`delete from ambassador_assignment where staff_id = ${person.id}`;
  await page.reload();
  await expect(page.getByTestId("not-assigned")).toContainText("You are not assigned to a building.");
  await expect(page.getByTestId("amb-alert")).toHaveCount(0);
  await expect(page.getByTestId("amb-post")).toHaveCount(0);
  await expect(page.getByText("Power is out at 61 Ambassador Home Dr.")).toHaveCount(0);
});

test("a suspended Ambassador gets 401 on their next request and is sent to sign-in", async ({ page }) => {
  const person = await newAccount("ambassador");
  await sql`insert into ambassador_assignment (staff_id, rsn, all_floors, assigned_by) values (${person.id}, ${MINE}, true, ${person.id})`;
  await signInAs(page, person);
  await expect(page).toHaveURL(/\/staff$/);
  expect((await page.request.get("/api/staff/me")).status()).toBe(200);

  await sql`update staff_account set status = 'suspended' where id = ${person.id}`;

  expect((await page.request.get("/api/staff/me")).status()).toBe(401);
  await page.goto("/staff");
  await expect(page).toHaveURL(/\/staff\/sign-in/);
});
