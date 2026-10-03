import { describe, expect, it } from "vitest";
import { DirectoryListingV1 } from "@/contracts/directory";
import type { SearchV1 } from "@/contracts/searchTestSet";
import { buildListing, buildManifest } from "../../../e2e/resident/directory-fixture";
import { keep, MANIFEST_URL, readKept, type KeptStorage } from "../directory/load-directory";
import { contentLangOf, resolveResults } from "./resolve-results";

function memory(): KeptStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    key: (at) => [...data.keys()][at] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const answer = ({ ids = ["P104", "P101"], ...change }: Partial<SearchV1> & { ids?: string[] } = {}): SearchV1 => ({
  v: 1,
  release_v: 7,
  query_lang: "en",
  status: "ok",
  emergency_first: false,
  results: ids.map((provider_id) => ({ provider_id, score: 0.5 })),
  ...change,
});

/** A fetch over release files: `files` maps a path to a listing, anything else is down. */
function server(files: Record<string, unknown>, manifest?: unknown) {
  const asked: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    asked.push(url);
    const body = url === MANIFEST_URL ? manifest : files[url];
    if (body === undefined) throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { fetcher, asked };
}

/** A listing file, checked against its schema (as the phone does). */
const listing = (...args: Parameters<typeof buildListing>) => DirectoryListingV1.parse(buildListing(...args));

const publishedAt = "2026-10-01T15:00:00.000Z";

describe("resolveResults", () => {
  it("looks the ids up in the kept listing of exactly that release, in the returned order, without asking the server", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 7), publishedAt });
    const { fetcher, asked } = server({});
    const out = await resolveResults(answer(), { lang: "en", heldRelease: 7, fetcher, storage });
    expect(out.kind === "results" && out.providers.map((p) => p.id)).toEqual(["P104", "P101"]);
    expect(out.kind === "results" && out.note).toBe(false);
    expect(asked).toEqual([]);
  });

  it("downloads the file of that release when it is not on the phone, and never reads another release's listing", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 6), publishedAt });
    const { fetcher, asked } = server({ "/api/directory/7/en.json": buildListing("en", 7) }, buildManifest(7));
    const out = await resolveResults(answer({ ids: ["P102"] }), { lang: "en", heldRelease: 6, fetcher, storage });
    expect(out.kind === "results" && out.providers.map((p) => p.id)).toEqual(["P102"]);
    // The phone's v (6) is older than the answer's release (7): the manifest is read again, then that release's file.
    expect(asked).toEqual([MANIFEST_URL, "/api/directory/7/en.json"]);
    expect(readKept(storage, "en")?.listing.release_v).toBe(7);
  });

  it("shows only 'updating' when the manifest cannot be refreshed or the file cannot be had; a kept older release is never used for the ids", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 6), publishedAt });
    const noManifest = server({ "/api/directory/7/en.json": buildListing("en", 7) });
    expect(await resolveResults(answer(), { lang: "en", heldRelease: 6, fetcher: noManifest.fetcher, storage })).toEqual({ kind: "updating" });
    const noFile = server({}, buildManifest(7));
    expect(await resolveResults(answer(), { lang: "en", heldRelease: 6, fetcher: noFile.fetcher, storage })).toEqual({ kind: "updating" });
    expect(readKept(storage, "en")?.listing.release_v).toBe(6);
  });

  it("does not refresh the manifest when the phone's release is the answer's", async () => {
    const storage = memory();
    const { fetcher, asked } = server({ "/api/directory/7/ur.json": buildListing("ur", 7) });
    keep(storage, { listing: listing("en", 7), publishedAt });
    const out = await resolveResults(answer({ query_lang: "ur", ids: ["P101"] }), { lang: "en", heldRelease: 7, fetcher, storage });
    expect(out.kind === "results" && out.shownLang).toBe("ur");
    expect(out.kind === "results" && out.note).toBe(true);
    expect(asked).toEqual(["/api/directory/7/ur.json"]);
  });

  it("falls back to the page language, with the note, when the question language's file cannot be had", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 7), publishedAt });
    const { fetcher } = server({});
    const out = await resolveResults(answer({ query_lang: "ur", ids: ["P101"] }), { lang: "en", heldRelease: 7, fetcher, storage });
    expect(out.kind === "results" && [out.shownLang, out.note]).toEqual(["en", true]);
  });

  it("shows a question language that has no page (zh-Hant) in the page language, without a note", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 7), publishedAt });
    const out = await resolveResults(answer({ query_lang: "zh-Hant" }), { lang: "en", heldRelease: 7, fetcher: server({}).fetcher, storage });
    expect(out.kind === "results" && [out.shownLang, out.note]).toEqual(["en", false]);
  });

  it("refuses a file that is not the release, language or catalogue it should be", async () => {
    const wrongRelease = server({ "/api/directory/7/en.json": buildListing("en", 8) }, buildManifest(7));
    expect(await resolveResults(answer(), { lang: "en", heldRelease: undefined, fetcher: wrongRelease.fetcher, storage: memory() })).toEqual({ kind: "updating" });
    const wrongHash = server({ "/api/directory/7/en.json": buildListing("en", 7, { hash: "c".repeat(64) }) }, buildManifest(7));
    expect(await resolveResults(answer(), { lang: "en", heldRelease: undefined, fetcher: wrongHash.fetcher, storage: memory() })).toEqual({ kind: "updating" });
  });

  it("leaves out an id the file does not hold, and says 'updating' when it holds none", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 7), publishedAt });
    const some = await resolveResults(answer({ ids: ["P101", "P999"] }), { lang: "en", heldRelease: 7, fetcher: server({}).fetcher, storage });
    expect(some.kind === "results" && some.providers.map((p) => p.id)).toEqual(["P101"]);
    expect(await resolveResults(answer({ ids: ["P999"] }), { lang: "en", heldRelease: 7, fetcher: server({}).fetcher, storage })).toEqual({ kind: "updating" });
  });
});

describe("resolveResults: what stays on the phone", () => {
  it("keeps the page language's listing when a search is answered in another language, and keeps no other listing", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 7), publishedAt });
    const { fetcher } = server({ "/api/directory/7/ur.json": buildListing("ur", 7) });
    const out = await resolveResults(answer({ query_lang: "ur", ids: ["P101"] }), { lang: "en", heldRelease: 7, fetcher, storage });
    expect(out.kind === "results" && out.shownLang).toBe("ur");
    expect(readKept(storage, "en")?.listing.release_v).toBe(7);
    expect([...storage.data.keys()]).toEqual(["cvh.directory.en"]);
  });

  it("keeps nothing of the question's language even when the release is newer, and keeps the page language's file of that release", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 6), publishedAt });
    const { fetcher, asked } = server({ "/api/directory/7/ur.json": buildListing("ur", 7), "/api/directory/7/en.json": buildListing("en", 7) }, buildManifest(7));
    const out = await resolveResults(answer({ query_lang: "ur", ids: ["P101"] }), { lang: "en", heldRelease: 6, fetcher, storage });
    expect(out.kind === "results" && [out.shownLang, out.note]).toEqual(["ur", true]);
    expect(asked).toEqual([MANIFEST_URL, "/api/directory/7/ur.json", "/api/directory/7/en.json"]);
    expect(readKept(storage, "en")?.listing.release_v).toBe(7);
    expect(readKept(storage, "ur")).toBeNull();
    expect([...storage.data.keys()]).toEqual(["cvh.directory.en"]);
  });

  it("keeps the page language's listing when the question's language file is the one that cannot be had", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 6), publishedAt });
    const { fetcher } = server({ "/api/directory/7/en.json": buildListing("en", 7) }, buildManifest(7));
    const out = await resolveResults(answer({ query_lang: "ur", ids: ["P101"] }), { lang: "en", heldRelease: 6, fetcher, storage });
    expect(out.kind === "results" && [out.shownLang, out.note]).toEqual(["en", true]);
    expect([...storage.data.keys()]).toEqual(["cvh.directory.en"]);
    expect(readKept(storage, "en")?.listing.release_v).toBe(7);
  });

  it("hands the refreshed manifest and the page language's listing of its release to the screen", async () => {
    const storage = memory();
    keep(storage, { listing: listing("en", 6), publishedAt });
    const { fetcher } = server({ "/api/directory/7/en.json": buildListing("en", 7) }, buildManifest(7, undefined, "available"));
    const told: { manifest: { release_v: number }; page: { listing: { release_v: number }; publishedAt: string } | null }[] = [];
    await resolveResults(answer({ ids: ["P102"] }), { lang: "en", heldRelease: 6, fetcher, storage, onRefreshed: (refreshed) => told.push(refreshed) });
    expect(told).toHaveLength(1);
    expect(told[0].manifest.release_v).toBe(7);
    expect(told[0].page?.listing.release_v).toBe(7);
    expect(told[0].page?.publishedAt).toBe(publishedAt);
  });

  it("tells the manifest alone when the release's file could not be had, and tells nothing when the manifest was not read again or could not be", async () => {
    const told: unknown[] = [];
    const onRefreshed = (refreshed: unknown) => told.push(refreshed);
    const none = await resolveResults(answer(), { lang: "en", heldRelease: 6, fetcher: server({}, buildManifest(7)).fetcher, storage: memory(), onRefreshed });
    expect(none).toEqual({ kind: "updating" });
    expect(told).toEqual([{ manifest: buildManifest(7), page: null }]);

    told.length = 0;
    const storage = memory();
    keep(storage, { listing: listing("en", 7), publishedAt });
    await resolveResults(answer(), { lang: "en", heldRelease: 7, fetcher: server({}).fetcher, storage, onRefreshed });
    await resolveResults(answer(), { lang: "en", heldRelease: 6, fetcher: server({}).fetcher, storage, onRefreshed });
    expect(told).toEqual([]);
  });
});

describe("contentLangOf", () => {
  it("is the language of the texts when it is not the page's", () => {
    expect(contentLangOf("ur", "en")).toBe("ur");
    expect(contentLangOf("en", "ur")).toBe("en");
  });

  it("is nothing when the texts are in the page's own language or in a language the app has no page for", () => {
    expect(contentLangOf("en", "en")).toBeUndefined();
    expect(contentLangOf("zh-Hant", "en")).toBeUndefined();
  });
});
