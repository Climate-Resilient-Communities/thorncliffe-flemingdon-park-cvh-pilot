import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { layoutDeclarations, layoutLiterals, literalLengths, physicalDeclarations, readSource } from "../../../test/helpers/layout-css";
import { Screen } from "./screen";

const css = layoutDeclarations("src/ui/layout/screen.css");
const semantic = new Set(layoutDeclarations("src/ui/tokens/semantic.css").map((d) => d.prop));
const SPACING = /^(?:padding|margin)(?:-[a-z-]+)?$|^(?:gap|row-gap|column-gap)$/;

describe("Screen", () => {
  it("renders the body only, with the surface and inset", () => {
    expect(renderToStaticMarkup(<Screen surface="resident">a</Screen>)).toBe(
      '<div class="layout-screen" data-surface="resident" data-inset="default"><div class="layout-screen__body">a</div></div>',
    );
  });

  it("renders bleed, body and actions in reading order, the actions as a named region", () => {
    const html = renderToStaticMarkup(
      <Screen surface="staff" width="review" bleed={<div>map</div>} actions={<button>Approve</button>} actionsLabel="Approval" testId="o-05">
        <p>body</p>
      </Screen>,
    );

    expect(html).toBe(
      '<div class="layout-screen" data-surface="staff" data-width="review" data-inset="default" data-testid="o-05">' +
        '<div class="layout-screen__bleed"><div>map</div></div>' +
        '<div class="layout-screen__body"><p>body</p></div>' +
        '<div class="layout-screen__actions" role="region" aria-label="Approval"><button>Approve</button></div></div>',
    );
  });

  it("gives staff screens the default width and resident screens none", () => {
    expect(renderToStaticMarkup(<Screen surface="staff" />)).toContain('data-width="default"');
    expect(renderToStaticMarkup(<Screen surface="resident" inset="none" />)).not.toContain("data-width");
  });

  it("sets every spacing declaration from a --screen-* token that is a var() of a semantic token", () => {
    const tokens = css.filter((d) => d.prop.startsWith("--screen-"));
    const spacing = css.filter((d) => SPACING.test(d.prop) && !d.selector.includes('[data-inset="none"]'));

    expect(tokens.length).toBeGreaterThan(0);
    for (const { prop, value } of tokens) {
      expect(semantic.has(/^var\((--[\w-]+)\)$/.exec(value)?.[1] ?? ""), `${prop}: ${value}`).toBe(true);
    }
    for (const { prop, value } of spacing) {
      expect(value, prop).toMatch(prop === "margin-inline" ? /^auto$/ : /^var\(--screen-[\w-]+\)$/);
    }
    expect(css.filter((d) => d.selector.includes('[data-inset="none"]')).map((d) => d.value)).toEqual(["0", "0", "0"]);
  });

  it("switches the staff inset with the hub: variant and makes the staff body the hub-page query container", () => {
    expect(css.filter((d) => d.at.includes("@variant hub")).map((d) => `${d.prop}: ${d.value}`)).toEqual([
      "--screen-inset-inline: var(--inset-page-staff)",
      "--screen-inset-block-start: var(--inset-page-staff)",
      "--screen-inset-block-end: var(--inset-page-staff)",
    ]);
    expect(
      css.filter((d) => d.prop.startsWith("container")).map((d) => `${d.selector} { ${d.prop}: ${d.value} }`),
    ).toEqual([
      '.layout-screen[data-surface="staff"] > .layout-screen__body { container-type: inline-size }',
      '.layout-screen[data-surface="staff"] > .layout-screen__body { container-name: hub-page }',
    ]);
  });

  it("has no literal length other than 0, no physical property or 3- or 4-value shorthand, and no [dir] selector", () => {
    expect(literalLengths(css)).toEqual([]);
    expect(physicalDeclarations(css)).toEqual([]);
    expect(readSource("src/ui/layout/screen.css")).not.toMatch(/\[dir/);
    expect(readSource("src/ui/layout/screen.css")).not.toMatch(layoutLiterals());
    expect(readSource("src/ui/layout/screen.tsx")).not.toMatch(/style=|className=\{|marginLeft|paddingRight|left:|right:/);
  });
});
