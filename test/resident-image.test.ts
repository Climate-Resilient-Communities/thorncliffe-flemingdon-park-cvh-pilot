// The resident screenshot baselines are made and compared in one pinned Playwright image (scripts/resident-docker.sh).
// Its tag must be the exact @playwright/test version, or the image's Chromium is not the one the tests expect.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(__dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("resident test image", () => {
  const manifest = JSON.parse(read("package.json"));
  const version = manifest.devDependencies["@playwright/test"] as string;
  const script = read("scripts/resident-docker.sh");

  it("pins @playwright/test to an exact version", () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("runs the image whose tag is that exact version", () => {
    const images = [...script.matchAll(/mcr\.microsoft\.com\/playwright:([^"\s]+)"/g)].map((match) => match[1]);
    expect(images).toEqual([`v${version}-noble`]);
  });

  it("is the only place CI and the npm scripts name an image", () => {
    expect(manifest.scripts["test:resident:docker"]).toBe("scripts/resident-docker.sh");
    expect(manifest.scripts["test:resident:update"]).toBe("scripts/resident-docker.sh --update-snapshots=all");
    expect(read(".github/workflows/ci.yml")).not.toMatch(/mcr\.microsoft\.com\/playwright/);
    expect(read(".github/workflows/ci.yml")).toMatch(/run: npm run test:resident:docker/);
  });

  it("is the image of the Hub shell's screenshot script too, which sets its own flag", () => {
    const hub = read("scripts/hub-docker.sh");

    expect([...hub.matchAll(/mcr\.microsoft\.com\/playwright:([^"\s]+)"/g)].map((match) => match[1])).toEqual([`v${version}-noble`]);
    expect(manifest.scripts["test:hub:docker"]).toBe("scripts/hub-docker.sh");
    expect(manifest.scripts["test:hub:update"]).toBe("scripts/hub-docker.sh --update-snapshots=all");
    expect(hub).toMatch(/-e HUB_PINNED_IMAGE=1/);
    expect(read("e2e/hub/helpers.ts")).toMatch(/process\.env\.HUB_PINNED_IMAGE === "1"/);
    expect(read(".github/workflows/ci.yml")).toMatch(/run: npm run test:hub:docker/);
  });

  it("sets the flag that lets the screenshot assertions run", () => {
    expect(script).toMatch(/-e RESIDENT_PINNED_IMAGE=1/);
    expect(read("e2e/resident/helpers.ts")).toMatch(/process\.env\.RESIDENT_PINNED_IMAGE === "1"/);
  });
});
