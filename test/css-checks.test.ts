import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkLayers, checkLayout, checkLogical, checkSpacing, readSources, runCheck } from "../scripts/check-css.mjs";

const fixture = (name: string) => path.join(__dirname, "fixtures", name);
const findings = (list: { file: string; line: number; message: string }[], file: string) =>
  list.filter((finding) => finding.file === file).map(({ line, message }) => ({ line, message }));

describe("spacing check", () => {
  const { problems, exceptions } = checkSpacing(readSources(fixture("spacing-check")));

  it("accepts tokens, 0 and auto, and ignores borders, sizes, positioning and line height", () => {
    expect(findings(problems, "src/ui/allowed.css")).toEqual([]);
  });

  it("rejects literal lengths, unknown tokens and primitives in padding, margin and gaps", () => {
    expect(findings(problems, "src/ui/literal.css")).toEqual([
      { line: 2, message: expect.stringContaining('literal length 13px in "padding: 13px"') },
      { line: 3, message: expect.stringContaining('literal length 1rem in "gap: 1rem"') },
      { line: 4, message: expect.stringContaining('literal length 3px in "margin-block-start: 3px"') },
      { line: 5, message: expect.stringContaining("--gap-unknown") },
      { line: 6, message: expect.stringContaining("primitive --app-space-5") },
    ]);
  });

  it("rejects negative margins, literal or calculated", () => {
    expect(findings(problems, "src/ui/negative.css")).toEqual([
      { line: 2, message: 'negative margin "margin-block-end: -24px"' },
      { line: 3, message: 'negative margin "margin-inline: calc(var(--gap-icon) * -1)"' },
    ]);
  });

  it("rejects arbitrary spacing classes such as p-[13px], negative margin utilities and literal style spacing, naming file and class", () => {
    expect(findings(problems, "src/app/arbitrary.tsx")).toEqual([
      { line: 1, message: expect.stringContaining('arbitrary spacing class "p-[13px]"') },
      { line: 3, message: expect.stringContaining('arbitrary spacing class "gap-[1rem]"') },
      { line: 5, message: 'negative margin utility "-mt-icon"' },
      { line: 7, message: expect.stringContaining('arbitrary spacing class "[padding:3px]"') },
      { line: 9, message: 'literal length 13px in style "padding"' },
    ]);
  });

  it("accepts gap: normal, env(safe-area-inset-*) in max(), -0, component tokens over spacing tokens and --tap", () => {
    expect(findings(problems, "src/ui/hardening.css").filter(({ line }) => line < 10)).toEqual([]);
  });

  it("rejects literal var() fallbacks, calc(0 - …) negatives, size tokens and component tokens over non-spacing tokens", () => {
    expect(findings(problems, "src/ui/hardening.css")).toEqual([
      { line: 12, message: expect.stringContaining("literal fallback 13px in var(--gap-icon, 13px)") },
      { line: 13, message: 'negative margin "margin-inline-start: calc(0px - var(--gap-icon))"' },
      { line: 14, message: 'negative margin "margin-inline-end: calc(0 - var(--gap-icon))"' },
      { line: 15, message: expect.stringContaining("--size-icon in \"padding\" is not an approved spacing token") },
      { line: 17, message: expect.stringContaining("--bad-inset in \"padding-inline\" is not an approved spacing token") },
      { line: 18, message: expect.stringContaining("literal fallback 1rem in var(--tap, 1rem)") },
      { line: 19, message: expect.stringContaining("literal fallback 12px in env(safe-area-inset-left, 12px)") },
    ]);
  });

  it("checks quoted and kebab-case style keys and flags non-literal identifier values, not types", () => {
    expect(findings(problems, "src/app/style-keys.tsx")).toEqual([
      { line: 3, message: 'negative margin "margin-top: -4px"' },
      { line: 5, message: expect.stringContaining("literal length 13px in \"padding-left: 13px\"") },
      { line: 7, message: expect.stringContaining('"size" is not a literal in style "padding"; use a spacing token or a spacing-exception') },
      { line: 9, message: expect.stringContaining('"props.gap" is not a literal in style "rowGap"') },
    ]);
  });

  it("rejects the 1px utilities (p-px, gap-x-px, hub:ms-px, space-y-px), negative utilities with their own message, and (--app-*) shorthand", () => {
    expect(findings(problems, "src/app/utilities.tsx")).toEqual([
      { line: 1, message: expect.stringContaining('"p-px"') },
      { line: 1, message: expect.stringContaining('"gap-x-px"') },
      { line: 1, message: expect.stringContaining('"ms-px"') },
      { line: 1, message: expect.stringContaining('"space-y-px"') },
      { line: 1, message: expect.stringContaining('"mt-px"') },
      { line: 3, message: 'negative margin utility "-mt-px"' },
      { line: 3, message: 'negative margin utility "-mbs-2"' },
      { line: 3, message: 'negative margin utility "-mbs-2"' },
      { line: 3, message: 'negative margin utility "-mbe-3"' },
      { line: 5, message: expect.stringContaining('primitive --app-tap via "w-(--app-tap)"') },
      { line: 5, message: expect.stringContaining('primitive --app-lh-body via "hub:leading-(--app-lh-body)"') },
      { line: 5, message: expect.stringContaining('arbitrary spacing class "gap-(--gap-icon)"') },
    ]);
  });

  it("allows a line with a reviewed spacing-exception comment and lists it", () => {
    expect(problems.map((problem) => problem.file)).not.toContain("src/ui/exception.css");
    expect(exceptions).toEqual([
      expect.objectContaining({ file: "src/app/arbitrary.tsx", line: 11, reason: "optical alignment approved in review" }),
      expect.objectContaining({ file: "src/app/style-keys.tsx", line: 13, reason: "measured at runtime" }),
      expect.objectContaining({ file: "src/ui/exception.css", line: 2, reason: "centres the map pin's image on its point" }),
    ]);
  });

  it("skips unit test files", () => {
    expect(findings(problems, "src/ui/skipped.test.tsx")).toEqual([]);
    expect(readSources(fixture("spacing-check")).map((source) => source.file)).not.toContain("src/ui/skipped.test.tsx");
  });

  it("reports file, line and class, lists exceptions, and exits non-zero", () => {
    const { code, output } = runCheck("spacing", fixture("spacing-check"));

    expect(code).toBe(1);
    expect(output).toContain('src/app/arbitrary.tsx:1: arbitrary spacing class "p-[13px]"');
    expect(output).toContain("Reviewed spacing exceptions (3):");
  });
});

describe("layout literal check", () => {
  const { problems } = checkLayout(readSources(fixture("layout-check")));

  it("rejects 700px and 800px in media and container queries, in CSS, strings and arbitrary variants", () => {
    expect(problems.filter(({ file }) => !file.endsWith("variants.css") && !file.endsWith("units.tsx") && !file.endsWith("sizes.tsx"))).toEqual([
      { file: "src/app/(resident)/home/page.tsx", line: 5, message: expect.stringContaining("Grid twoColumn is for Hub pages only") },
      { file: "src/app/(resident)/home/page.tsx", line: 6, message: expect.stringContaining('"min-[700px]"') },
      { file: "src/app/(resident)/home/page.tsx", line: 7, message: expect.stringContaining('"@min-[800px]"') },
      { file: "src/app/staff/compose/page.tsx", line: 3, message: expect.stringContaining("@media (width >= 800px") },
      { file: "src/ui/literal.css", line: 5, message: expect.stringContaining("@media (width >= 700px)") },
      { file: "src/ui/literal.css", line: 11, message: expect.stringContaining("@container hub-page (min-width: 800px)") },
    ]);
  });

  it("catches @custom-variant and @apply queries, 700.0px, rem and em equivalents and any letter case in CSS", () => {
    expect(problems.filter(({ file }) => file.endsWith("variants.css")).map(({ line, message }) => ({ line, message }))).toEqual([
      { line: 1, message: expect.stringContaining("@media (min-width: 700px)") },
      { line: 4, message: expect.stringContaining("@media(min-width:700px)") },
      { line: 7, message: expect.stringContaining("700.0px") },
      { line: 13, message: expect.stringContaining("43.75rem") },
      { line: 19, message: expect.stringContaining("50em") },
      { line: 25, message: expect.stringContaining("800PX") },
    ]);
  });

  it("catches rem, em, decimal and upper-case literals in arbitrary variants and query strings, and leaves other widths alone", () => {
    expect(problems.filter(({ file }) => file.endsWith("units.tsx")).map(({ line, message }) => ({ line, message }))).toEqual([
      { line: 1, message: expect.stringContaining('"min-[43.75rem]"') },
      { line: 1, message: expect.stringContaining('"@min-[50em]"') },
      { line: 3, message: expect.stringContaining('"MIN-[700PX]"') },
      { line: 5, message: expect.stringContaining("700.0px") },
      { line: 7, message: expect.stringContaining("50rem") },
    ]);
  });

  it("rejects size utilities from the hub breakpoint and container tokens, which compile to a literal 700px or 800px", () => {
    expect(problems.filter(({ file }) => file.endsWith("sizes.tsx")).map(({ line, message }) => ({ line, message }))).toEqual([
      { line: 1, message: expect.stringContaining('"max-w-hub-two-column"') },
      { line: 1, message: expect.stringContaining('"w-screen-hub"') },
    ]);
  });

  it("leaves the generated @theme, sizes outside queries and other query widths alone", () => {
    const files = problems.map((problem) => `${problem.file}:${problem.line}`);

    expect(files).not.toContain("src/ui/tokens/theme.generated.css:2");
    expect(files).not.toContain("src/ui/literal.css:2");
    expect(files).not.toContain("src/ui/literal.css:17");
    expect(files).not.toContain("src/ui/variants.css:31");
    expect(files).not.toContain("src/ui/variants.css:32");
    expect(files).not.toContain("src/ui/variants.css:39");
  });
});

describe("logical CSS check", () => {
  const { problems } = checkLogical(readSources(fixture("logical-check")));
  const inFile = (name: string) => problems.filter(({ file }) => file.endsWith(name));
  const lines = (name: string) => [...new Set(inFile(name).map(({ line }) => line))];

  it("rejects left and right, physical margin, padding and border properties, physical float and text-align", () => {
    expect(lines("physical.css").filter((line) => ![13, 14, 18].includes(line))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 19, 20, 21]);
    expect(inFile("physical.css").find(({ line }) => line === 1)?.message).toContain('physical property "left"');
    expect(inFile("physical.css").find(({ line }) => line === 11)?.message).toContain('"text-align: left" is physical');
    expect(inFile("physical.css").find(({ line }) => line === 9)?.message).toContain('"float: left" is physical');
  });

  it("rejects 3- and 4-value margin and padding shorthands, counting a var() or calc() as one value", () => {
    expect(inFile("physical.css").filter(({ line }) => [13, 14, 18].includes(line)).map(({ line, message }) => ({ line, message }))).toEqual([
      { line: 13, message: expect.stringContaining("has 3 values") },
      { line: 14, message: expect.stringContaining("has 4 values") },
      { line: 18, message: expect.stringContaining("has 3 values") },
    ]);
  });

  it("rejects a [dir] selector other than the icon-mirroring rule", () => {
    expect(inFile("physical.css").filter(({ line }) => line === 19 || line === 20).map(({ message }) => message)).toEqual([
      expect.stringContaining('[dir] selector "[dir=\"rtl\"] .card"'),
      expect.stringContaining("[dir] selector \":root[dir='rtl'] .card\""),
    ]);
  });

  it("rejects the physical Tailwind utilities, with variants, in @apply and in class strings", () => {
    const named = [...inFile("classes.tsx"), ...inFile("physical.css")].map(({ message }) => /"([^"]+)"/.exec(message)![1]);

    expect(named).toEqual(
      expect.arrayContaining([
        "pl-4", "pr-2", "ml-2", "mr-auto", "-ml-1", "left-0", "right-1/2", "-left-2", "border-l", "border-r", "border-l-2",
        "rounded-l-lg", "rounded-r-md", "space-x-4", "pl-3", "mr-2", "text-left", "text-right", "pl-2", "mr-4",
      ]),
    );
    expect(inFile("classes.tsx").filter(({ line }) => line === 10 || line === 11)).toHaveLength(3);
  });

  it("rejects physical style-object keys and values", () => {
    expect(lines("styles.tsx")).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it("allows logical properties, 1- and 2-value shorthands, logical utilities, prose and the icon-mirroring rule", () => {
    expect(inFile("allowed.css")).toEqual([]);
    expect(lines("classes.tsx").filter((line) => line > 11)).toEqual([]);
    expect(lines("styles.tsx").filter((line) => line > 11)).toEqual([]);
  });
});

describe("token layer check", () => {
  const { problems } = checkLayers(readSources(fixture("layers-check")));

  it("rejects semantic and component tokens that are not a single var()", () => {
    expect(problems.filter((problem) => problem.message.includes("not a single var()"))).toEqual([
      expect.objectContaining({ file: "src/ui/card.css", line: 3 }),
      expect.objectContaining({ file: "src/ui/tokens/semantic.css", line: 3 }),
      expect.objectContaining({ file: "src/ui/tokens/semantic.css", line: 4 }),
    ]);
  });

  it("rejects var(--app-…) outside semantic.css, in CSS and in code", () => {
    expect(problems.filter((problem) => problem.message.includes("--app-* primitive"))).toEqual([
      expect.objectContaining({ file: "src/ui/card.css", line: 5 }),
      expect.objectContaining({ file: "src/ui/leak.ts", line: 1 }),
      expect.objectContaining({ file: "src/ui/leak.ts", line: 2, message: expect.stringContaining("--app-tap") }),
      expect.objectContaining({ file: "src/ui/leak.ts", line: 2, message: expect.stringContaining("--app-lh-body") }),
    ]);
  });

  it("rejects spacing, size and radius inside a [data-theme] block, but not colour", () => {
    expect(problems.filter((problem) => problem.message.includes("one value in every theme"))).toEqual([
      expect.objectContaining({ file: "src/ui/card.css", line: 10, message: expect.stringContaining("--gap-icon") }),
      expect.objectContaining({ file: "src/ui/card.css", line: 11, message: expect.stringContaining("--radius-card") }),
    ]);
  });

  it("rejects a var() with no declaration in the token files", () => {
    expect(problems.filter((problem) => problem.message.includes("not declared")).map(({ file, line, message }) => ({ file, line, message }))).toEqual([
      { file: "src/ui/card.css", line: 6, message: expect.stringContaining("--undeclared-ink") },
      { file: "src/ui/card.css", line: 17, message: expect.stringContaining("--color-ink") },
    ]);
  });

  it("does not count a Tailwind theme variable declared only in the @theme reference block as declared", () => {
    expect(problems.filter((problem) => problem.message.includes("--color-ink")).map(({ line }) => line)).toEqual([17]);
  });

  it("accepts var(--type-body-size) in component CSS: a semantic type token is declared", () => {
    expect(problems.filter((problem) => problem.line === 16 && problem.file === "src/ui/card.css")).toEqual([]);
  });
});

describe("the checks on src/", () => {
  it.each(["spacing", "layout", "logical", "layers"])("%s passes", (name) => {
    const result = spawnSync("node", ["scripts/check-css.mjs", name], { encoding: "utf8" });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
