import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Verified } from "./verified";

/** The text of rendered markup: the runs between its tags, joined (read out, not sanitised). */
const textOf = (html: string) => [...`>${html}<`.matchAll(/>([^<]*)</g)].map((match) => match[1]).join("");

const CSS = readFileSync(path.join(__dirname, "verified.css"), "utf8");

describe("the verified badge", () => {
  it("confirmed: the rosette filled in the brand blue with a tick, beside its words", () => {
    const html = renderToStaticMarkup(<Verified confirmed>Confirmed Oct 2, 2026</Verified>);

    expect(html).toMatch(/^<span class="verified verified--yes" data-confirmed="true">/);
    expect(html).toContain('class="verified__shape"');
    expect(html).toContain('class="verified__tick"');
    expect(html).toContain('<span class="verified__text">Confirmed Oct 2, 2026</span>');
    expect(CSS).toMatch(/\.verified--yes \.verified__shape \{\s*fill: var\(--verified-fill\);/);
    expect(CSS).toContain("--verified-fill: var(--tpch-blue);");
  });

  it("not confirmed: the rosette as a grey outline, with no tick", () => {
    const html = renderToStaticMarkup(<Verified confirmed={false}>Not confirmed</Verified>);

    expect(html).toContain('class="verified verified--no" data-confirmed="false"');
    expect(html).toContain('class="verified__shape"');
    expect(html).not.toContain("verified__tick");
    expect(CSS).toMatch(/\.verified--no \.verified__shape \{\s*fill: none;\s*stroke: var\(--verified-outline\);/);
    expect(CSS).toContain("--verified-outline: var(--text-muted);");
  });

  it("is hidden from assistive technology and never focusable: its words carry the meaning", () => {
    const html = renderToStaticMarkup(<Verified confirmed>Checked by the Hub · October 2, 2026</Verified>);
    const svg = html.match(/<svg[^>]*>/)?.[0] ?? "";

    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('focusable="false"');
    expect(svg).not.toMatch(/role=|aria-label|<title/);
    // Read out, the badge is its words and nothing else.
    expect(textOf(html)).toBe("Checked by the Hub · October 2, 2026");
  });

  it("is drawn at 16 or 20 px, square, from a 24-unit box", () => {
    for (const size of [16, 20] as const) {
      const svg = renderToStaticMarkup(<Verified confirmed size={size}>x</Verified>).match(/<svg[^>]*>/)?.[0] ?? "";
      expect(svg).toContain(`width="${size}"`);
      expect(svg).toContain(`height="${size}"`);
      expect(svg).toContain('viewBox="0 0 24 24"');
    }
    expect(renderToStaticMarkup(<Verified confirmed>x</Verified>)).toContain('width="16"');
  });

  it("is our own drawing, inline: no image, no outside file", () => {
    const html = renderToStaticMarkup(<Verified confirmed>x</Verified>);

    expect(html).not.toMatch(/<img|<use|href=|url\(/);
    expect(CSS).not.toMatch(/url\(/);
  });

  it("renders as the element it is given, with a test id, a class and a language for an English fallback line", () => {
    const html = renderToStaticMarkup(
      <Verified confirmed as="p" className="dir-card__confirmed" testId="last-confirmed" lang="en" dir="ltr">
        [EN] Checked by the Hub · October 2, 2026
      </Verified>,
    );

    expect(html).toMatch(/^<p class="verified verified--yes dir-card__confirmed" data-testid="last-confirmed" data-confirmed="true" lang="en" dir="ltr">/);
    expect(html).toMatch(/<\/p>$/);
  });

  it("takes the system's colours in forced-colours mode, and sits at the start of the line by logical properties only", () => {
    const forced = CSS.slice(CSS.indexOf("@media (forced-colors: active)"));

    expect(forced).toMatch(/\.verified--yes \.verified__shape \{\s*fill: CanvasText;/);
    expect(forced).toMatch(/\.verified--no \.verified__shape \{\s*stroke: CanvasText;/);
    expect(forced).toMatch(/\.verified__tick \{\s*stroke: Canvas;/);
    expect(CSS).not.toMatch(/\b(left|right)\b|margin-|padding-/);
    expect(CSS).not.toMatch(/\[dir|:dir\(/);
  });
});
