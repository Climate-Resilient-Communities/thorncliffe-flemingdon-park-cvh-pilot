import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// S02.14 (NFR-N2, WCAG 2.1 AA): the colour pairs the resident screens draw text and control edges with, computed from the
// generated tokens in both themes. Body text needs 4.5:1 (1.4.3), large text 3:1, and the edge of a control and the focus
// ring 3:1 against what they sit on (1.4.11). The page checks (axe, e2e/resident/accessibility.spec.ts) measure what is on
// screen; this one fails the moment a token changes to a value that cannot pass.

const css = readFileSync(path.join(__dirname, "..", "src", "ui", "tokens", "tokens.generated.css"), "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("\n}", start));
  return Object.fromEntries([...body.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()]));
}

const light = block(":root");
const dark = { ...light, ...block('[data-theme="dark"]') };

function resolve(tokens: Record<string, string>, name: string): string {
  let value = tokens[`--${name}`];
  if (value === undefined) throw new Error(`no token --${name}`);
  for (let i = 0; i < 5; i++) {
    const ref = /^var\((--[\w-]+)\)$/.exec(value);
    if (!ref) break;
    value = tokens[ref[1]];
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} is not a six-digit colour: ${value}`);
  return value;
}

const channel = (hex: string, at: number) => {
  const c = parseInt(hex.slice(at, at + 2), 16) / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);

/** The WCAG contrast ratio of two colours. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, least ratio]
const TEXT: [string, string, number][] = [
  ["text", "surface", 4.5],
  ["text", "surface-raised", 4.5],
  ["ink", "surface", 4.5],
  ["ink", "surface-raised", 4.5],
  ["text-muted", "surface", 4.5],
  ["text-muted", "surface-raised", 4.5],
  ["accent-text", "surface", 4.5],
  ["accent-text", "surface-raised", 4.5],
  ["eyebrow", "surface", 4.5],
  ["eyebrow", "surface-raised", 4.5],
  ["danger", "surface", 4.5],
  ["danger", "surface-raised", 4.5],
  ["on-deep", "surface-deep", 4.5],
  ["text-on-warm", "surface-warm", 4.5],
  ["on-yellow", "yellow-tint", 4.5],
  // The numerals of the guides are large text.
  ["numeral", "surface", 3],
  ["numeral", "surface-raised", 3],
];
const EDGES: [string, string, number][] = [
  ["control-border", "surface", 3],
  ["control-border", "surface-raised", 3],
  ["focus-ring", "surface", 3],
  ["focus-ring", "surface-raised", 3],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("the %s theme", (_name, tokens) => {
  it.each([...TEXT, ...EDGES])("--%s on --%s is at least %s:1", (foreground, background, least) => {
    // Pairs the dark theme does not use (the warm card and the yellow tint keep their light values) are checked as they are.
    const ratio = contrast(resolve(tokens, foreground), resolve(tokens, background));
    expect(ratio, `${foreground} ${resolve(tokens, foreground)} on ${background} ${resolve(tokens, background)}`).toBeGreaterThanOrEqual(least);
  });
});

describe("the contrast function", () => {
  it("gives 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#5a6b7a", "#5a6b7a")).toBeCloseTo(1, 5);
  });
});
