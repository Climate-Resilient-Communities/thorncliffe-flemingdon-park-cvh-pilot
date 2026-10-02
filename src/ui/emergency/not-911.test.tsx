import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Not911 } from "./not-911";

const english = (key: "text" | "call" | "short") =>
  ({ text: "The CVH is not an emergency service.", call: "If someone is in danger, call 911.", short: "Not an emergency service. In danger? Call 911." })[key];

describe("Not911", () => {
  it("is a note with the 911 mark and the catalog's two sentences (the block form)", () => {
    const html = renderToStaticMarkup(<Not911 t={english} />);

    expect(html).toContain('data-component="not-911"');
    expect(html).toContain('data-variant="block"');
    expect(html).toContain('role="note"');
    expect(html).toContain("The CVH is not an emergency service.");
    expect(html).toContain("If someone is in danger, call 911.");
    // The mark is for the eye; the sentence carries the number for a screen reader.
    expect(html).toContain('<span class="n911__num" aria-hidden="true">911</span>');
  });

  it("is the one short line in the inline form", () => {
    const html = renderToStaticMarkup(<Not911 variant="inline" t={english} />);

    expect(html).toContain('data-variant="inline"');
    expect(html).toContain("Not an emergency service. In danger? Call 911.");
    expect(html).not.toContain("The CVH is not an emergency service.");
  });

  it("sets a sentence that fell back to English left to right in English", () => {
    const html = renderToStaticMarkup(<Not911 t={(key) => (key === "text" ? "[EN] The CVH is not an emergency service." : "اگر کسی کو خطرہ ہو تو 911 پر کال کریں۔")} />);

    expect(html).toContain('<p class="n911__text" lang="en" dir="ltr">[EN] The CVH is not an emergency service.</p>');
    expect(html).toContain('<p class="n911__sub">اگر کسی کو خطرہ ہو تو 911 پر کال کریں۔</p>');
  });
});
