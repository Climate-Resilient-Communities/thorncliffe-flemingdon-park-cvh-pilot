// The directory store's composition root holds the Supabase secret key's client (S02.05): it must never be bundled
// for the browser. `import "server-only"` makes Next fail the build if a client component ever reaches it.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("src/app/directoryRelease.ts", () => {
  it('imports "server-only"', () => {
    const source = readFileSync(path.join(__dirname, "..", "src", "app", "directoryRelease.ts"), "utf8");

    expect(source).toMatch(/^import "server-only";$/m);
  });
});
