// What the resident routes serve (S02.05, AD-11, AD-20): the manifest of the current release and the listing
// files of any complete release, all from the app's own origin. Nothing here writes.
//
// Immutability: a complete release's files and manifest entry are never modified (a trigger refuses it, and the
// publish job never writes to a complete release's paths); a file is served only if its bytes still hash to what
// the release recorded. The manifest is read in one statement, so it names the old release or the new one, never a mix.
import { and, eq } from "drizzle-orm";
import { DirectoryManifestV1, listingPath } from "@/contracts/directory";
import { LANG_CODES, type LangCode } from "@/contracts/lang";
import type { DbExecutor } from "@/platform/db";
import { sha256Hex } from "@/platform/hash";
import { directoryRelease } from "../adapters/schema";
import type { DirectoryStorage } from "./ports";

/** The current release's manifest, or null before the first publish (or if the stored row is not a valid manifest). */
export async function currentManifest(db: DbExecutor): Promise<DirectoryManifestV1 | null> {
  const [row] = await db
    .select({
      number: directoryRelease.number,
      publishedAt: directoryRelease.publishedAt,
      catalogueHash: directoryRelease.catalogueHash,
      search: directoryRelease.search,
      files: directoryRelease.files,
    })
    .from(directoryRelease)
    .where(and(eq(directoryRelease.isCurrent, true), eq(directoryRelease.status, "complete")));
  if (!row || row.publishedAt === null) return null;
  const search = row.search as { embed_model?: string; vectors_path?: string } | null;
  const manifest = DirectoryManifestV1.safeParse({
    v: 1,
    release_v: row.number,
    published_at: row.publishedAt.toISOString(),
    catalogue_hash: row.catalogueHash,
    search: search === null ? { status: "unavailable" } : { status: "available", embed_model: search.embed_model, vectors_path: search.vectors_path },
    files: Object.fromEntries(Object.keys(row.files).map((lang) => [lang, listingPath(row.number, lang)])),
  });
  return manifest.success ? manifest.data : null;
}

export type ListingRead = { found: true; body: string } | { found: false; reason: "not_found" | "unavailable" };

const RELEASE_NUMBER = /^[1-9][0-9]{0,8}$/;

/** The language of a `<lang>.json` file name, or null. */
export function langOfFile(file: string): LangCode | null {
  if (!file.endsWith(".json")) return null;
  const lang = file.slice(0, -".json".length);
  return (LANG_CODES as readonly string[]).includes(lang) ? (lang as LangCode) : null;
}

/**
 * One language's listing file of one complete release. `not_found` for an unknown release (or one that is not
 * complete: a release being built or failed has no files residents may read) or an unknown language; `unavailable`
 * when the store cannot give the file or its bytes are not what the release recorded.
 */
export async function readListing(db: DbExecutor, storage: DirectoryStorage, release: string, file: string): Promise<ListingRead> {
  const lang = langOfFile(file);
  if (lang === null || !RELEASE_NUMBER.test(release)) return { found: false, reason: "not_found" };
  const [row] = await db
    .select({ files: directoryRelease.files })
    .from(directoryRelease)
    .where(and(eq(directoryRelease.number, Number(release)), eq(directoryRelease.status, "complete")));
  const entry = row?.files[lang];
  if (!entry) return { found: false, reason: "not_found" };
  try {
    const body = await storage.get(entry.path);
    if (body === null || sha256Hex(body) !== entry.sha256) return { found: false, reason: "unavailable" };
    return { found: true, body };
  } catch {
    return { found: false, reason: "unavailable" };
  }
}
