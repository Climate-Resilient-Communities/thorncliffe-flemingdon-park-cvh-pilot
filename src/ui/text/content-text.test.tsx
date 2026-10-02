import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentText } from "./content-text";

describe("ContentText", () => {
  it("renders a reviewed translation as it is", () => {
    expect(renderToStaticMarkup(<ContentText unavailable={false}>بجلی کی بندش</ContentText>)).toBe("بجلی کی بندش");
    expect(renderToStaticMarkup(<ContentText as="li" unavailable={false}>بجلی</ContentText>)).toBe("<li>بجلی</li>");
  });

  it("sets English standing in for a translation (translation.unavailable) left to right in English, on the element itself", () => {
    expect(renderToStaticMarkup(<ContentText as="li" unavailable>{"Use a flashlight."}</ContentText>)).toBe(
      '<li lang="en" dir="ltr" data-translation="unavailable">Use a flashlight.</li>',
    );
    expect(renderToStaticMarkup(<ContentText as="h1" unavailable className="x" testId="t">{"Power outage"}</ContentText>)).toBe(
      '<h1 class="x" data-testid="t" lang="en" dir="ltr" data-translation="unavailable">Power outage</h1>',
    );
  });

  it("isolates English inline, so it cannot reorder the translated text around it", () => {
    expect(renderToStaticMarkup(<ContentText unavailable>{"Power outage"}</ContentText>)).toBe('<bdi lang="en" dir="ltr" data-translation="unavailable">Power outage</bdi>');
  });

  it("adds no visible [EN] marker: content says once on the page that part of it is in English", () => {
    expect(renderToStaticMarkup(<ContentText as="p" unavailable>{"Call 911."}</ContentText>)).not.toContain("[EN]");
  });
});
