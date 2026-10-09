import { expect, test } from "@playwright/test";
import { catalogText } from "./helpers";

// Production UAT, 2026-10-08: the bare address `/` showed only the name, and a path with no language (`/nope`) showed the
// framework's bare English 404. `/` is now one page for everyone that the phone sends on to the resident's language (or to the
// language choice of a first visit); a path with no language is the resident 404 in the shell, in the saved language.

const SAVED_URDU = { v: 1, lang: "ur", welcomed: true };

test.describe("a first visit (nothing on the phone)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the bare address goes on to the language choice", async ({ page }) => {
    const response = await page.goto("/");

    expect(response!.status()).toBe(200);
    await page.waitForURL("**/en/welcome");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose your language");
  });
});

test("the bare address is the same page for everyone, sets nothing and sends a returning resident on to their language", async ({ page, request }) => {
  const plain = await request.get("/", { maxRedirects: 0 });
  expect(plain.status()).toBe(200);
  expect(plain.headers()["set-cookie"]).toBeUndefined();
  expect(plain.headers()["cache-control"] ?? "").not.toMatch(/private/);

  await page.addInitScript((choices) => window.localStorage.setItem("cvh.choices", JSON.stringify(choices)), SAVED_URDU);
  await page.goto("/");
  await page.waitForURL(/\/ur$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "ur");
});

test("a path with no language is the resident 404 in the shell, in English when nothing is saved, at the same address", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const response = await page.goto("/nope");

  expect(response!.status()).toBe(404);
  expect(new URL(page.url()).pathname).toBe("/nope");
  await expect(page.locator("html#__next_error__")).toHaveCount(0);
  await expect(page.getByTestId("shell")).toBeVisible();
  await expect(page.getByTestId("shell-nav")).toBeVisible();
  await expect(page.locator("main h1")).toHaveText(catalogText("en", "shell.pageNotFound"));
});

test("a path with no language is shown in the resident's saved language", async ({ page }) => {
  await page.addInitScript((choices) => window.localStorage.setItem("cvh.choices", JSON.stringify(choices)), SAVED_URDU);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/nope?x=1");

  await page.waitForURL(/\/ur\/nope\?x=1$/);
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("main h1")).toHaveText(catalogText("ur", "shell.pageNotFound"));
});

// Production UAT, 2026-10-08: the footer's two links were written into the shell in English and French only.
test("the footer's links are in the page's language, from the catalog", async ({ page }) => {
  for (const lang of ["ur", "zh", "en"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/${lang}/ready`);
    for (const [id, key] of [
      ["shell-footer-staff", "shell.staffSignIn"],
      ["shell-footer-terms", "shell.termsLink"],
    ]) {
      const link = page.getByTestId(id);
      await expect(link, `${lang} ${key}`).toHaveText(catalogText(lang, key));
      await expect(link.locator("bdi[lang=en]"), `${lang} ${key}`).toHaveCount(0);
    }
    await expect(page.getByTestId("shell-footer-terms")).toHaveAttribute("href", `/${lang}/terms`);
  }
});
