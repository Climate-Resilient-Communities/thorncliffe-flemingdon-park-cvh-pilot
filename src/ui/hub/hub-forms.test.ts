import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { layoutDeclarations, readSource } from "../../../test/helpers/layout-css";

const FILE = "src/ui/hub/hub-forms.css";
const css = layoutDeclarations(FILE);
const value = (selector: string, prop: string) => css.find((d) => d.selector === selector && d.prop === prop && !d.at.length)?.value;

describe("hub-forms.css (the Hub's buttons, input and error line)", () => {
  it("is imported with the Hub shell's stylesheet, in the components layer", () => {
    const staff = readFileSync(path.join(__dirname, "..", "..", "app", "staff", "staff.css"), "utf8");
    expect(staff).toContain('@import "../../ui/hub/hub-forms.css";');
    const text = readSource(FILE);
    expect(text).toMatch(/^@layer components \{/m);
    expect(text.replace(/\/\*[\s\S]*?\*\//g, "").trim().startsWith("@layer components {")).toBe(true);
  });

  it("defines the button, its two variants, the input and the error line", () => {
    const selectors = new Set(css.map((d) => d.selector));
    for (const selector of [".hub-button", ".hub-button--primary", ".hub-button--secondary", ".hub-input", ".hub-error"]) expect(selectors, selector).toContain(selector);
  });

  it("paints the primary button --ink on --on-deep and the secondary --surface-raised with a --control-border hairline", () => {
    expect(value(".hub-button--primary", "background-color")).toBe("var(--ink)");
    expect(value(".hub-button--primary", "color")).toBe("var(--on-deep)");
    expect(value(".hub-button--secondary", "background-color")).toBe("var(--surface-raised)");
    expect(value(".hub-button--secondary", "border-color")).toBe("var(--control-border)");
    expect(value(".hub-button--secondary", "color")).toBe("var(--ink)");
  });

  it("gives the input a --control-border hairline, --radius-card corners and a --surface-raised background, and the error --danger in bold", () => {
    expect(value(".hub-input", "border")).toBe("var(--offset-align-hairline) solid var(--control-border)");
    expect(value(".hub-input", "border-radius")).toBe("var(--radius-card)");
    expect(value(".hub-input", "background-color")).toBe("var(--surface-raised)");
    expect(value(".hub-input", "max-inline-size")).toBe("100%");
    expect(css.find((d) => d.selector === "fieldset" && d.prop === "min-inline-size")?.value).toBe("0");
    expect(value(".hub-error", "color")).toBe("var(--danger)");
    expect(value(".hub-error", "font-weight")).toBe("bold");
  });

  it("looks inert when disabled, and meets the touch target", () => {
    expect(css.find((d) => d.selector.includes(".hub-button:disabled") && d.prop === "cursor")?.value).toBe("not-allowed");
    expect(value(".hub-button", "min-block-size")).toBe("var(--tap-current)");
    expect(value(".hub-button", "max-inline-size")).toBe("100%");
    expect(value(".hub-button", "overflow-wrap")).toBe("anywhere");
    expect(value(".hub-input", "min-block-size")).toBe("var(--tap-current)");
  });

  it("makes the label of a checkbox or radio the tap target (.hub-choice), with the control at the icon size in the ink colour", () => {
    expect(value(".hub-choice", "display")).toBe("inline-flex");
    expect(value(".hub-choice", "align-items")).toBe("center");
    expect(value(".hub-choice", "min-block-size")).toBe("var(--tap-current)");
    expect(value(".hub-choice", "min-inline-size")).toBe("var(--tap-current)");
    expect(value(".hub-choice", "padding-inline")).toBe("var(--gap-label)");
    // Its text wraps in the column, even an unbreakable word (the audience pages' long labels, S04.04).
    expect(value(".hub-choice", "max-inline-size")).toBe("100%");
    expect(value(".hub-choice", "overflow-wrap")).toBe("anywhere");
    expect(value(".hub-choice > input", "inline-size")).toBe("var(--size-icon)");
    expect(value(".hub-choice > input", "block-size")).toBe("var(--size-icon)");
    expect(value(".hub-choice > input", "accent-color")).toBe("var(--ink)");
  });

  it("uses no colour or length literal: tokens only", () => {
    const text = readSource(FILE).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(text).not.toMatch(/rgb\(|rgba\(|#[0-9a-f]{3,8}\b/i);
    expect(text).not.toMatch(/\b\d+(\.\d+)?(px|rem|em)\b/);
  });
});
