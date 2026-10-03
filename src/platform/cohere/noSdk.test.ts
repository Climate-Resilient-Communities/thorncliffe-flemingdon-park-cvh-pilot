// The vendor's SDK (cohere-ai) evaluates for about 2.5 s on a cold serverless start, in front of the first search's clock, so
// no file of the app or its modules may import it (Cohere is reached through ./restClient). The dependency-cruiser rule
// `no-cohere-sdk` says the same; this test is the one that runs with the unit suite.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(name) && !name.endsWith("noSdk.test.ts") ? [full] : [];
  });
}

describe("no vendor SDK in the app", () => {
  it("imports cohere-ai nowhere under src or scripts, and the package is not a dependency", () => {
    const root = path.resolve(__dirname, "../../..");
    const offenders = [...sources(path.join(root, "src")), ...sources(path.join(root, "scripts"))].filter((file) => /["']cohere-ai(?:\/[^"']*)?["']/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
    const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    expect({ ...pkg.dependencies, ...pkg.devDependencies }).not.toHaveProperty("cohere-ai");
  });
});
