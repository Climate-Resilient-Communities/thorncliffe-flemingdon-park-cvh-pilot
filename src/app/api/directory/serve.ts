// The responses of /api/directory/manifest and /api/directory/{v}/{lang}.json (S02.05, AD-11, AD-20), apart from
// the route files so a test can call them with a database and a store of its own. Public: no session, no cookie.
//
//  - the manifest is `no-store`: it names the current release and changes when one is published;
//  - a listing file is immutable: a release's files never change, so each is cached for a year, by the browser
//    and by the service worker, under a URL that names the release, and by the CDN (`CDN-Cache-Control`, on a
//    complete release's file only: an error answer is `no-store` and never cached anywhere);
//  - an unknown release or language is 404, with the AD-20 error body.
import { DirectoryErrorV1 } from "@/contracts/directory";
import { currentManifest, readListing, type DirectoryStorage } from "@/modules/directory";
import type { Db } from "@/platform/db";

export interface DirectoryServeDeps {
  db: () => Db;
  storage: () => DirectoryStorage;
}

const NO_STORE = "no-store";
const IMMUTABLE = "public, max-age=31536000, immutable";
const CDN_ONE_YEAR = "max-age=31536000";

function failure(status: 404 | 503, code: "no_release" | "not_found" | "unavailable"): Response {
  const body = DirectoryErrorV1.parse({ v: 1, error: { code, message_key: `directory.${code}` } });
  return Response.json(body, { status, headers: { "Cache-Control": NO_STORE } });
}

/** `GET /api/directory/manifest`: DirectoryManifestV1 for the current release. */
export async function manifestResponse(deps: DirectoryServeDeps): Promise<Response> {
  let manifest;
  try {
    manifest = await currentManifest(deps.db());
  } catch {
    return failure(503, "unavailable");
  }
  if (manifest === null) return failure(404, "no_release");
  return Response.json(manifest, { headers: { "Cache-Control": NO_STORE } });
}

/** `GET /api/directory/{v}/{lang}.json`: one language's listing file of release `v`. */
export async function listingResponse(deps: DirectoryServeDeps, release: string, file: string): Promise<Response> {
  let read;
  try {
    read = await readListing(deps.db(), deps.storage(), release, file);
  } catch {
    return failure(503, "unavailable");
  }
  if (!read.found) return read.reason === "not_found" ? failure(404, "not_found") : failure(503, "unavailable");
  return new Response(read.body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": IMMUTABLE, "CDN-Cache-Control": CDN_ONE_YEAR } });
}
