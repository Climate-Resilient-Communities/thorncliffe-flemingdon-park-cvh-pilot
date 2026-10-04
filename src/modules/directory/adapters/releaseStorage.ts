// The places release files are kept (S02.05, AD-11): a private Supabase Storage bucket in production and
// preview; a folder for local runs and the end-to-end tests (the environment check refuses it on Vercel);
// memory for the unit and database tests. Residents never read these directly: the app serves every file
// from its own origin (src/app/api/directory).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DirectoryStorage } from "../application/ports";

/** The private bucket. Created private if it is missing; its files are read only through the app. */
export const DIRECTORY_BUCKET = "directory-releases";

/** A storage path is `releases/<number>/<lang>.json` or `releases/<number>/vectors.bin` (the compact vectors): nothing else can name a file. */
const STORAGE_PATH = /^releases\/[1-9][0-9]{0,8}\/(?:[A-Za-z-]{2,10}\.json|vectors\.bin)$/;
const BINARY_TYPE = "application/octet-stream";
const BUCKET_FILE_LIMIT = 10 * 1024 * 1024;

function checked(file: string): string {
  if (!STORAGE_PATH.test(file)) throw new Error("not a release file path");
  return file;
}

export function memoryDirectoryStorage(): DirectoryStorage & { files: Map<string, string>; binaries: Map<string, Uint8Array>; puts: string[]; bytePuts: string[] } {
  const files = new Map<string, string>();
  const binaries = new Map<string, Uint8Array>();
  const puts: string[] = [];
  const bytePuts: string[] = [];
  return {
    files,
    binaries,
    puts,
    bytePuts,
    async putBytes(file, body) {
      binaries.set(checked(file), body.slice());
      bytePuts.push(file);
    },
    async getBytes(file) {
      return binaries.get(checked(file))?.slice() ?? null;
    },
    async put(file, body) {
      files.set(checked(file), body);
      puts.push(file);
    },
    async get(file) {
      return files.get(checked(file)) ?? null;
    },
  };
}

/** A folder on disk: for local development and the end-to-end tests only. */
export function fileDirectoryStorage(root: string): DirectoryStorage {
  const resolve = (file: string) => path.join(root, ...checked(file).split("/"));
  return {
    async put(file, body) {
      const target = resolve(file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body, "utf8");
    },
    async putBytes(file, body) {
      const target = resolve(file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body);
    },
    async getBytes(file) {
      try {
        return new Uint8Array(await readFile(resolve(file)));
      } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return null;
        throw error;
      }
    },
    async get(file) {
      try {
        return await readFile(resolve(file), "utf8");
      } catch (error) {
        if ((error as { code?: unknown }).code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

export interface SupabaseDirectoryStorageConfig {
  /** The project URL (NEXT_PUBLIC_SUPABASE_URL). */
  url: string;
  /** The project's secret key (SUPABASE_SECRET_KEY): server only. */
  secretKey: string;
  bucket?: string;
  /** Test seam: the fetch the client uses. Tests pass a fake; nothing in a test reaches a real project. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/** The longest one call to Storage may take before it is abandoned and reported as a failure. */
export const DEFAULT_STORAGE_TIMEOUT_MS = 8000;

/** Supabase Storage with the secret key, in a private bucket made on first use. Server only. */
export function supabaseDirectoryStorage(config: SupabaseDirectoryStorageConfig): DirectoryStorage {
  const bucket = config.bucket ?? DIRECTORY_BUCKET;
  const base = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? DEFAULT_STORAGE_TIMEOUT_MS;
  // supabase-js is large and only the publish and the resident routes need it, so it loads on first use (the seed scripts import this module).
  let clientPromise: Promise<SupabaseClient> | undefined;
  const getClient = () =>
    (clientPromise ??= import("@supabase/supabase-js").then(({ createClient }) =>
      createClient(config.url, config.secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: {
          fetch: (input, init) => {
            const deadline = AbortSignal.timeout(timeoutMs);
            return base(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline });
          },
        },
      }),
    ));
  let ready: Promise<void> | undefined;

  const ensureBucket = async () => {
    const client = await getClient();
    const found = await client.storage.getBucket(bucket);
    if (!found.error) {
      if (found.data.public) throw new Error("the directory bucket is public; it must be private");
      // A bucket made before the compact vectors only allows JSON: let it keep the binary file too. A failure here only means the
      // binary upload is refused later, and the release is then published with its JSON vectors alone.
      const allowed = found.data.allowed_mime_types;
      if (Array.isArray(allowed) && allowed.length > 0 && !allowed.includes(BINARY_TYPE)) {
        await client.storage.updateBucket(bucket, { public: false, allowedMimeTypes: [...allowed, BINARY_TYPE], fileSizeLimit: found.data.file_size_limit ?? BUCKET_FILE_LIMIT });
      }
      return;
    }
    const made = await client.storage.createBucket(bucket, { public: false, allowedMimeTypes: ["application/json", BINARY_TYPE], fileSizeLimit: BUCKET_FILE_LIMIT });
    // Another instance may have made it in the meantime.
    if (made.error && !/already exists|duplicate/i.test(made.error.message)) throw new Error("the directory bucket could not be made");
  };
  const open = () => {
    ready ??= ensureBucket().catch((error) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };

  return {
    async put(file, body) {
      const key = checked(file);
      await open();
      const { error } = await (await getClient()).storage.from(bucket).upload(key, new Blob([body], { type: "application/json" }), {
        upsert: true,
        contentType: "application/json",
        cacheControl: "31536000",
      });
      if (error) throw new Error("the directory file could not be stored");
    },
    async putBytes(file, body) {
      const key = checked(file);
      await open();
      const { error } = await (await getClient()).storage.from(bucket).upload(key, new Blob([body as BlobPart], { type: BINARY_TYPE }), {
        upsert: true,
        contentType: BINARY_TYPE,
        cacheControl: "31536000",
      });
      if (error) throw new Error("the directory file could not be stored");
    },
    async getBytes(file) {
      const data = await download(file);
      return data === null ? null : new Uint8Array(await data.arrayBuffer());
    },
    async get(file) {
      const data = await download(file);
      return data === null ? null : data.text();
    },
  };

  async function download(file: string): Promise<Blob | null> {
    const key = checked(file);
    // A read never makes or checks the bucket (that is the publish's job, in `put`): on the search's read path a bucket call
    // would add two round trips to Storage to every cold request. A bucket that is not there answers not found.
    const { data, error } = await (await getClient()).storage.from(bucket).download(key);
    if (error) {
      const status = (error as { status?: number | string; statusCode?: number | string }).status ?? (error as { statusCode?: number | string }).statusCode;
      if (String(status) === "404" || /not.?found|does not exist/i.test(error.message)) return null;
      throw new Error("the directory file could not be read");
    }
    return data;
  }
}
