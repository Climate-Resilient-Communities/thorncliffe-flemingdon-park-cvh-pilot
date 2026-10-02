import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { layoutDeclarations, literalLengths, physicalDeclarations, readSource } from "../../../test/helpers/layout-css";
import { INLINE_GAPS, Inline } from "./inline";

const css = layoutDeclarations("src/ui/layout/inline.css");

describe("Inline", () => {
  it("renders a wrapping row with the icon gap, centred and from the inline start", () => {
    expect(renderToStaticMarkup(<Inline>a</Inline>)).toBe(
      '<div class="layout-inline" data-gap="icon" data-align="center" data-justify="start" data-wrap="true">a</div>',
    );
  });

  it("can turn wrapping off and render a list or a paragraph", () => {
    expect(renderToStaticMarkup(<Inline as="ul" wrap={false} justify="between" testId="row"><li>a</li></Inline>)).toBe(
      '<ul class="layout-inline" data-gap="icon" data-align="center" data-justify="between" data-wrap="false" role="list" data-testid="row"><li>a</li></ul>',
    );
    expect(renderToStaticMarkup(<Inline as="p" />)).not.toContain("role=");
  });

  it("renders Inline.Grow as a div or span that takes the remaining space", () => {
    expect(renderToStaticMarkup(<Inline.Grow>title</Inline.Grow>)).toBe('<div class="layout-inline__grow">title</div>');
    expect(renderToStaticMarkup(<Inline.Grow as="span">title</Inline.Grow>)).toBe('<span class="layout-inline__grow">title</span>');
    expect(css.filter((d) => d.selector === ".layout-inline__grow").map((d) => `${d.prop}: ${d.value}`)).toEqual([
      "flex: 1 1 auto",
      "min-inline-size: 0",
    ]);
  });

  it("maps every gap value to its token; the metadata and type-grid gaps also set their row gap", () => {
    const classMap = Object.fromEntries(
      INLINE_GAPS.map((gap) => [gap, css.filter((d) => d.selector === `.layout-inline[data-gap="${gap}"]`).map((d) => `${d.prop}: ${d.value}`)]),
    );

    expect(classMap).toEqual({
      label: ["gap: var(--gap-label)"],
      tight: ["gap: var(--gap-tight)"],
      related: ["gap: var(--gap-related)"],
      target: ["gap: var(--gap-target)"],
      icon: ["gap: var(--gap-icon)"],
      grid: ["gap: var(--gap-grid)"],
      stack: ["gap: var(--gap-stack)"],
      panel: ["gap: var(--gap-panel)"],
      "meta-inline": ["column-gap: var(--gap-meta-inline)", "row-gap: var(--gap-meta-block)"],
      "type-grid-inline": ["column-gap: var(--gap-type-grid-inline)", "row-gap: var(--gap-type-grid-block)"],
    });
  });

  it("has no physical property, margin, order, row-reverse or [dir] selector, and every gap is a var(--gap-…)", () => {
    const source = readSource("src/ui/layout/inline.css");

    expect(physicalDeclarations(css)).toEqual([]);
    expect(literalLengths(css)).toEqual([]);
    expect(css.filter((d) => d.prop.startsWith("margin") || d.prop === "order")).toEqual([]);
    expect(source).not.toMatch(/row-reverse|\[dir/);
    for (const { prop, value } of css.filter((d) => /gap$/.test(d.prop))) expect(value, prop).toMatch(/^var\(--gap-[\w-]+\)$/);
  });
});
