import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import { CallHub } from "./call-hub";
import { HUB_PHONE, HUB_TEL } from "./contact";

const render = (lang: "en" | "ur") =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={lang} messages={(lang === "ur" ? ur : en) as unknown as AbstractIntlMessages}>
      <CallHub testId="hub-call" />
    </NextIntlClientProvider>,
  );

describe("CallHub", () => {
  it("dials the Hub's number from the generated E.164 value, and shows it as one isolated left-to-right run", () => {
    for (const lang of ["en", "ur"] as const) {
      const html = render(lang);

      expect(html).toContain(`href="${HUB_TEL}"`);
      expect(html).toContain(`<bdi lang="en" dir="ltr">${HUB_PHONE}</bdi>`);
    }
  });

  it("is the one link, with the words of R11.call around the number", () => {
    expect(render("en")).toBe(`<a class="dir-call tap" href="${HUB_TEL}" data-testid="hub-call">Call <bdi lang="en" dir="ltr">${HUB_PHONE}</bdi></a>`);
  });
});
