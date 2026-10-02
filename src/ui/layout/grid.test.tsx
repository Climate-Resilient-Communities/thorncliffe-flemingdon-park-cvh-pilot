import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { layoutDeclarations, layoutLiterals, literalLengths, physicalDeclarations, readSource } from "../../../test/helpers/layout-css";
import { GRID_GAPS, GRID_TWO_COLUMNS, Grid } from "./grid";

const css = layoutDeclarations("src/ui/layout/grid.css");
const TWO_COLUMN_QUERY = "@variant @hub-two-column/hub-page";

describe("Grid", () => {
  it("renders equal columns with the grid gap, collapsing in basic mode by default", () => {
    expect(renderToStaticMarkup(<Grid cols={2}>a</Grid>)).toBe(
      '<div class="layout-grid" data-cols="2" data-gap="grid" data-collapse-in-basic="true">a</div>',
    );
    expect(renderToStaticMarkup(<Grid cols={3} gap="target" collapseInBasic={false} as="ul" testId="marks" />)).toBe(
      '<ul class="layout-grid" data-cols="3" data-gap="target" data-collapse-in-basic="false" role="list" data-testid="marks"></ul>',
    );
  });

  it("renders a two-column grid with its variant only: no cols, gap or basic-mode collapse", () => {
    expect(
      renderToStaticMarkup(
        <Grid twoColumn="aside-compact">
          <main />
          <aside />
        </Grid>,
      ),
    ).toBe('<div class="layout-grid" data-two-column="aside-compact"><main></main><aside></aside></div>');
  });

  it("maps every equal-column gap to its token", () => {
    const gap = (value: string) => css.find((d) => d.selector === `.layout-grid[data-gap="${value}"]`)?.value ?? css.find((d) => d.selector === ".layout-grid" && d.prop === "gap")?.value;

    expect(Object.fromEntries(GRID_GAPS.map((value) => [value, gap(value)]))).toEqual({
      target: "var(--gap-target)",
      grid: "var(--gap-grid)",
      stack: "var(--gap-stack)",
      panel: "var(--gap-panel)",
    });
  });

  it("stacks every two-column variant with --gap-section-hub and switches it only on the hub-page container", () => {
    const stacked = css.filter((d) => d.selector === ".layout-grid[data-two-column]");
    const switched = Object.fromEntries(
      GRID_TWO_COLUMNS.map((variant) => [
        variant,
        css
          .filter((d) => d.selector.startsWith(`.layout-grid[data-two-column="${variant}"]`))
          .map((d) => `${d.at.join(" ")} ${d.selector.replace(`.layout-grid[data-two-column="${variant}"]`, "").trim()} ${d.prop}: ${d.value}`.replace(/\s+/g, " ").trim()),
      ]),
    );

    expect(stacked.map((d) => `${d.prop}: ${d.value}`)).toEqual(["align-items: start", "gap: var(--gap-section-hub)"]);
    expect(switched).toEqual({
      aside: [
        `${TWO_COLUMN_QUERY} grid-template-columns: minmax(0, 1fr) var(--size-aside-staff)`,
        `${TWO_COLUMN_QUERY} gap: var(--gap-columns-hub)`,
        `${TWO_COLUMN_QUERY} & > :nth-child(2) position: sticky`,
        `${TWO_COLUMN_QUERY} & > :nth-child(2) inset-block-start: 0`,
      ],
      "aside-compact": [
        `${TWO_COLUMN_QUERY} grid-template-columns: minmax(0, 1fr) var(--size-aside-staff-compact)`,
        `${TWO_COLUMN_QUERY} gap: var(--gap-panel)`,
      ],
      even: [`${TWO_COLUMN_QUERY} grid-template-columns: repeat(2, minmax(0, 1fr))`, `${TWO_COLUMN_QUERY} gap: var(--gap-panel)`],
      "even-inner": [
        `${TWO_COLUMN_QUERY} grid-template-columns: repeat(2, minmax(0, 1fr))`,
        `${TWO_COLUMN_QUERY} gap: var(--gap-columns-inner)`,
      ],
    });
  });

  it("lets every cell shrink and break an unbreakable word, so text wraps inside its column", () => {
    expect(css.filter((d) => d.selector === ".layout-grid > *").map((d) => `${d.prop}: ${d.value}`)).toEqual([
      "min-inline-size: 0",
      "overflow-wrap: break-word",
    ]);
  });

  it("collapses equal-column grids to one column only under :root[data-basic=\"true\"]", () => {
    expect(css.filter((d) => d.selector.includes("data-basic"))).toEqual([
      {
        selector: ':root[data-basic="true"] .layout-grid[data-collapse-in-basic="true"]',
        at: [],
        prop: "grid-template-columns",
        value: "minmax(0, 1fr)",
      },
    ]);
  });

  it("has no literal length other than 0, no @media, no breakpoint or container literal, no physical property, and gaps and sizes are var()s of semantic tokens", () => {
    const source = readSource("src/ui/layout/grid.css");

    expect(literalLengths(css)).toEqual([]);
    expect(physicalDeclarations(css)).toEqual([]);
    expect(source).not.toMatch(/@media|\[dir/);
    expect(source).not.toMatch(layoutLiterals());
    for (const { prop, value } of css.filter((d) => /gap$|grid-template-columns/.test(d.prop))) {
      for (const reference of value.match(/var\([^)]*\)/g) ?? []) expect(reference, `${prop}: ${value}`).toMatch(/^var\(--(gap|size)-[\w-]+\)$/);
    }
  });
});
