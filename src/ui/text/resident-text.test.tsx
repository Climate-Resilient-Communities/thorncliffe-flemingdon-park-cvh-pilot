import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FALLBACK_MARKER, ResidentText, isEnglishFallback } from "./resident-text";

const MESSAGES = path.join(__dirname, "..", "..", "i18n", "messages");

describe("ResidentText", () => {
  it("renders a translated string as it is", () => {
    expect(renderToStaticMarkup(<ResidentText>ابھی کچھ نہیں ہو رہا۔</ResidentText>)).toBe("ابھی کچھ نہیں ہو رہا۔");
  });

  it("wraps a string that fell back to English in an isolated left-to-right English run", () => {
    expect(renderToStaticMarkup(<ResidentText>{"[EN] Nothing is happening right now."}</ResidentText>)).toBe(
      '<bdi lang="en" dir="ltr">[EN] Nothing is happening right now.</bdi>',
    );
  });

  it("escapes the text it wraps", () => {
    expect(renderToStaticMarkup(<ResidentText>{"[EN] <b>&</b>"}</ResidentText>)).toBe('<bdi lang="en" dir="ltr">[EN] &lt;b&gt;&amp;&lt;/b&gt;</bdi>');
  });

  it("recognises a fallback by the marker at the start, not elsewhere", () => {
    expect(isEnglishFallback("[EN] Map")).toBe(true);
    expect(isEnglishFallback("Map [EN] ")).toBe(false);
    expect(isEnglishFallback("[EN]Map")).toBe(false);
    expect(isEnglishFallback("")).toBe(false);
  });

  it("uses the marker that gen-strings puts in every catalog", () => {
    const generator = readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "gen-strings.cjs"), "utf8");
    expect(generator).toContain(`const MARKER = ${JSON.stringify(FALLBACK_MARKER)};`);

    const strings = (node: unknown): string[] =>
      typeof node === "string" ? [node] : node && typeof node === "object" ? Object.values(node).flatMap(strings) : [];
    const marked = readdirSync(MESSAGES)
      .filter((name) => name !== "en.json")
      .flatMap((name) => strings(JSON.parse(readFileSync(path.join(MESSAGES, name), "utf8"))))
      .filter((text) => text.startsWith("[EN]"));

    expect(marked.length).toBeGreaterThan(1000);
    for (const text of marked) expect(isEnglishFallback(text), text).toBe(true);
  });
});
