// The source version of a release (S02.05): the sha256 of the committed data/catalogue/ files and the commit the
// running build was made from. The files are the ones deployed with the app (next.config.ts traces them into the
// publish function), so the hash names the catalogue the build was made with.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogueVersion } from "../application/ports";

async function filesUnder(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(path.join(dir, prefix), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await filesUnder(dir, relative)));
    else if (entry.isFile()) found.push(relative);
  }
  return found;
}

/**
 * sha256 over every file of the folder: for each path in byte order, `<path>\0<sha256 of the file>\n`. A renamed,
 * added, removed or changed file changes it; line endings are part of the files and are not normalised.
 */
export async function catalogueHash(dir: string): Promise<string> {
  const files = (await filesUnder(dir)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (files.length === 0) throw new Error("data/catalogue/ holds no files");
  const total = createHash("sha256");
  for (const file of files) {
    const digest = createHash("sha256").update(await readFile(path.join(dir, file))).digest("hex");
    total.update(`${file}\0${digest}\n`);
  }
  return total.digest("hex");
}

/** The build's commit (APP_VERSION is the commit CI built; "dev" and anything not a commit hash is a local build). */
export function gitCommitOf(appVersion: string | undefined): string | null {
  const value = (appVersion ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,40}$/.test(value) ? value : null;
}

export async function catalogueVersion(dir: string, appVersion: string | undefined): Promise<CatalogueVersion> {
  return { hash: await catalogueHash(dir), gitCommit: gitCommitOf(appVersion) };
}
