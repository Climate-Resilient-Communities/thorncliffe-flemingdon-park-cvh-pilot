import { describe, expect, it } from "vitest";
import { layoutDeclarations } from "../../../test/helpers/layout-css";

describe("tap rule", () => {
  it("is --tap, or --tap-basic in basic mode", () => {
    expect(layoutDeclarations("src/ui/layout/tap.css").map((d) => `${d.selector} { ${d.prop}: ${d.value} }`)).toEqual([
      ":root { --tap-current: var(--tap) }",
      ':root[data-basic="true"] { --tap-current: var(--tap-basic) }',
    ]);
  });

  it("sets a minimum block and inline size only, on logical properties", () => {
    expect(layoutDeclarations("src/ui/tokens/theme.css").filter((d) => d.at.includes("@utility tap")).map((d) => `${d.prop}: ${d.value}`)).toEqual([
      "min-block-size: var(--tap-current)",
      "min-inline-size: var(--tap-current)",
    ]);
  });
});
