import { expect, test, type Page } from "@playwright/test";
import { mount } from "../helpers/layout-fixture";
import { readSource } from "../../test/helpers/layout-css";

// Line heights by script (tokens.json type.lineHeights, G10), read from the browser as the ratio of the
// used line height to the font size of text-body and text-h2, which read the semantic type tokens.
const tokens = JSON.parse(readSource("design/prototype/ds/cvrh/tokens.json"));
type LineHeight = { name: string; value: number; languages?: string[] };
const lineHeights: LineHeight[] = tokens.type.lineHeights;
const value = (name: string) => lineHeights.find((token) => token.name === name)!.value;

const SCRIPTS = {
  arabic: { body: value("lh-body-arabic"), tight: value("lh-tight-arabic"), staffBody: value("lh-body-arabic"), staffTight: value("lh-tight-arabic") },
  indic: { body: value("lh-body-indic"), tight: value("lh-tight-indic"), staffBody: value("lh-body-staff"), staffTight: value("lh-tight-indic") },
  chinese: { body: value("lh-body-chinese"), tight: value("lh-tight"), staffBody: value("lh-body-staff"), staffTight: value("lh-tight") },
} as const;
const DEFAULT = { body: value("lh-body"), tight: value("lh-tight"), staffBody: value("lh-body-staff"), staffTight: value("lh-tight") };

// An app LangCode and the standard tag a browser or a catalogue may carry for it.
const STANDARD_TAGS: Record<string, string> = { prs: "fa-AF", pa: "pa-Guru" };
const cases = (["arabic", "indic", "chinese"] as const).flatMap((script) =>
  lineHeights
    .find((token) => token.name === `lh-body-${script}`)!
    .languages!.flatMap((code) => [code, ...(STANDARD_TAGS[code] ? [STANDARD_TAGS[code]] : [])].map((tag) => ({ script, code, tag }))),
);

async function ratios(page: Page, selector = "[data-role]") {
  return page.evaluate((query) => {
    const found: Record<string, number> = {};
    for (const element of document.querySelectorAll<HTMLElement>(query)) {
      const style = getComputedStyle(element);
      const language = element.closest("[lang]")!.getAttribute("lang")!;
      found[`${language}/${element.dataset.role}`] = Math.round((parseFloat(style.lineHeight) / parseFloat(style.fontSize)) * 1000) / 1000;
    }
    return found;
  }, selector);
}

test.describe("line height by script", () => {
  test("covers every language of tokens.json and its standard tag (zh-Hans, zh-Hant, fa-AF, pa-Guru)", () => {
    expect(cases.map(({ tag }) => tag)).toEqual(
      expect.arrayContaining(["ur", "ps", "prs", "fa-AF", "hi", "pa", "pa-Guru", "gu", "bn", "ta", "zh-Hans", "zh-Hant"]),
    );
  });

  for (const surface of ["resident", "staff"] as const) {
    test(`a lang subtree inside an en ${surface} page gets its script's line height`, async ({ page }) => {
      const tags = ["en", ...cases.map(({ tag }) => tag)];
      await mount(page, "LangProbes", { surface, tags }, { lang: "en" });
      const found = await ratios(page);
      const staff = surface === "staff";

      expect(found["en/body"]).toBe(staff ? DEFAULT.staffBody : DEFAULT.body);
      expect(found["en/tight"]).toBe(DEFAULT.tight);
      for (const { script, tag } of cases) {
        expect(found[`${tag}/body`], `${tag} body`).toBe(staff ? SCRIPTS[script].staffBody : SCRIPTS[script].body);
        expect(found[`${tag}/tight`], `${tag} tight`).toBe(staff ? SCRIPTS[script].staffTight : SCRIPTS[script].tight);
      }
    });
  }

  test("an Urdu subtree inside an en page is 1.9 (the page is not ur)", async ({ page }) => {
    await mount(page, "LangProbes", { surface: "resident", tags: ["ur"] }, { lang: "en" });

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    expect((await ratios(page))["ur/body"]).toBe(1.9);
  });

  for (const surface of ["resident", "staff"] as const) {
    for (const { script, tag } of cases) {
      test(`${tag} on a ${surface} page: html lang=${tag}`, async ({ page }) => {
        await mount(page, surface === "staff" ? "StaffTypePage" : "PlainText", {}, { lang: tag });
        const found = await ratios(page);

        expect(found[`${tag}/body`], `${tag} body`).toBe(surface === "staff" ? SCRIPTS[script].staffBody : SCRIPTS[script].body);
        expect(found[`${tag}/tight`], `${tag} tight`).toBe(surface === "staff" ? SCRIPTS[script].staffTight : SCRIPTS[script].tight);
      });
    }
  }

  for (const tag of ["ur", "ps", "prs", "hi", "zh-Hans"]) {
    test(`${tag} around a staff Screen: the surface inside the language subtree`, async ({ page }) => {
      const script = cases.find((candidate) => candidate.tag === tag)!.script;
      await mount(page, "LangAroundScreen", { tag, surface: "staff" }, { lang: "en" });
      const found = await ratios(page);

      expect(found[`${tag}/body`]).toBe(SCRIPTS[script].staffBody);
      expect(found[`${tag}/tight`]).toBe(SCRIPTS[script].staffTight);
    });
  }

  for (const lang of ["ur", "ps", "prs"]) {
    test(`staff surface in ${lang}: body 1.9 and tight 1.6`, async ({ page }) => {
      await mount(page, "StaffTypePage", {}, { lang });
      const found = await ratios(page);

      expect(found[`${lang}/body`]).toBe(1.9);
      expect(found[`${lang}/tight`]).toBe(1.6);
    });
  }

  for (const lang of ["hi", "zh-Hans", "zh-Hant"]) {
    test(`staff surface in ${lang}: body stays the staff 1.45`, async ({ page }) => {
      await mount(page, "StaffTypePage", {}, { lang });

      expect((await ratios(page))[`${lang}/body`]).toBe(1.45);
    });
  }

  test("text-body follows the surface font size, too: 18px resident, 16px staff, 22px in basic mode", async ({ page }) => {
    const size = async () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector("[data-role=body]")!).fontSize));
    await mount(page, "LangProbes", { surface: "resident", tags: ["en"] });
    expect(await size()).toBe(18);
    await mount(page, "LangProbes", { surface: "staff", tags: ["en"] });
    expect(await size()).toBe(16);
    await mount(page, "LangProbes", { surface: "resident", tags: ["en"] }, { basic: true });
    expect(await size()).toBe(22);
  });
});
