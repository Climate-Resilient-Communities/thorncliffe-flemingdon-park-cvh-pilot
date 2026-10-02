import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkLayers, checkLayout, checkSpacing, readSources, runCheck } from "../scripts/check-css.mjs";

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

  it("allows a line with a reviewed spacing-exception comment and lists it", () => {
    expect(problems.map((problem) => problem.file)).not.toContain("src/ui/exception.css");
    expect(exceptions).toEqual([
      expect.objectContaining({ file: "src/app/arbitrary.tsx", line: 11, reason: "optical alignment approved in review" }),
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
    expect(output).toContain("Reviewed spacing exceptions (2):");
  });
});

describe("layout literal check", () => {
  const { problems } = checkLayout(readSources(fixture("layout-check")));

  it("rejects 700px and 800px in media and container queries, in CSS, strings and arbitrary variants", () => {
    expect(problems).toEqual([
      { file: "src/app/(resident)/home/page.tsx", line: 5, message: expect.stringContaining("Grid twoColumn is for Hub pages only") },
      { file: "src/app/(resident)/home/page.tsx", line: 6, message: expect.stringContaining('"min-[700px]"') },
      { file: "src/app/(resident)/home/page.tsx", line: 7, message: expect.stringContaining('"@min-[800px]"') },
      { file: "src/app/staff/compose/page.tsx", line: 3, message: expect.stringContaining("@media (width >= 800px") },
      { file: "src/ui/literal.css", line: 5, message: expect.stringContaining("@media (width >= 700px)") },
      { file: "src/ui/literal.css", line: 11, message: expect.stringContaining("@container hub-page (min-width: 800px)") },
    ]);
  });

  it("leaves the generated @theme, sizes outside queries and other query widths alone", () => {
    const files = problems.map((problem) => `${problem.file}:${problem.line}`);

    expect(files).not.toContain("src/ui/tokens/theme.generated.css:2");
    expect(files).not.toContain("src/ui/literal.css:2");
    expect(files).not.toContain("src/ui/literal.css:17");
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
    ]);
  });

  it("rejects spacing, size and radius inside a [data-theme] block, but not colour", () => {
    expect(problems.filter((problem) => problem.message.includes("one value in every theme"))).toEqual([
      expect.objectContaining({ file: "src/ui/card.css", line: 10, message: expect.stringContaining("--gap-icon") }),
      expect.objectContaining({ file: "src/ui/card.css", line: 11, message: expect.stringContaining("--radius-card") }),
    ]);
  });

  it("rejects a var() with no declaration in the token files", () => {
    expect(problems.filter((problem) => problem.message.includes("not declared"))).toEqual([
      expect.objectContaining({ file: "src/ui/card.css", line: 6, message: expect.stringContaining("--undeclared-ink") }),
    ]);
  });
});

describe("the checks on src/", () => {
  it.each(["spacing", "layout", "layers"])("%s passes", (name) => {
    const result = spawnSync("node", ["scripts/check-css.mjs", name], { encoding: "utf8" });

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
