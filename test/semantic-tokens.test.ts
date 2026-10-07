import { readFileSync } from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.join(__dirname, "..", file), "utf8");

// `only` limits it to the rules with that selector (the generated type and line-height primitives are
// redeclared per surface, basic mode and language; the :root values are the resident ones).
function declarations(file: string, only?: string) {
  const found = new Map<string, string>();
  postcss.parse(read(file)).walkDecls(/^--/, (decl) => {
    if (!only || (decl.parent as postcss.Rule).selector === only) found.set(decl.prop, decl.value);
  });
  return found;
}

// token-architecture.md sections 3.1, 3.2 and 3.4: semantic token, the primitive it resolves to, its value.
const SEMANTIC_TOKENS: [string, string, string][] = [
  ["--size-page-resident", "--app-page-resident", "1120px"],
  ["--size-page-reading", "--app-page-reading", "760px"],
  ["--size-side-directory", "--app-side-directory", "260px"],
  ["--size-language-sheet", "--app-language-sheet", "640px"],
  ["--size-filter-viewport-offset", "--app-filter-viewport-offset", "220px"],
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
  ["--size-logo-hub", "--app-logo-hub", "36px"],
  ["--size-symbol-hub", "--app-symbol-hub", "28px"],
  ["--size-header-resident-min", "--app-min-header-resident", "56px"],
  ["--size-topbar-hub-min", "--app-min-topbar-hub", "60px"],
  ["--size-actions-max", "--app-max-actions", "50dvh"],
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
  ["--type-caption-size", "--app-fs-caption", "18px"],
  ["--type-body-size", "--app-fs-body", "18px"],
  ["--type-alert-size", "--app-fs-alert", "20px"],
  ["--type-lead-size", "--app-fs-lead", "21px"],
  ["--type-h3-size", "--app-fs-h3", "20px"],
  ["--type-h2-size", "--app-fs-h2", "23px"],
  ["--type-h1-size", "--app-fs-h1", "27px"],
  ["--type-family-sans", "--app-font-sans", '"Public Sans", Calibri, Carlito, Arial, sans-serif'],
  ["--type-body-line-height", "--app-lh-body", "var(--lh-body)"],
  ["--type-tight-line-height", "--app-lh-h2", "var(--lh-tight)"],
];

describe("semantic.css", () => {
  const semantic = declarations("src/ui/tokens/semantic.css");
  const primitives = declarations("src/ui/tokens/tokens.generated.css", ":root");

  it("declares exactly the semantic tokens of token-architecture.md sections 3.1, 3.2 and 3.4", () => {
    expect([...semantic.keys()].sort()).toEqual(SEMANTIC_TOKENS.map(([name]) => name).sort());
  });

  it.each(SEMANTIC_TOKENS)("%s is var(%s), %s", (name, primitive, value) => {
    expect(semantic.get(name)).toBe(`var(${primitive})`);
    expect(primitives.get(primitive)).toBe(value);
  });

  it("documents the type tokens as the 3.4 Type table", () => {
    const doc = read("docs/design-framework/spacing-container/token-architecture.md");
    const section = doc.slice(doc.indexOf("### 3.4 Type"), doc.indexOf("## 4. Layer 3"));

    expect(section).toMatch(/^### 3\.4 Type/);
    for (const [name, primitive] of SEMANTIC_TOKENS.filter(([token]) => token.startsWith("--type-"))) {
      expect(section, name).toContain(`| \`${name}\` | \`var(${primitive})\` |`);
    }
  });

  it("resolves --tap, --tap-basic and --gap-target to 44px, 56px and 8px (G3)", () => {
    const resolve = (name: string) => primitives.get(/^var\((--[\w-]+)\)$/.exec(semantic.get(name)!)![1]);

    expect([resolve("--tap"), resolve("--tap-basic"), resolve("--gap-target")]).toEqual(["44px", "56px", "8px"]);
  });
});
