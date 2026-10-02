import path from "node:path";
import postcss, { type AtRule, type Rule } from "postcss";
import { beforeAll, describe, expect, it } from "vitest";
import { compileCss } from "./helpers/compile-css";

const FIXTURE = path.join(__dirname, "fixtures", "tailwind-theme", "input.css");

let css: string;
let rules: Map<string, { declarations: string; at: string[] }>;

// A utility's declarations and the at-rules around it, keyed by its unescaped class name.
function utilities(output: string) {
  const found = new Map<string, { declarations: string; at: string[] }>();
  postcss.parse(output).walkRules((rule: Rule) => {
    const at: string[] = [];
    for (let parent = rule.parent; parent && parent.type !== "root"; parent = parent.parent) {
      if (parent.type === "atrule" && (parent as AtRule).name !== "layer") at.push(`@${(parent as AtRule).name} ${(parent as AtRule).params}`);
    }
    const declarations: string[] = [];
    rule.each((node) => void (node.type === "decl" && declarations.push(`${node.prop}: ${node.value}`)));
    found.set(rule.selector.replace(/\\/g, "").replace(/^\./, ""), { declarations: declarations.join("; "), at });
  });
  return found;
}

beforeAll(async () => {
  css = await compileCss(FIXTURE);
  rules = utilities(css);
});

describe("Tailwind 4.3.3 with the CVH theme", () => {
  it.each(["p-4", "gap-2", "md:flex", "@md:flex", "lg:grid", "@lg:grid", "max-w-md", "m-1", "space-y-2", "container"])(
    "produces no CSS for the default scale, breakpoints and containers: %s",
    (utility) => {
      expect(rules.has(utility)).toBe(false);
      expect(rules.has(`${utility} > :not(:last-child)`)).toBe(false);
    },
  );

  it("generates no utility for the layout primitives' class names", () => {
    for (const name of ["layout-screen", "layout-stack", "layout-inline", "layout-grid"]) expect(rules.has(name), name).toBe(false);
  });

  it("does not expose primitives as utilities", () => {
    expect(rules.has("p-app-space-2")).toBe(false);
    expect(rules.has("gap-app-space-5")).toBe(false);
  });

  it.each([
    ["gap-icon", "gap: var(--gap-icon)"],
    ["ps-gutter", "padding-inline-start: var(--gutter-resident)"],
    ["pe-gutter", "padding-inline-end: var(--gutter-resident)"],
    ["px-card", "padding-inline: var(--inset-card)"],
    ["py-card", "padding-block: var(--inset-card)"],
    ["mx-card", "margin-inline: var(--inset-card)"],
    ["my-related", "margin-block: var(--gap-related)"],
    ["ms-label", "margin-inline-start: var(--gap-label)"],
    ["me-label", "margin-inline-end: var(--gap-label)"],
  ])("compiles %s to a var() of a semantic token, on a logical property", (utility, declaration) => {
    expect(rules.get(utility)?.declarations).toBe(declaration);
  });

  it("compiles hub: to @media (width >= 700px), the viewport", () => {
    expect(rules.get("hub:flex")).toEqual({ declarations: "display: flex", at: ["@media (width >= 700px)"] });
  });

  it("compiles @hub-two-column: to @container (width >= 800px)", () => {
    expect(rules.get("@hub-two-column:grid")).toEqual({ declarations: "display: grid", at: ["@container (width >= 800px)"] });
  });

  it("compiles radius utilities to the generated tokens without a circular --radius-card", () => {
    expect(rules.get("rounded-card")?.declarations).toBe("border-radius: var(--radius-card)");
    expect(rules.get("rounded-disc")?.declarations).toBe("border-radius: var(--radius-disc)");
    expect(css).not.toMatch(/--radius-card:\s*var\(--radius-card\)/);
    expect(css).toMatch(/--radius-card:\s*16px/);
  });

  it("compiles colour utilities to the themed variables", () => {
    expect(rules.get("bg-surface")?.declarations).toBe("background-color: var(--surface)");
    expect(rules.get("text-ink")?.declarations).toBe("color: var(--ink)");
  });

  it("compiles the tap rule to the current minimum target size", () => {
    expect(rules.get("tap")?.declarations).toBe("min-block-size: var(--tap-current); min-inline-size: var(--tap-current)");
  });

  it("still compiles arbitrary values, which is why the spacing check rejects them", () => {
    expect(rules.get("p-[13px]")?.declarations).toBe("padding: 13px");
  });

  it("emits 700px and 800px only in the two variants' queries", () => {
    const literals = [...css.matchAll(/.*(700|800)px.*/g)].map((match) => match[0].trim());

    expect(literals).toEqual(["@media (width >= 700px) {", "@container (width >= 800px) {"]);
  });
});
