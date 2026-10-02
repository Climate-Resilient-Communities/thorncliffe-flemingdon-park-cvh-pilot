// The directory release in a browser (S02.05), against the production build with the identity fake and a folder
// for the private store (playwright.staff.config.ts): an Admin at aal2 presses "Publish directory", the release is
// current, and the public routes serve its manifest and files, validated against the contract schemas; the roles
// that cannot publish, including a direct post of the action. Nothing real is contacted.
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { DirectoryListingV1, DirectoryManifestV1 } from "../../src/contracts/directory";
import { LANG_CODES } from "../../src/contracts/lang";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { memoryTotpSecret, totpCode } from "../../src/modules/identity/adapters/memoryTotp";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";

const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
const pepper = process.env.STAFF_PASSWORD_PEPPER;

let sql: postgres.Sql;

async function clear() {
  await sql.unsafe(`
    alter table directory_release disable trigger directory_release_guard;
    delete from directory_release;
    alter table directory_release enable trigger directory_release_guard;
    delete from ops_event;
    delete from provider_category; delete from provider_location; delete from provider; delete from category`);
}

// The e2e database is disposable: the catalogue starts as the test's own.
async function loadProviders() {
  await clear();
  await sql`insert into category (id, name, sort_order, labels) values ('e2e-category', 'Community Resilience', 90, ${sql.json({ en: "Community Resilience" })})`;
  const rows: [string, string, boolean][] = [
    ["M901", "Thorncliffe Neighbourhood Office", true],
    ["M902", "Flemingdon Health Centre", true],
    ["M903", "East York Food Bank", false],
  ];
  for (const [id, name, published] of rows) {
    await sql`
      insert into provider (id, name, texts, published, published_at, last_confirmed)
      values (${id}, ${name}, ${sql.json({ services: { en: `Services of ${name}. Call 911 in an emergency.` } })}, ${published}, ${published ? new Date() : null}, '2026-09-20')`;
    await sql`insert into provider_location (provider_id, street, city, postal, lat, lng) values (${id}, ${`${id.slice(1)} Overlea Blvd`}, 'East York', 'M4H 1C6', 43.7, -79.34)`;
    await sql`insert into provider_category (provider_id, category_id) values (${id}, 'e2e-category')`;
  }
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
  await clear();
  await sql?.end({ timeout: 5 });
});

let auditMark = 0;

test.beforeEach(async () => {
  await loadProviders();
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

const audits = () => sql`select actor_staff_id, subject_id, outcome, meta from audit_event where id > ${auditMark} and action = 'directory.published' order by id`;
const publishButton = (page: Page) => page.getByRole("button", { name: "Publish directory" });

test("an Admin publishes the directory: release 1 is current, audited, and the public routes serve it", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const admin = await signInToTheHub(page, "admin");

  const side = page.getByTestId("hub-side");
  await side.getByRole("link", { name: "Directory" }).click();
  await expect(page).toHaveURL(/\/staff\/directory$/);
  await expect(page.getByRole("heading", { level: 1, name: "Directory release" })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(side.getByRole("link", { name: "Directory" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("release-none")).toBeVisible();
  await expect(page.getByTestId("release-published-now")).toHaveText("Providers published now: 2 of 3.");
  expect((await request.get("/api/directory/manifest")).status()).toBe(404);

  await publishButton(page).click();

  await expect(page.getByTestId("publish-message")).toHaveText("Release 1 is now current. Providers: 2. Languages: 16.");
  await expect(page.getByTestId("publish-error")).toHaveCount(0);
  // The page read the release again: it is now the current one.
  await expect(page.getByTestId("release-current")).toHaveText(/^Current release: 1, published \d{4}-\d{2}-\d{2}\.$/);
  await expect(page.getByTestId("release-counts")).toHaveText("Providers: 2. Categories: 1. Languages: 16.");

  const [release] = await sql`select number, status, is_current, catalogue_hash, git_commit, attempts, files from directory_release`;
  expect(release).toMatchObject({ number: 1, status: "complete", is_current: true, attempts: 1 });
  expect(release.catalogue_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(Object.keys(release.files).sort()).toEqual([...LANG_CODES].sort());
  expect((await audits()).map((a) => [a.actor_staff_id, a.subject_id, a.outcome])).toEqual([[admin.id, "1", "ok"]]);

  // The manifest: current release, never cached, search unavailable, a path per language.
  const manifestResponse = await request.get("/api/directory/manifest");
  expect(manifestResponse.status()).toBe(200);
  expect(manifestResponse.headers()["cache-control"]).toBe("no-store");
  expect(manifestResponse.headers()["set-cookie"]).toBeUndefined();
  const manifest = DirectoryManifestV1.parse(await manifestResponse.json());
  expect(manifest).toMatchObject({ release_v: 1, catalogue_hash: release.catalogue_hash, search: { status: "unavailable" } });

  // Each file, from the app's own origin, immutable, valid against the contract, with only the published providers.
  for (const lang of LANG_CODES) {
    expect(manifest.files[lang]).toBe(`/api/directory/1/${lang}.json`);
    const response = await request.get(manifest.files[lang]);
    expect(response.status(), lang).toBe(200);
    expect(response.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.headers()["set-cookie"]).toBeUndefined();
    const file = DirectoryListingV1.parse(await response.json());
    expect(file).toMatchObject({ release_v: 1, lang });
    expect(file.providers.map((p) => p.id)).toEqual(["M901", "M902"]);
  }
  // English fallback for a language with no translation: the listing says so.
  const fr = DirectoryListingV1.parse(await (await request.get("/api/directory/1/fr.json")).json());
  expect(fr.providers[0].services).toMatchObject({ status: "fallback_en", notice: "translation.unavailable", body: "Services of Thorncliffe Neighbourhood Office. Call 911 in an emergency." });

  // An unknown release or language is a 404.
  for (const path of ["/api/directory/2/en.json", "/api/directory/0/en.json", "/api/directory/1/xx.json", "/api/directory/1/en", "/api/directory/abc/en.json"]) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(404);
    expect((await response.json()).error.code).toBe("not_found");
  }
});

test("a change after a release is a new release: the first is never modified, and the second becomes current", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInToTheHub(page, "admin");
  await page.goto("/staff/directory");
  await expectNoHorizontalScroll(page);
  await publishButton(page).click();
  await expect(page.getByTestId("publish-message")).toHaveText(/^Release 1 is now current/);
  const first = await (await request.get("/api/directory/1/en.json")).text();

  await sql`update provider set published = false, published_at = null where id = 'M902'`;
  await publishButton(page).click();

  await expect(page.getByTestId("publish-message")).toHaveText("Release 2 is now current. Providers: 1. Languages: 16.");
  await expectNoHorizontalScroll(page);
  expect(DirectoryManifestV1.parse(await (await request.get("/api/directory/manifest")).json()).release_v).toBe(2);
  expect(await (await request.get("/api/directory/1/en.json")).text()).toBe(first);
  expect(DirectoryListingV1.parse(await (await request.get("/api/directory/2/en.json")).json()).providers.map((p) => p.id)).toEqual(["M901"]);
  expect((await sql`select number, is_current from directory_release order by number`).map((r) => [r.number, r.is_current])).toEqual([[1, false], [2, true]]);
});

test("a publish that cannot finish says 'Publish failed' with the reason, keeps the previous release, and records the failure in ops_event", async ({ page, request }) => {
  await signInToTheHub(page, "admin");
  await page.goto("/staff/directory");
  await publishButton(page).click();
  await expect(page.getByTestId("publish-message")).toHaveText(/^Release 1 is now current/);
  // A provider with no English text cannot be turned into a listing: retrying cannot fix it, so the job gives up at once.
  await sql`update provider set texts = ${sql.json({ services: { ur: "x" } })} where id = 'M902'`;

  await publishButton(page).click();

  await expect(page.getByTestId("publish-error")).toContainText("Publish failed: the catalogue could not be turned into a release. The previous release is still current.");
  await expect(page.getByTestId("publish-error")).toContainText("provider M902 has no English services text");
  await expect(page.getByTestId("publish-error")).toHaveAttribute("role", "alert");
  await expect(page.getByTestId("publish-message")).toHaveText("");
  expect(DirectoryManifestV1.parse(await (await request.get("/api/directory/manifest")).json()).release_v).toBe(1);
  expect((await sql`select kind, severity, detail from ops_event`).map((e) => ({ ...e }))).toEqual([
    { kind: "directory.publish_failed", severity: "error", detail: { reason: "invalid_catalogue", attempts: 1, files_stored: 0 } },
  ]);
  expect((await audits()).map((a) => [a.outcome, a.meta])).toEqual([["ok", expect.objectContaining({ release: 1 })], ["refused", { reason: "publish_failed" }]]);
});

test("the roles that cannot publish are told so, have no menu item, and a direct post of the action is refused", async ({ page, browser, baseURL }) => {
  // The Admin's page carries the action's id in its form.
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await signInToTheHub(adminPage, "admin");
  const html = await (await adminPage.request.get("/staff/directory")).text();
  const formStart = html.indexOf("<form", html.indexOf('data-testid="publish-directory"') - 400);
  const form = html.slice(formStart, html.indexOf("</form>", formStart) + 7);
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const fields = [...form.matchAll(/<input\b[^>]*>/g)].flatMap(([tag]) => {
    const name = /\bname="([^"]*)"/.exec(tag)?.[1];
    return name === undefined ? [] : [[unescape(name), unescape(/\bvalue="([^"]*)"/.exec(tag)?.[1] ?? "")] as [string, string]];
  });
  expect(fields.some(([name]) => name.startsWith("$ACTION"))).toBe(true);
  await adminContext.close();

  await page.setViewportSize({ width: 390, height: 844 });
  const coordinator = await signInToTheHub(page, "coordinator");
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Directory" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/staff/directory");
  await expect(page.getByText("Only an Admin can publish the directory.")).toBeVisible();
  await expect(publishButton(page)).toHaveCount(0);

  const post = new FormData();
  for (const [name, value] of fields) post.append(name, value);
  const response = await page.request.post("/staff/directory", { multipart: post, headers: { origin: baseURL as string } });
  expect(response.status()).toBe(200);
  expect(await sql`select number from directory_release`).toHaveLength(0);
  const denials = await sql`select meta from audit_event where action = 'permission.denied' and actor_staff_id = ${coordinator.id}`;
  expect(denials.map((denied) => denied.meta)).toEqual([{ status: 403, route: "/staff/directory", permission: "guide.publish", reason: "forbidden" }]);
  expect(await audits()).toHaveLength(0);
});

test("an Ambassador and a Director see the refusal and no menu item either", async ({ browser }) => {
  for (const role of ["ambassador", "director"] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await signInToTheHub(page, role);
    await expect(page.getByTestId("hub-side").getByRole("link", { name: "Directory" })).toHaveCount(0);
    await page.goto("/staff/directory");
    await expect(page.getByText("Only an Admin can publish the directory.")).toBeVisible();
    await expect(publishButton(page)).toHaveCount(0);
    await context.close();
  }
});
