import { test, type Page } from "@playwright/test";
import { REAL_TEXTS, hubBrand, longestTexts, menuButton } from "../helpers/hub-shell";
import { mountHydrated } from "../helpers/layout-fixture";
import { expectBaseline } from "./helpers";

// S01.09: the Hub shell at the widths the story names, in en with the real labels and in en and ur with the longest
// translated ones. The behaviour is asserted in e2e/layout/hub-shell.spec.ts; these pictures show what it looks like.
const brand = hubBrand();
const HEIGHT = 844;

type Props = Parameters<typeof mountHydrated<"HubShellFixture">>[2];
const open = (page: Page, props: Pick<Props, "texts">, lang: string, width: number) =>
  page.setViewportSize({ width, height: HEIGHT }).then(() => mountHydrated(page, "HubShellFixture", { brand, ...props }, { lang }));

const SETS = [
  { name: "real", lang: "en", texts: REAL_TEXTS, widths: [390, 699, 700, 1280] },
  { name: "longest", lang: "en", texts: longestTexts("en"), widths: [390, 699, 700, 1280] },
  { name: "longest", lang: "ur", texts: longestTexts("ur"), widths: [390, 699, 700, 1280] },
] as const;

for (const { name, lang, texts, widths } of SETS) {
  for (const width of widths) {
    test(`shell ${lang} ${name} labels at ${width}px`, async ({ page }) => {
      await open(page, { texts }, lang, width);
      await expectBaseline(page, `shell-${lang}-${name}-${width}.png`);
    });
  }

  test(`shell ${lang} ${name} labels at 390px with the menu open`, async ({ page }) => {
    await open(page, { texts }, lang, 390);
    await menuButton(page).click();
    await expectBaseline(page, `shell-${lang}-${name}-390-menu.png`);
  });
}
