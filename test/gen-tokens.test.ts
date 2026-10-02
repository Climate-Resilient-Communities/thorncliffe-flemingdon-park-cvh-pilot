import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import { afterEach, describe, expect, it } from "vitest";
import {
  PRIMITIVES_FILE,
  SEMANTIC_FILE,
  THEME_FILE,
  TOKENS_FILE,
  generate,
  langSelectors,
  readInputs,
} from "../scripts/gen-tokens.mjs";

const ROOT = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");
const tokens = JSON.parse(read(TOKENS_FILE));
const inputs = () => ({ ...readInputs(ROOT), tokens: structuredClone(tokens) });

/** Declarations of each rule in a stylesheet, by selector. */
function rules(css: string) {
  const found = new Map<string, Map<string, string>>();
  postcss.parse(css).walkRules((rule) => {
    const declarations = found.get(rule.selector) ?? new Map<string, string>();
    rule.walkDecls((decl) => void declarations.set(decl.prop, decl.value));
    found.set(rule.selector, declarations);
  });
  return found;
}

const primitives = rules(read(PRIMITIVES_FILE));
const root = primitives.get(":root")!;
const theme = read(THEME_FILE);

type Token = { name: string; value: string | number | Record<string, string> };

describe("gen:tokens output", () => {
  it("is what the generator gives for tokens.json (the generated files are not stale)", () => {
    const files = generate(inputs());

    expect(read(PRIMITIVES_FILE)).toBe(files[PRIMITIVES_FILE]);
    expect(read(THEME_FILE)).toBe(files[THEME_FILE]);
    expect(read(PRIMITIVES_FILE)).toMatch(/^\/\* GENERATED .* Do not edit/);
    expect(theme).toMatch(/^\/\* GENERATED .* Do not edit/);
  });

  it("writes every spacing.app, size and radius value once, on :root", () => {
    const expected: Token[] = [...tokens.spacing.app, ...tokens.size.tokens, ...tokens.radius.tokens];

    for (const { name, value } of expected) expect(root.get(`--${name}`), name).toBe(value);
    for (const [selector, declarations] of primitives) {
      if (selector === ":root") continue;
      for (const { name } of expected) expect(declarations.has(`--${name}`), `${name} in ${selector}`).toBe(false);
    }
  });

  it("writes the light colours on :root and the navy ones under [data-theme=\"dark\"]", () => {
    const dark = primitives.get('[data-theme="dark"]')!;
    const resolve = (value: string, scope: Map<string, string>): string => {
      const reference = /^var\(--([\w-]+)\)$/.exec(value);
      return reference ? resolve(scope.get(`--${reference[1]}`) ?? root.get(`--${reference[1]}`)!, scope) : value;
    };
    const literal = (value: string) => value.replace(/^\{([\w-]+)\}$/, (_match, name) => tokens.color.tokens.find((t: Token) => t.name === name).value);

    for (const { name, value } of tokens.color.tokens as Token[]) {
      const light = typeof value === "string" ? value : (value as Record<string, string>).light;
      expect(resolve(root.get(`--${name}`)!, root), name).toBe(literal(light));
      if (typeof value === "string") {
        expect(dark.has(`--${name}`), `${name} is the same in both themes`).toBe(false);
      } else {
        expect(resolve(dark.get(`--${name}`)!, dark), `${name} (dark)`).toBe(literal((value as Record<string, string>).dark));
      }
    }
  });

  it("writes the resident type set on :root, basic mode under [data-basic=\"true\"] and staff on the staff surface", () => {
    const groups = Object.fromEntries(tokens.type.groups.map((group: { name: string }) => [group.name, group]));
    const sets = [
      [":root", groups["Screens: resident"], "screen-"],
      ['[data-basic="true"]', groups["Screens: basic mode"], "screen-basic-"],
      ['[data-surface="staff"]', groups["Screens: staff"], "screen-staff-"],
    ] as const;

    for (const [selector, group, prefix] of sets) {
      const declarations = primitives.get(selector)!;
      for (const style of group.styles) {
        const role = style.name.slice(prefix.length);
        expect(declarations.get(`--app-fs-${role}`), style.name).toBe(style.fontSize);
        expect(declarations.get(`--app-lh-${role}`), style.name).toBe(`var(--${style.lineHeight})`);
      }
    }
  });

  it("writes the line heights on :root and per language with :lang(), covering the app codes and their BCP-47 tags", () => {
    for (const token of tokens.type.lineHeights) {
      if (!token.languages) {
        expect(root.get(`--${token.name}`), token.name).toBe(String(token.value));
        continue;
      }
      const base = token.name.replace(/-(arabic|indic|chinese)$/, "");
      const selector = [...primitives.keys()].find((candidate) => !candidate.includes("data-surface") && primitives.get(candidate)!.get(`--${base}`) === String(token.value) && candidate.startsWith(":lang("));
      expect(selector, token.name).toBeDefined();
      for (const language of token.languages as string[]) {
        expect(selector!.split(", "), `${token.name}: ${language}`).toContain(`:lang(${language.split("-")[0]})`);
      }
    }
    expect(primitives.has(":lang(zh)")).toBe(true);
    expect(primitives.get(":lang(zh)")?.has("--lh-tight")).toBe(false);
    expect(primitives.has(":lang(zh-Hans), :lang(zh-Hant)")).toBe(false);
    expect(langSelectors(["ur", "ps", "prs"])).toEqual([":lang(ur)", ":lang(ps)", ":lang(prs)", ":lang(fa)"]);
    expect(langSelectors(["zh-Hans", "zh-Hant"])).toEqual([":lang(zh)"]);
    expect(langSelectors(["hi", "pa"])).toEqual([":lang(hi)", ":lang(pa)"]);
  });

  it("repeats the --app-lh-* mappings inside each :lang() block, and for the staff surface in compound selectors", () => {
    const arabic = primitives.get(":lang(ur), :lang(ps), :lang(prs), :lang(fa)")!;
    const arabicStaff = primitives.get(
      ["ur", "ps", "prs", "fa"].flatMap((tag) => [`[data-surface="staff"]:lang(${tag})`, `[data-surface="staff"] :lang(${tag})`]).join(", "),
    )!;

    for (const role of ["caption", "body", "alert", "lead", "h3", "h2", "h1"]) {
      expect(arabic.get(`--app-lh-${role}`), role).toBe(root.get(`--app-lh-${role}`));
      expect(arabicStaff.get(`--app-lh-${role}`), role).toBe(primitives.get('[data-surface="staff"]')!.get(`--app-lh-${role}`));
    }
    // Arabic script replaces the staff body line height (owner decision, 2026-10-02); Indic and Chinese do not.
    expect(arabic.get("--lh-body-staff")).toBe("1.9");
    expect(primitives.get(":lang(hi), :lang(pa), :lang(gu), :lang(bn), :lang(ta)")!.has("--lh-body-staff")).toBe(false);
    expect(primitives.get(":lang(zh)")!.has("--lh-body-staff")).toBe(false);
  });

  it("records in tokens.json that Arabic script applies on resident and staff screens and overrides lh-body-staff", () => {
    const usage = (name: string): string => tokens.type.lineHeights.find((token: Token & { usage: string }) => token.name === name).usage;

    expect(tokens.version).toBe(3);
    expect(usage("lh-body-arabic")).toMatch(/resident and staff screens/);
    expect(usage("lh-body-arabic")).toMatch(/overrides lh-body-staff/);
    expect(usage("lh-tight-arabic")).toMatch(/resident and staff screens/);
    expect(usage("lh-body-staff")).toMatch(/Arabic-script text .*overrides it/);
    expect(usage("lh-body-staff")).toMatch(/Indic and Chinese text keep it/);
    expect(tokens.type.lineHeights.find((token: Token) => token.name === "lh-body-staff").value).toBe(1.45);
  });

  it("does not generate the slides and documents spacing or type groups", () => {
    const css = read(PRIMITIVES_FILE);

    for (const { name } of tokens.spacing.tokens) expect(css).not.toMatch(new RegExp(`--${name}:`));
    for (const group of tokens.type.groups.filter((g: { name: string }) => !g.name.startsWith("Screens: "))) {
      for (const style of group.styles) {
        // "numeral" and "eyebrow" are also colour tokens.
        if (tokens.color.tokens.some((token: Token) => token.name === style.name)) continue;
        expect(css).not.toContain(`--${style.name}:`);
      }
    }
    for (const slideOnly of ["85px", "48px", "47px", "37px", "17px", "29px", "67px"]) expect(css).not.toContain(slideOnly);
  });

  it("writes app-breakpoint-hub and app-container-hub-two-column-min as literals only into @theme", () => {
    const value = (group: "breakpoint" | "container", name: string) =>
      tokens[group].tokens.find((token: Token) => token.name === name).value;

    expect(theme).toContain(`--breakpoint-hub: ${value("breakpoint", "app-breakpoint-hub")};`);
    expect(theme).toContain(`--container-hub-two-column: ${value("container", "app-container-hub-two-column-min")};`);
    expect(read(PRIMITIVES_FILE)).not.toMatch(/700px|800px/);
  });

  it("resets Tailwind's type scale and palette, and maps text-{role} to the semantic type tokens only", () => {
    const text = [...theme.matchAll(/--text-([\w-]+): (.+);/g)].map(([, name, value]) => [name, value]);

    expect(theme).toContain("--text-*: initial;");
    expect(theme.indexOf("--color-*: initial;")).toBeGreaterThan(-1);
    expect(theme.indexOf("--color-*: initial;")).toBeLessThan(theme.indexOf("--color-surface:"));
    expect(text.map(([name]) => name)).toEqual(
      ["caption", "body", "alert", "lead", "h3", "h2", "h1"].flatMap((role) => [role, `${role}--line-height`]),
    );
    for (const [name, value] of text) {
      expect(value).toMatch(name.endsWith("--line-height") ? /^var\(--type-(body|tight)-line-height\)$/ : /^var\(--type-[\w-]+-size\)$/);
    }
    expect(text).toContainEqual(["h2--line-height", "var(--type-tight-line-height)"]);
  });

  it("maps Tailwind spacing to semantic tokens only and removes the default scale", () => {
    const spacing = [...theme.matchAll(/--spacing-([\w-]+): (.+);/g)].map(([, name, value]) => [name, value]);

    expect(theme).toContain("--spacing-*: initial;");
    expect(theme).toContain("--breakpoint-*: initial;");
    expect(theme).toContain("--container-*: initial;");
    expect(spacing.length).toBeGreaterThan(30);
    for (const [, value] of spacing) expect(value).toMatch(/^var\(--(gap|inset|gutter|offset)-[\w-]+\)$|^var\(--tap(-basic)?\)$/);
    expect(spacing).toContainEqual(["icon", "var(--gap-icon)"]);
    expect(spacing).toContainEqual(["gutter", "var(--gutter-resident)"]);
    expect(theme).not.toContain("var(--app-");
  });
});

describe("gen:tokens without a token it needs", () => {
  const withoutToken = (group: string[], name: string) => {
    const changed = inputs();
    const holder = group.reduce((node, key) => node[key], changed.tokens);
    holder.splice(holder.findIndex((token: Token) => token.name === name), 1);
    return changed;
  };

  it("fails and names G3 when app-tap or app-tap-basic is missing", () => {
    expect(() => generate(withoutToken(["size", "tokens"], "app-tap"))).toThrow(/"app-tap" \(decision G3\)/);
    expect(() => generate(withoutToken(["size", "tokens"], "app-tap-basic"))).toThrow(/"app-tap-basic" \(decision G3\)/);
  });

  it("fails and names the token when semantic.css references a primitive tokens.json lacks", () => {
    expect(() => generate(withoutToken(["spacing", "app"], "app-space-28px"))).toThrow(
      `tokens.json does not define "app-space-28px" (decision G1), needed by ${SEMANTIC_FILE}`,
    );
  });

  it("fails and names the token when a layout primitive references a primitive tokens.json lacks", () => {
    const changed = inputs();
    changed.layoutSources.push({ file: "src/ui/layout/example.css", css: ".example { gap: var(--app-space-99); }" });

    expect(() => generate(changed)).toThrow('"app-space-99" (decision G1), needed by src/ui/layout/example.css');
  });

  it("fails and names the build-time tokens when they are missing", () => {
    expect(() => generate(withoutToken(["breakpoint", "tokens"], "app-breakpoint-hub"))).toThrow(/"app-breakpoint-hub" \(decision G4\)/);
    expect(() => generate(withoutToken(["container", "tokens"], "app-container-hub-two-column-min"))).toThrow(
      /"app-container-hub-two-column-min" \(decision G4\)/,
    );
  });

  it("fails when a group gives roles of one kind different line heights, or semantic.css lacks a type token", () => {
    const changed = inputs();
    const staff = changed.tokens.type.groups.find((group: { name: string }) => group.name === "Screens: staff");
    staff.styles.find((style: { name: string }) => style.name === "screen-staff-h1").lineHeight = "lh-body";
    expect(() => generate(changed)).toThrow(/h1 lh-body but h3 lh-tight; the tight line height must be one token/);

    const noType = inputs();
    noType.semanticCss = noType.semanticCss.replace("--type-h1-size", "--type-h1-sizes");
    expect(() => generate(noType)).toThrow(/does not define --type-h1-size/);
  });

  it("fails on a type style whose line height tokens.json lacks", () => {
    expect(() => generate(withoutToken(["type", "lineHeights"], "lh-body-staff"))).toThrow(/"lh-body-staff" \(decision G10\)/);
  });
});

describe("npm run gen:tokens", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function copyRepo(change?: (json: Record<string, unknown>) => void) {
    dir = mkdtempSync(path.join(tmpdir(), "gen-tokens-"));
    for (const file of [TOKENS_FILE, SEMANTIC_FILE, PRIMITIVES_FILE, THEME_FILE]) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      cpSync(path.join(ROOT, file), path.join(dir, file));
    }
    cpSync(path.join(ROOT, "src/ui/layout"), path.join(dir, "src/ui/layout"), { recursive: true });
    if (change) {
      const json = JSON.parse(read(TOKENS_FILE));
      change(json);
      writeFileSync(path.join(dir, TOKENS_FILE), JSON.stringify(json));
    }
  }
  const run = (...args: string[]) =>
    spawnSync("node", [path.join(ROOT, "scripts/gen-tokens.mjs"), ...args, "--root", dir], { encoding: "utf8" });

  it("passes --check when the generated files are current", () => {
    copyRepo();

    expect(run("--check").status).toBe(0);
  });

  it("fails --check, naming the file, when tokens.json changed and nobody regenerated", () => {
    copyRepo((json) => {
      (json.spacing as { app: Token[] }).app[0].value = "3px";
    });
    const result = run("--check");

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`Generated tokens are stale: ${PRIMITIVES_FILE}`);
  });

  it("exits non-zero, names the token and writes nothing when a token is missing", () => {
    copyRepo((json) => {
      const sizes = (json.size as { tokens: Token[] }).tokens;
      sizes.splice(sizes.findIndex((token) => token.name === "app-tap"), 1);
    });
    const before = readFileSync(path.join(dir, PRIMITIVES_FILE), "utf8");
    const result = run();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('tokens.json does not define "app-tap" (decision G3)');
    expect(result.stderr).toContain("writes no default value");
    expect(readFileSync(path.join(dir, PRIMITIVES_FILE), "utf8")).toBe(before);
  });
});
