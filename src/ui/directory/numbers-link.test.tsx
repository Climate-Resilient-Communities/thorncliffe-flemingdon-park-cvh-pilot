import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import en from "@/i18n/messages/en.json";

const route = vi.hoisted(() => ({ exists: false }));
vi.mock("./numbers-route", () => ({
  get NUMBERS_PAGE_EXISTS() {
    return route.exists;
  },
  numbersHref: (lang: string) => `/${lang}/ready`,
}));

import { NumbersLink } from "./numbers-link";

const render = () =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={en as unknown as AbstractIntlMessages}>
      <NumbersLink lang="en" />
    </NextIntlClientProvider>,
  );

describe("NumbersLink", () => {
  it("shows nothing, not a link to a page that is not there, while the essential numbers page does not exist", () => {
    route.exists = false;

    expect(render()).toBe("");
  });

  it("links to the numbers page, with the sentence about it, once the page exists", () => {
    route.exists = true;
    const html = render();

    expect(html).toContain('href="/en/ready"');
    expect(html).toContain('data-testid="numbers-link"');
    expect(html).toContain("See the essential numbers");
    expect(html).toContain("The numbers page lists the other numbers you may need.");
  });
});
