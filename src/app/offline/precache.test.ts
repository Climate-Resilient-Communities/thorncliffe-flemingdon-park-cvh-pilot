import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chunkOf, keepsEntry, precacheFilter, residentChunks, withDynamicChunks } from "./precache";

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
  it("is the union of the resident pages' chunks, without the Hub's and the API's, and with the map page's (a kept map page needs them after a deploy)", () => {
    manifest("[lang]", ["static/chunks/shell.js", "static/chunks/home.js", "static/chunks/home.css"]);
    manifest("[lang]/ready/numbers", ["static/chunks/shell.js", "static/chunks/numbers.js"]);
    manifest("[lang]/map", ["static/chunks/shell.js", "static/chunks/leaflet.js", "static/chunks/numbers.js"]);
    mkdirSync(path.join(dir, "(site)", "page"), { recursive: true });
    writeFileSync(path.join(dir, "(site)", "page", "build-manifest.json"), JSON.stringify({ rootMainFiles: ["static/chunks/framework.js"] }));
    manifest("staff/alerts/compose", ["static/chunks/shell.js", "static/chunks/compose.js"]);
    manifest("api/feed", ["static/chunks/api.js"]);
    expect([...(residentChunks(dir) ?? [])].sort()).toEqual(["static/chunks/framework.js", "static/chunks/home.css", "static/chunks/home.js", "static/chunks/leaflet.js", "static/chunks/numbers.js", "static/chunks/shell.js"]);
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

  it("reads a chunk name with a character outside the usual set the same way in the manifest and in the list", () => {
    manifest("[lang]", ["static/chunks/a%5Bb%5D.js", "static/chunks/c+d.js"]);
    const resident = residentChunks(dir);
    expect(resident).toContain("static/chunks/a%5Bb%5D.js");
    expect(resident).toContain("static/chunks/c+d.js");
    expect(keepsEntry(".next/static/chunks/c+d.js", resident)).toBe(true);
  });
});

describe("precacheFilter", () => {
  it("warns, and keeps every file, when the build left no manifest to read", () => {
    const { keeps, warnings } = precacheFilter(dir);
    expect(keeps(".next/static/chunks/compose.js")).toBe(true);
    expect(warnings).toHaveLength(1);
  });

  it("filters without a warning when the manifests are there", () => {
    const app = path.join(dir, "server", "app");
    mkdirSync(path.join(app, "[lang]"), { recursive: true });
    writeFileSync(path.join(app, "[lang]", "page_client-reference-manifest.js"), '"/_next/static/chunks/home.js"');
    const { keeps, warnings } = precacheFilter(dir);
    expect(warnings).toEqual([]);
    expect(keeps(".next/static/chunks/home.js")).toBe(true);
    expect(keeps(".next/static/chunks/compose.js")).toBe(false);
  });
});

describe("withDynamicChunks", () => {
  it("adds the chunks a kept chunk loads by import(), and theirs in turn, that no page manifest lists", () => {
    mkdirSync(path.join(dir, "static", "chunks"), { recursive: true });
    writeFileSync(path.join(dir, "static", "chunks", "map.js"), 'Promise.all(["static/chunks/leaflet.js"].map(load))');
    writeFileSync(path.join(dir, "static", "chunks", "leaflet.js"), 'Promise.all(["static/chunks/leaflet.css", "static/chunks/map.js"])');
    const all = withDynamicChunks(new Set(["static/chunks/map.js", "static/chunks/missing.js"]), dir);
    expect([...all].sort()).toEqual(["static/chunks/leaflet.css", "static/chunks/leaflet.js", "static/chunks/map.js", "static/chunks/missing.js"]);
  });
});
