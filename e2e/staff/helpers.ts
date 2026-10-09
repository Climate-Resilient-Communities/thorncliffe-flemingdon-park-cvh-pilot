import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { memoryIdentityProvider } from "../../src/modules/identity/adapters/memoryIdentityProvider";
import { pepperPassword } from "../../src/modules/identity/application/passwordPepper";

// Helpers of the staff end-to-end tests that need a person at the Hub gate (playwright.staff.config.ts, the production
// build, the identity fake and a disposable database). Accounts are written straight into the database and the
// fake's state file, as S01.05 would have made them.
const ownerUrl = process.env.STAFF_TEST_DATABASE_URL;
const fakeFile = process.env.CVH_FAKE_IDENTITY_FILE;
const pepper = process.env.STAFF_PASSWORD_PEPPER;

export function openDatabase(): postgres.Sql {
  if (!ownerUrl || !fakeFile || !pepper) {
    throw new Error("STAFF_TEST_DATABASE_URL, CVH_FAKE_IDENTITY_FILE and STAFF_PASSWORD_PEPPER are required (playwright.staff.config.ts)");
  }
  return postgres(ownerUrl, { max: 1, onnotice: () => {} });
}

/** The identity fake the server runs against (its state file is shared with the tests). */
export const identityFake = () => memoryIdentityProvider({ file: fakeFile });

/** What the fake holds for a password: Supabase Auth would hold the peppered one, as the adapter sends it. */
export const pepperedPassword = (password: string) => pepperPassword(pepper as string, password);

/** A new account on its starting password; usernames are unique per run. */
export async function newAccount(sql: postgres.Sql, role: "ambassador" | "coordinator", firstName: string, lastName: string) {
  const username = `${firstName.toLowerCase()}${randomBytes(3).toString("hex")}`;
  const startingPassword = `cvh-${firstName.toLowerCase()}-${lastName.toLowerCase()}`;
  const authUserId = identityFake().plant(`${username}@staff.cvh.invalid`, { password: pepperedPassword(startingPassword), createdAt: new Date() });
  await sql`
    insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password, starting_password_issued_at)
    values (${randomUUID()}, ${authUserId}, ${username}, ${firstName}, ${lastName}, 'someone@example.org', ${role}, true, now())`;
  return { username, startingPassword };
}

/** A new Ambassador (the one role that reaches the Hub before authenticators exist, S01.10). */
export const newAmbassador = (sql: postgres.Sql, firstName: string, lastName: string) => newAccount(sql, "ambassador", firstName, lastName);

/** Signs in with the starting password, chooses a new one and lands on the Hub. */
export async function signInToTheHub(page: Page, sql: postgres.Sql, firstName: string, lastName: string) {
  const { username, startingPassword } = await newAmbassador(sql, firstName, lastName);
  await page.goto("/staff/sign-in");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(startingPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/staff\/setup\/password$/);
  await page.getByLabel("New password", { exact: true }).fill("a long new password");
  await page.getByLabel("Type the new password again").fill("a long new password");
  await page.getByRole("button", { name: "Save my password" }).click();
  await expect(page).toHaveURL(/\/staff$/);
  return { username };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/**
 * The URL path of every staff page and API route on disk (src/app/staff/**\/page.tsx, src/app/api/staff/**\/route.ts),
 * so a route added later is covered the moment it exists. A dynamic segment is filled with a sample value.
 */
export function staffRoutes(): string[] {
  const app = path.join(__dirname, "..", "..", "src", "app");
  const urlOf = (file: string) =>
    "/" +
    path
      .relative(app, path.dirname(file))
      .split(path.sep)
      .filter((segment) => !/^\(.*\)$/.test(segment))
      .map((segment) => segment.replace(/^\[\[\.\.\.\w+\]\]$/, "").replace(/^\[\.\.\.\w+\]$/, "sample/deeper").replace(/^\[\w+\]$/, "sample"))
      .filter(Boolean)
      .join("/");
  return [
    ...walk(path.join(app, "staff")).filter((file) => /\/page\.tsx?$/.test(file)),
    ...walk(path.join(app, "api", "staff")).filter((file) => /\/route\.ts$/.test(file)),
  ]
    .map(urlOf)
    .sort();
}
