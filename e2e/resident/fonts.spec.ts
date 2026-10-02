import { expect, test } from "@playwright/test";
import { LANGUAGES } from "./helpers";

// S02.02, AD-16: a page downloads only its own language's Noto subset, from the app's own origin.

// The Noto family each launch language's script needs (design/prototype/cvh/data.js: font). Latin languages
// need none: Public Sans carries them.
const NOTO_FAMILY: Record<string, string | null> = {
  latin: null,
  naskh: "Noto Naskh Arabic",
  gujarati: "Noto Sans Gujarati",
  tamil: "Noto Sans Tamil",
  greek: "Noto Sans",
  bengali: "Noto Sans Bengali",
  devanagari: "Noto Sans Devanagari",
  gurmukhi: "Noto Sans Gurmukhi",
  sc: "Noto Sans SC",
};
const ALL_NOTO = Object.values(NOTO_FAMILY).filter((family): family is string => family !== null);

for (const language of LANGUAGES) {
  test(`${language.code} downloads only its own font subset, from this origin`, async ({ page, baseURL }) => {
    const requested: string[] = [];
    const origins = new Set<string>();
    page.on("request", (request) => {
      origins.add(new URL(request.url()).origin);
      if (request.resourceType() === "font") requested.push(request.url());
    });

    await page.goto(`/${language.code}`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForLoadState("networkidle");

    // Which family each font file belongs to, from the page's own @font-face rules.
    const faces = await page.evaluate(() => {
      const found: { family: string; url: string }[] = [];
      for (const sheet of document.styleSheets) {
        for (const rule of sheet.cssRules) {
          if (!(rule instanceof CSSFontFaceRule)) continue;
          const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "").trim();
          for (const match of rule.style.getPropertyValue("src").matchAll(/url\(["']?([^"')]+)/g)) {
            found.push({ family, url: new URL(match[1], sheet.href ?? location.href).href });
          }
        }
      }
      return found;
    });
    const familyOf = (url: string) => faces.find((face) => face.url === url)?.family;
    const families = new Set(requested.map((url) => familyOf(url)));

    expect(requested.length, "font requests").toBeGreaterThan(0);
    expect(families.has(undefined), "every font request comes from an @font-face rule of the page").toBe(false);
    // The only origin the page talks to is the app itself: no font CDN, no analytics.
    expect([...origins]).toEqual([new URL(baseURL!).origin]);

    const own = NOTO_FAMILY[language.font];
    const noto = [...families].filter((family) => ALL_NOTO.includes(family!));
    expect(noto).toEqual(own ? [own] : []);
    for (const family of families) expect(["Public Sans", own], `family ${family}`).toContain(family);
  });
}
