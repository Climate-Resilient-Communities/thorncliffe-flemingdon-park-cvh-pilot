import { expect, test, type Page } from "@playwright/test";
import { englishText } from "../../src/i18n/text";
import { REAL_TEXTS, hubBrand } from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// The staff screens made of forms, in en: the gate pages outside the Hub shell (sign-in, the authenticator code, choose a
// password, set up an authenticator) and the People screen inside it. The pages' real forms render with the Hub's
// control styles (hub-forms.css); a bare <input> or <button> reads as plain text, which is what these pictures guard
// against (the unit test src/app/staff/hub-controls.test.ts guards the markup, these the look). The forms post with
// fetch, so where a picture needs an answer the page's fetch is replaced with one that returns it.
const brand = hubBrand();
const HEIGHT = 844;

async function size(page: Page, width: number) {
  await page.setViewportSize({ width, height: HEIGHT });
}

/** Every visible control of the screen (the shell's own are tested with the shell) reads as a control: a text field has a visible edge and a fill, a button has a fill or an edge. */
async function expectControlsLookLikeControls(page: Page) {
  const problems = await page.evaluate(() => {
    const visible = (color: string) => color !== "rgba(0, 0, 0, 0)" && color !== "transparent";
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("main input, main select, main textarea, main button")) {
      if (el instanceof HTMLInputElement && ["hidden", "checkbox", "radio"].includes(el.type)) continue;
      const style = getComputedStyle(el);
      const edge = parseFloat(style.borderTopWidth) > 0 && visible(style.borderTopColor);
      const fill = visible(style.backgroundColor) && style.backgroundColor !== "rgb(255, 255, 255)";
      const name = `${el.tagName.toLowerCase()}#${el.id || el.textContent?.trim()}`;
      if (el instanceof HTMLButtonElement ? !(edge || fill) : !edge) out.push(`${name} has no visible edge`);
      if (el instanceof HTMLButtonElement && parseFloat(style.paddingTop) === 0) out.push(`${name} has no padding`);
      if (!(el instanceof HTMLButtonElement)) {
        const box = el.getBoundingClientRect();
        const column = el.parentElement?.getBoundingClientRect();
        if (column && Math.abs(box.width - column.width) > 1) out.push(`${name} is ${Math.round(box.width)}px wide in a ${Math.round(column.width)}px column`);
      }
    }
    return out;
  });
  expect(problems).toEqual([]);
}

async function answerFetch(page: Page, status: number, body: unknown) {
  await page.evaluate(
    ([code, answer]) => {
      window.fetch = async () => new Response(JSON.stringify(answer), { status: code, headers: { "content-type": "application/json" } });
    },
    [status, body] as const,
  );
}

for (const width of [1280, 390]) {
  test(`sign-in at ${width}px`, async ({ page }) => {
    await size(page, width);
    await mountHydrated(page, "StaffGateFixture", { page: "sign-in", logoSrc: brand.logoSrc });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(englishText("staff.signIn.title"));
    await expectControlsLookLikeControls(page);
    await expectBaseline(page, `staff-sign-in-${width}.png`, { fullPage: true });
  });

  test(`sign-in refused at ${width}px`, async ({ page }) => {
    await size(page, width);
    await mountHydrated(page, "StaffGateFixture", { page: "sign-in", logoSrc: brand.logoSrc });
    await answerFetch(page, 401, { error: "invalid_credentials", message: "That username or password is not right." });
    await page.getByLabel("Username").fill("amira");
    await page.getByLabel("Password", { exact: true }).fill("wrong");
    await page.getByRole("button", { name: englishText("staff.signIn.submit") }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText("not right");
    expect(await alert.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("700");
    await expectBaseline(page, `staff-sign-in-refused-${width}.png`, { fullPage: true });
  });

  test(`authenticator code at ${width}px`, async ({ page }) => {
    await size(page, width);
    await mountHydrated(page, "StaffGateFixture", { page: "code", logoSrc: brand.logoSrc });
    await expectControlsLookLikeControls(page);
    await expectBaseline(page, `staff-sign-in-code-${width}.png`, { fullPage: true });
  });

  test(`choose a password at ${width}px`, async ({ page }) => {
    await size(page, width);
    await mountHydrated(page, "StaffGateFixture", { page: "password", logoSrc: brand.logoSrc });
    await expectControlsLookLikeControls(page);
    await expectBaseline(page, `staff-setup-password-${width}.png`, { fullPage: true });
  });

  test(`set up an authenticator at ${width}px`, async ({ page }) => {
    await size(page, width);
    await mountHydrated(page, "StaffGateFixture", { page: "authenticator", logoSrc: brand.logoSrc });
    await expectControlsLookLikeControls(page);
    await expectBaseline(page, `staff-setup-authenticator-start-${width}.png`, { fullPage: true });

    const qrCode = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#fff"/><rect x="20" y="20" width="60" height="60"/><rect x="120" y="20" width="60" height="60"/><rect x="20" y="120" width="60" height="60"/></svg>')}`;
    await answerFetch(page, 200, { secret: "JBSWY3DPEHPK3PXP", uri: "otpauth://totp/Hub?secret=JBSWY3DPEHPK3PXP", qrCode });
    await page.getByRole("button", { name: englishText("staff.setup.authenticator.start") }).click();
    await expect(page.getByTestId("authenticator-key")).toBeVisible();
    await expectControlsLookLikeControls(page);
    await expectBaseline(page, `staff-setup-authenticator-enrolled-${width}.png`, { fullPage: true });
  });

  test(`people at ${width}px`, async ({ page }) => {
    await size(page, width);
    const texts = { ...REAL_TEXTS, heading: englishText("staff.people.title"), paragraphs: [englishText("staff.people.lead")] };
    await mountHydrated(page, "PeopleFixture", { texts, brand });
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(englishText("staff.people.title"));
    await expectControlsLookLikeControls(page);
    await expectBaseline(page, `staff-people-${width}.png`, { fullPage: true });
  });

  test(`people refused at ${width}px`, async ({ page }) => {
    await size(page, width);
    const texts = { ...REAL_TEXTS, heading: englishText("staff.people.title"), paragraphs: [englishText("staff.people.lead")] };
    await mountHydrated(
      page,
      "PeopleFixture",
      {
        texts,
        brand,
        add: { status: "refused", message: "That username is taken.", field: "username", values: { username: "amira", firstName: "Amira", lastName: "Hassan", email: "amira@example.org", role: "ambassador" } },
        resetPassword: { status: "refused", message: "No account has that username.", username: "nobody" },
      },
      { lang: "en" },
    );
    await expect(page.getByRole("alert")).toHaveCount(2);
    for (const alert of await page.getByRole("alert").all()) expect(await alert.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("700");
    await expectBaseline(page, `staff-people-refused-${width}.png`, { fullPage: true });
  });
}

test("people: only an Admin can add people", async ({ page }) => {
  await size(page, 390);
  const texts = { ...REAL_TEXTS, heading: englishText("staff.people.title"), paragraphs: [englishText("staff.people.lead")] };
  await mountHydrated(page, "PeopleFixture", { texts, brand, refusal: "forbidden" });
  await expect(page.getByRole("alert")).toBeVisible();
  await expectBaseline(page, "staff-people-forbidden-390.png", { fullPage: true });
});
