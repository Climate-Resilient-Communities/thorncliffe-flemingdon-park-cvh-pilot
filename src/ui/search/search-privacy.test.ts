import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// FR-D2-Q, AD-3: the question is never kept on the phone beyond the screen, never in an address and never logged. The
// network test (e2e/resident/search.spec.ts) proves what leaves the phone; this holds the sources to it: nothing under
// src/ui/search reads or writes a storage, the history, the address, the console or a cookie.
const dir = __dirname;
const sources = readdirSync(dir)
  .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file))
  .map((file) => ({
    file,
    text: readFileSync(path.join(dir, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, ""),
  }));

describe("the ask screen's sources", () => {
  it("has sources to check", () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(["ask-screen.tsx", "search-client.ts", "resolve-results.ts"]));
  });

  for (const [what, pattern] of [
    ["the console", /\bconsole\./],
    ["a cookie", /document\.cookie/],
    ["the history or the address", /history\.(push|replace)State|router\.replace|window\.location|location\.(href|search|hash)/],
    ["IndexedDB", /indexedDB/],
    ["a beacon", /sendBeacon/],
  ] as const) {
    it(`never touches ${what}`, () => {
      for (const { file, text } of sources) expect(text, file).not.toMatch(pattern);
    });
  }

  it("writes to storage only through the directory's own keep and filter store, never the question", () => {
    for (const { file, text } of sources) {
      expect(text, file).not.toMatch(/\.setItem\(/);
      expect(text, file).not.toMatch(/sessionStorage|localStorage\.(set|remove)/);
    }
    // The only router move carries a fixed path, never the question.
    const screen = sources.find((s) => s.file === "ask-screen.tsx")!.text;
    expect(screen.match(/router\.push\(([^)]*)\)/g)).toEqual(["router.push(`/${lang}/directory`)"]);
  });

  it("sends the question in the body of one POST and nowhere in the address", () => {
    const client = sources.find((s) => s.file === "search-client.ts")!.text;
    expect(client).toContain('method: "POST"');
    expect(client).toContain('credentials: "omit"');
    expect(client).not.toMatch(/SEARCH_URL\s*\+|\?q=|encodeURIComponent/);
    expect(sources.filter((s) => /\/api\/search/.test(s.text)).map((s) => s.file)).toEqual(["search-client.ts"]);
  });

  it("writes no 911 block of its own: the block is the shared Not911, and the screen's own line is one dialled link", () => {
    for (const { file, text } of sources) expect(text, file).not.toMatch(/n911|data-component="not-911"/);
    const screen = sources.find((s) => s.file === "ask-screen.tsx")!.text;
    expect(screen).toMatch(/import \{ Not911 \} from "\.\.\/emergency"/);
    // The emergency_first block above the results, and the inline note (X01_Not911) that ends the screen.
    expect(screen.match(/<Not911 /g)).toHaveLength(2);
    expect(screen.match(/<Not911 variant="inline"/g)).toHaveLength(1);
  });
});
