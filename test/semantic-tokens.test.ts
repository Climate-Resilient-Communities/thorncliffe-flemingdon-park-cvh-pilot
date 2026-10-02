import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(__dirname, "..", file), "utf8");

function declarations(file: string) {
  const found = new Map<string, string>();
  postcss.parse(read(file)).walkDecls(/^--/, (decl) => void found.set(decl.prop, decl.value));
  return found;
}

// token-architecture.md sections 3.1 and 3.2: semantic token, the primitive it resolves to, its value.
const SEMANTIC_TOKENS: [string, string, string][] = [
  ["--gap-subline", "--app-space-1", "2px"],
  ["--gap-label", "--app-space-2", "4px"],
  ["--gap-tight", "--app-space-3", "6px"],
  ["--gap-related", "--app-space-4", "8px"],
  ["--gap-target", "--app-space-4", "8px"],
  ["--gap-icon", "--app-space-5", "10px"],
  ["--gap-grid", "--app-space-5", "10px"],
  ["--gap-stack", "--app-space-6", "12px"],
  ["--gap-section-resident", "--app-space-8", "16px"],
  ["--gap-section-hub", "--app-space-9", "20px"],
  ["--gap-panel", "--app-space-10", "24px"],
  ["--gap-paragraph", "--app-space-10", "24px"],
  ["--gap-columns-hub", "--app-space-28px", "28px"],
  ["--gap-section-hub-main", "--app-space-22px", "22px"],
  ["--gap-section-hub-review", "--app-space-18px", "18px"],
  ["--gap-meta-inline", "--app-space-18px", "18px"],
  ["--gap-type-grid-inline", "--app-space-18px", "18px"],
  ["--gap-meta-block", "--app-space-2", "4px"],
  ["--gap-type-grid-block", "--app-space-7", "14px"],
  ["--gap-columns-inner", "--app-space-5", "10px"],
  ["--gutter-resident", "--app-space-8", "16px"],
  ["--inset-screen-end", "--app-space-10", "24px"],
  ["--inset-page-staff", "--app-space-10", "24px"],
  ["--inset-page-staff-narrow", "--app-space-8", "16px"],
  ["--inset-card", "--app-space-8", "16px"],
  ["--inset-card-compact", "--app-space-6", "12px"],
  ["--inset-card-snug", "--app-space-7", "14px"],
  ["--inset-button-large-inline", "--app-space-18px", "18px"],
  ["--inset-count-badge-inline", "--app-space-7px", "7px"],
  ["--offset-align-hairline", "--app-space-1px", "1px"],
  ["--offset-align-icon", "--app-space-3px", "3px"],
  ["--tap", "--app-tap", "44px"],
  ["--tap-basic", "--app-tap-basic", "56px"],
  ["--size-icon", "--app-icon", "24px"],
  ["--size-icon-basic", "--app-icon-basic", "28px"],
  ["--size-icon-staff", "--app-icon-staff", "20px"],
  ["--size-header-resident-min", "--app-min-header-resident", "56px"],
  ["--size-topbar-hub-min", "--app-min-topbar-hub", "60px"],
  ["--size-nav-item-resident-min", "--app-min-nav-item-resident", "64px"],
  ["--size-nav-item-resident-min-basic", "--app-min-nav-item-resident-basic", "80px"],
  ["--size-page-staff", "--app-page-staff", "1040px"],
  ["--size-page-staff-review", "--app-page-staff-review", "1080px"],
  ["--size-page-staff-partner", "--app-page-staff-partner", "1140px"],
  ["--size-page-staff-published", "--app-page-staff-published", "960px"],
  ["--size-page-staff-log", "--app-page-staff-log", "920px"],
  ["--size-page-staff-update", "--app-page-staff-update", "980px"],
  ["--size-page-staff-resolve", "--app-page-staff-resolve", "900px"],
  ["--size-side-nav", "--app-side-nav", "240px"],
  ["--size-aside-staff", "--app-aside-staff", "380px"],
  ["--size-aside-staff-compact", "--app-aside-staff-compact", "300px"],
];

describe("semantic.css", () => {
  const semantic = declarations("src/ui/tokens/semantic.css");
  const primitives = declarations("src/ui/tokens/tokens.generated.css");

  it("declares exactly the semantic tokens of token-architecture.md sections 3.1 and 3.2", () => {
    expect([...semantic.keys()].sort()).toEqual(SEMANTIC_TOKENS.map(([name]) => name).sort());
  });

  it.each(SEMANTIC_TOKENS)("%s is var(%s), %s", (name, primitive, value) => {
    expect(semantic.get(name)).toBe(`var(${primitive})`);
    expect(primitives.get(primitive)).toBe(value);
  });

  it("resolves --tap, --tap-basic and --gap-target to 44px, 56px and 8px (G3)", () => {
    const resolve = (name: string) => primitives.get(/^var\((--[\w-]+)\)$/.exec(semantic.get(name)!)![1]);

    expect([resolve("--tap"), resolve("--tap-basic"), resolve("--gap-target")]).toEqual(["44px", "56px", "8px"]);
  });
});
