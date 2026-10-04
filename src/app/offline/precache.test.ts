import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chunkOf, keepsEntry, residentChunks } from "./precache";

let dir: string;

function manifest(route: string, chunks: string[]) {
  const file = path.join(dir, route, "page_client-reference-manifest.js");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `globalThis.__RSC_MANIFEST["/${route}/page"] = ${JSON.stringify({ entryJSFiles: { layout: chunks.filter((c) => c.endsWith(".js")) }, clientModules: { m: { chunks: chunks.map((c) => `/_next/${c}`) } } })};`);
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "cvh-precache-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("residentChunks", () => {
  it("is the union of the resident pages' chunks, without the Hub's, the API's and those only the map page loads", () => {
    manifest("[lang]", ["static/chunks/shell.js", "static/chunks/home.js", "static/chunks/home.css"]);
    manifest("[lang]/ready/numbers", ["static/chunks/shell.js", "static/chunks/numbers.js"]);
    manifest("[lang]/map", ["static/chunks/shell.js", "static/chunks/leaflet.js", "static/chunks/numbers.js"]);
    mkdirSync(path.join(dir, "(site)", "page"), { recursive: true });
    writeFileSync(path.join(dir, "(site)", "page", "build-manifest.json"), JSON.stringify({ rootMainFiles: ["static/chunks/framework.js"] }));
    manifest("staff/alerts/compose", ["static/chunks/shell.js", "static/chunks/compose.js"]);
    manifest("api/feed", ["static/chunks/api.js"]);
    expect([...(residentChunks(dir) ?? [])].sort()).toEqual(["static/chunks/framework.js", "static/chunks/home.css", "static/chunks/home.js", "static/chunks/numbers.js", "static/chunks/shell.js"]);
  });

  it("is null when there is nothing to read (a development run, no build), so every file is kept", () => {
    expect(residentChunks(path.join(dir, "missing"))).toBeNull();
    expect(residentChunks(dir)).toBeNull();
    expect(keepsEntry(".next/static/chunks/anything.js", null)).toBe(true);
  });
});

describe("keepsEntry", () => {
  const resident = new Set(["static/chunks/home.js"]);

  it("keeps a chunk a resident page loads, the runtime loader and every file that is not a chunk", () => {
    expect(chunkOf(".next/static/chunks/home.js")).toBe("static/chunks/home.js");
    expect(keepsEntry(".next/static/chunks/home.js", resident)).toBe(true);
    expect(keepsEntry(".next/static/chunks/turbopack-abc123.js", resident)).toBe(true);
    expect(keepsEntry("public/icons/icon-192.png", resident)).toBe(true);
    expect(keepsEntry(".next/static/BUILD/_buildManifest.js", resident)).toBe(true);
  });

  it("drops a chunk no resident page loads", () => {
    expect(keepsEntry(".next/static/chunks/compose.js", resident)).toBe(false);
    expect(keepsEntry(".next/static/chunks/leaflet.css", resident)).toBe(false);
  });
});
