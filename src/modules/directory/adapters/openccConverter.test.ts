import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OPENCC_VERSION, openccZhHant } from "./openccConverter";

const require = createRequire(import.meta.url);

describe("OpenCC for zh-Hant", () => {
  it("records the version of the opencc-js the app pins", () => {
    let dir = path.dirname(require.resolve("opencc-js"));
    while (path.basename(dir) !== "opencc-js" && path.dirname(dir) !== dir) dir = path.dirname(dir);
    const installed = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")).version;
    const pinned = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "..", "..", "package.json"), "utf8")).dependencies["opencc-js"];

    expect(OPENCC_VERSION).toBe(installed);
    expect(pinned).toBe(installed);
  });

  it("converts Simplified to Traditional (Taiwan standard, with Taiwan phrases) and says which configuration did", async () => {
    const converter = await openccZhHant();

    expect(converter.convert("免费的法律服务。紧急情况请拨打 911。")).toBe("免費的法律服務。緊急情況請撥打 911。");
    expect(converter.convert("软件")).toBe("軟體");
    expect(converter.convert("")).toBe("");
    expect(converter.openccVersion).toBe(OPENCC_VERSION);
    expect(converter.config).toContain("OpenCC s2twp");
  });

  it("is the same conversion scripts/opencc_convert.mjs makes for the guides", async () => {
    const { execFileSync } = await import("node:child_process");
    const script = path.join(__dirname, "..", "..", "..", "..", "scripts", "opencc_convert.mjs");
    const sample = "软件和网络服务。";
    const out = JSON.parse(execFileSync("node", [script], { input: JSON.stringify({ texts: { a: sample } }) }).toString());

    expect((await openccZhHant()).convert(sample)).toBe(out.texts.a);
    expect((await openccZhHant()).config).toBe(out.config);
    expect(out.openccVersion).toBe(OPENCC_VERSION);
  });
});
