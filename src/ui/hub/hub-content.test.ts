import { describe, expect, it } from "vitest";
import { layoutDeclarations } from "../../../test/helpers/layout-css";

const css = layoutDeclarations("src/ui/hub/hub-content.css");
const value = (selector: string, prop: string) => css.find((d) => d.selector === selector && d.prop === prop && !d.at.length)?.value;

describe("hub-content.css", () => {
  it("makes a link that is also a touch target as wide as its text and centred in its height, so no gap opens under it in a column", () => {
    expect(value(".hub-link.tap", "display")).toBe("inline-flex");
    expect(value(".hub-link.tap", "align-items")).toBe("center");
    expect(value(".hub-link.tap", "align-self")).toBe("flex-start");
  });

  it("keeps the line breaks of a person's note and of a frozen text message, and lets a language's line wrap inside its column (S04.07)", () => {
    expect(value(".hub-preline", "white-space")).toBe("pre-line");
    expect(value(".hub-summary", "overflow-wrap")).toBe("anywhere");
    expect(value(".hub-summary", "cursor")).toBe("pointer");
  });
});
