import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { layoutDeclarations, literalLengths, physicalDeclarations, readSource } from "../../../test/helpers/layout-css";
import { STACK_GAPS, Stack } from "./stack";

const css = layoutDeclarations("src/ui/layout/stack.css");

describe("Stack", () => {
  it("renders a flex column with the default stack gap", () => {
    expect(renderToStaticMarkup(<Stack testId="s">a</Stack>)).toBe(
      '<div class="layout-stack" data-gap="stack" data-align="stretch" data-testid="s">a</div>',
    );
  });

  it("exposes ul and ol as lists, because list-style: none drops list semantics in Safari", () => {
    expect(renderToStaticMarkup(<Stack as="ul" gap="label"><li>a</li></Stack>)).toBe(
      '<ul class="layout-stack" data-gap="label" data-align="stretch" role="list"><li>a</li></ul>',
    );
    expect(renderToStaticMarkup(<Stack as="ol" />)).toContain('role="list"');
    expect(renderToStaticMarkup(<Stack as="section" />)).not.toContain("role=");
  });

  it("renders a fieldset for a field group", () => {
    expect(renderToStaticMarkup(<Stack as="fieldset" align="start"><legend>Building</legend></Stack>)).toBe(
      '<fieldset class="layout-stack" data-gap="stack" data-align="start"><legend>Building</legend></fieldset>',
    );
  });

  it("maps every gap value to exactly one var(--gap-…) declaration", () => {
    const classMap = Object.fromEntries(
      STACK_GAPS.map((gap) => [
        gap,
        css.filter((d) => d.selector === `.layout-stack[data-gap="${gap}"]`).map((d) => `${d.prop}: ${d.value}`),
      ]),
    );

    expect(classMap).toEqual(Object.fromEntries(STACK_GAPS.map((gap) => [gap, [`gap: var(--gap-${gap})`]])));
  });

  it("has no margin, physical property, literal length or [dir] selector, and every gap is a var(--gap-…)", () => {
    expect(css.filter((d) => d.prop.startsWith("margin"))).toEqual([]);
    expect(physicalDeclarations(css)).toEqual([]);
    expect(literalLengths(css)).toEqual([]);
    for (const { prop, value } of css.filter((d) => /gap$/.test(d.prop))) expect(value, prop).toMatch(/^var\(--gap-[\w-]+\)$/);
    expect(readSource("src/ui/layout/stack.css")).not.toMatch(/\[dir|column-reverse/);
  });
});
