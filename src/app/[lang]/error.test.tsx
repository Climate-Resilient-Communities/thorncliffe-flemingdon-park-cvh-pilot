// A page of the resident surface that throws still tells a resident to call 911 (AR-27): error.tsx draws the shell's
// 911 block in the page's language, from the x01 words the layout sends the browser.
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import ResidentError from "./error";

const render = (lang: string, x01: Record<string, string>) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={lang} messages={{ x01 }}>
      <ResidentError />
    </NextIntlClientProvider>,
  );

describe("the error page of the resident surface", () => {
  it("is the 911 block, once, in English", () => {
    const html = render("en", en.x01);

    expect(html.match(/data-component="not-911"/g)).toHaveLength(1);
    expect(html).toContain("The CVH is not an emergency service.");
    expect(html).toContain("If someone is in danger, call 911.");
  });

  it("is the 911 block in the page's language", () => {
    const html = render("ur", ur.x01);

    expect(html.match(/data-component="not-911"/g)).toHaveLength(1);
    expect(html).toContain(ur.x01.call);
  });
});
