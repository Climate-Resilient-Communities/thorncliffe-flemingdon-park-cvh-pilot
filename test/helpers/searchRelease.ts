// A current release with search data, for the timing tests of search (src/modules/directory/application/search.test.ts and
// src/app/api/search/handler.test.ts): the row the database read returns, the files the store holds, and fakes of both
// whose answers can be slowed down or never come. Nothing here is a real database or a real store, and every wait is a
// timer, so the tests run on vitest's fake clock.
import { PgDialect } from "drizzle-orm/pg-core";
import { encodeVectorsBinary, type DirectoryStorage } from "@/modules/directory";
import type { Db } from "@/platform/db";
import { sha256Hex, sha256HexBytes } from "@/platform/hash";

export const RELEASE_V = 5;
export const EMBED_MODEL = "embed-v4.0";
export const VECTORS_PATH = `releases/${RELEASE_V}/vectors.json`;
export const BINARY_PATH = `releases/${RELEASE_V}/vectors.bin`;
export const LISTING_PATH = `releases/${RELEASE_V}/en.json`;
const CATALOGUE_HASH = "c".repeat(64);

/** A promise that never settles: a call nobody ever answers. */
export const never = <T = never>(): Promise<T> => new Promise<T>(() => undefined);

/** The release's files: two providers on two axes (M001 on the first), and an English listing with no emergency category. */
export function releaseFiles(): Map<string, string> {
  const vectors = JSON.stringify({
    v: 1,
    release_v: RELEASE_V,
    catalogue_hash: CATALOGUE_HASH,
    embed_model: EMBED_MODEL,
    dims: 2,
    providers: [
      { id: "M001", text_hash: "a".repeat(64), vector: [1, 0] },
      { id: "M002", text_hash: "b".repeat(64), vector: [0, 1] },
    ],
  });
  const listing = JSON.stringify({ v: 1, release_v: RELEASE_V, lang: "en", catalogue_hash: CATALOGUE_HASH, categories: [], providers: [] });
  return new Map([
    [VECTORS_PATH, vectors],
    [LISTING_PATH, listing],
  ]);
}

/** The compact binary form of the same two vectors (what a release published after the compact file has beside its JSON). */
export function releaseBinary(releaseV = RELEASE_V): Uint8Array {
  return encodeVectorsBinary(
    {
      releaseV,
      catalogueHash: CATALOGUE_HASH,
      embedModel: EMBED_MODEL,
      entries: [
        { id: "M001", vector: [1, 0] },
        { id: "M002", vector: [0, 1] },
      ],
    },
    sha256HexBytes,
  );
}

/** The `directory_release` row of the current release, as the search's read selects it. */
export function releaseRow(files = releaseFiles(), binary?: Uint8Array) {
  const vectors = files.get(VECTORS_PATH)!;
  return {
    number: RELEASE_V,
    files: { en: { path: LISTING_PATH, sha256: sha256Hex(files.get(LISTING_PATH)!) } },
    search: {
      embed_model: EMBED_MODEL,
      embed_config: { model: EMBED_MODEL, input_type: "search_document", embedding_type: "float", dims: null },
      embed_config_key: "k1",
      vectors_path: VECTORS_PATH,
      catalogue_hash: CATALOGUE_HASH,
      release_v: RELEASE_V,
      vector_count: 2,
      dims: 2,
      threshold: 0.3,
      emergency_categories: [],
      sha256: sha256Hex(vectors),
      bytes: vectors.length,
      ...(binary ? { binary: { path: BINARY_PATH, sha256: sha256HexBytes(binary), bytes: binary.length } } : {}),
      reused: 0,
      embedded: 2,
      stored_at: "2026-10-01T12:00:00.000Z",
    },
  };
}

/**
 * The database of the search's read of the current release: a transaction that sets its statement timeout, then the select.
 * `connect: "never"` is a connection that is never made (the transaction never starts); `read: "never"` a select the
 * database never answers; `readMs` a select that takes that long. `statements` are the SQL the transaction ran, as text.
 */
export function releaseDb(options: { connect?: "never"; read?: "never"; readMs?: number; row?: ReturnType<typeof releaseRow> } = {}) {
  const dialect = new PgDialect();
  const statements: string[] = [];
  let transactions = 0;
  const row = options.row ?? releaseRow();
  const tx = {
    execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => void statements.push(dialect.sqlToQuery(query).sql),
    select: () => ({
      from: () => ({
        where: () => {
          statements.push("select current release");
          if (options.read === "never") return never();
          return new Promise((resolve) => setTimeout(() => resolve([row]), options.readMs ?? 5));
        },
      }),
    }),
  };
  const db = {
    transaction: (work: (t: typeof tx) => Promise<unknown>) => {
      transactions += 1;
      return options.connect === "never" ? never() : work(tx);
    },
    select: () => {
      throw new Error("the search reads the current release in a transaction, with a statement timeout");
    },
  } as unknown as Db;
  return { db, statements, transactions: () => transactions };
}

/** The private store of the release's files: each read takes `ms` (default 10), or never answers. `gets` are the paths read, in order. */
export function releaseStore(options: { ms?: number; never?: boolean; files?: Map<string, string>; bytes?: Map<string, Uint8Array> } = {}) {
  const files = options.files ?? releaseFiles();
  const gets: string[] = [];
  const storage: DirectoryStorage = {
    put: async () => {
      throw new Error("the search never writes to the store");
    },
    ...(options.bytes
      ? {
          getBytes: (path: string) => {
            gets.push(path);
            if (options.never) return never();
            return new Promise<Uint8Array | null>((resolve) => setTimeout(() => resolve(options.bytes!.get(path) ?? null), options.ms ?? 10));
          },
        }
      : {}),
    get: (path) => {
      gets.push(path);
      if (options.never) return never();
      return new Promise((resolve) => setTimeout(() => resolve(files.get(path) ?? null), options.ms ?? 10));
    },
  };
  return { storage, gets };
}
