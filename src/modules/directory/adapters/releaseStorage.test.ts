import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DIRECTORY_BUCKET, fileDirectoryStorage, memoryDirectoryStorage, supabaseDirectoryStorage } from "./releaseStorage";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe.each([
  ["memory", () => memoryDirectoryStorage()],
  [
    "folder",
    () => {
      const dir = mkdtempSync(path.join(tmpdir(), "cvh-releases-"));
      dirs.push(dir);
      return fileDirectoryStorage(dir);
    },
  ],
])("the %s store", (_name, make) => {
  it("keeps what is put under a release path, replaces it, and says null for what is not there", async () => {
    const store = make();

    expect(await store.get("releases/1/en.json")).toBeNull();
    await store.put("releases/1/en.json", '{"a":"é"}');
    await store.put("releases/1/zh-Hant.json", "{}");
    expect(await store.get("releases/1/en.json")).toBe('{"a":"é"}');
    await store.put("releases/1/en.json", "{}");
    expect(await store.get("releases/1/en.json")).toBe("{}");
    expect(await store.get("releases/2/en.json")).toBeNull();
  });

  it.each(["../releases/1/en.json", "releases/1/../en.json", "/etc/passwd", "releases/0/en.json", "releases/01/en.json", "releases/1/en.txt", "releases/1/a/b.json", "other/1/en.json", ""])(
    "refuses the path %j, for a read and a write",
    async (file) => {
      const store = make();

      await expect(store.put(file, "x")).rejects.toThrow(/not a release file path/);
      await expect(store.get(file)).rejects.toThrow(/not a release file path/);
    },
  );
});

describe("the Supabase Storage store", () => {
  interface Call {
    method: string;
    url: string;
    body?: string;
  }
  /** A Storage API of our own: a bucket that exists or not, objects in memory. Nothing reaches a real project. */
  function fakeStorage(options: { bucket?: "private" | "public" | "missing"; failUploads?: boolean; allowedMime?: string[] | null; limit?: number | null } = {}) {
    const calls: Call[] = [];
    const objects = new Map<string, string>();
    const raw = new Map<string, Uint8Array>();
    let bucket = options.bucket ?? "missing";
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const rawBody = init?.body instanceof FormData ? ((init.body.get("") as Blob | null) ?? null) : init?.body instanceof Blob ? init.body : null;
      const body = init?.body instanceof FormData ? String(await (init.body.get("") as Blob | null)?.text()) : typeof init?.body === "string" ? init.body : init?.body instanceof Blob ? await init.body.text() : undefined;
      calls.push({ method, url, body });
      const bucketUrl = `/storage/v1/bucket/${DIRECTORY_BUCKET}`;
      if (url.endsWith(bucketUrl) && method === "GET") return bucket === "missing" ? json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 404) : json({ id: DIRECTORY_BUCKET, name: DIRECTORY_BUCKET, public: bucket === "public", allowed_mime_types: options.allowedMime ?? null, file_size_limit: options.limit ?? null });
      if (url.endsWith(bucketUrl) && method === "PUT") return json({ message: "Successfully updated" });
      if (url.endsWith("/storage/v1/bucket") && method === "POST") {
        bucket = "private";
        return json({ name: DIRECTORY_BUCKET });
      }
      const object = url.split(`/storage/v1/object/${DIRECTORY_BUCKET}/`)[1];
      if (object && (method === "POST" || method === "PUT")) {
        if (options.failUploads) return json({ message: "boom" }, 500);
        objects.set(object, body ?? "");
        if (rawBody) raw.set(object, new Uint8Array(await rawBody.arrayBuffer()));
        return json({ Key: `${DIRECTORY_BUCKET}/${object}` });
      }
      if (object && method === "GET" && raw.has(object) && object.endsWith(".bin")) return new Response(raw.get(object) as BodyInit);
      if (object && method === "GET") return objects.has(object) ? new Response(objects.get(object)) : json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400);
      return json({ message: "unexpected" }, 500);
    }) as typeof fetch;
    return { calls, objects, raw, fetch: fakeFetch };
  }
  const make = (fake: ReturnType<typeof fakeStorage>) => supabaseDirectoryStorage({ url: "https://project.supabase.test", secretKey: "sb_secret_test", fetch: fake.fetch });

  it("makes the bucket private when it is missing, once, then stores and reads files", async () => {
    const fake = fakeStorage();
    const store = make(fake);

    await store.put("releases/1/en.json", '{"v":1}');
    await store.put("releases/1/ur.json", "{}");
    expect(await store.get("releases/1/en.json")).toBe('{"v":1}');
    expect(await store.get("releases/9/en.json")).toBeNull();

    const created = fake.calls.filter((call) => call.method === "POST" && call.url.endsWith("/storage/v1/bucket"));
    expect(created).toHaveLength(1);
    expect(JSON.parse(created[0].body as string)).toMatchObject({ name: DIRECTORY_BUCKET, public: false });
    expect(fake.calls.filter((call) => call.method === "GET" && call.url.endsWith(`/bucket/${DIRECTORY_BUCKET}`))).toHaveLength(1);
  });

  it("makes and checks no bucket on a read (the search's read path): only the object is asked for, and a missing bucket reads as not found", async () => {
    const fake = fakeStorage({ bucket: "missing" });
    const store = make(fake);

    expect(await store.get("releases/1/en.json")).toBeNull();

    expect(fake.calls.filter((call) => /\/storage\/v1\/bucket/.test(call.url))).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it("uses a private bucket that exists, and refuses a public one", async () => {
    const existing = fakeStorage({ bucket: "private" });
    await make(existing).put("releases/1/en.json", "{}");
    expect(existing.calls.some((call) => call.url.endsWith("/storage/v1/bucket") && call.method === "POST")).toBe(false);

    const open = fakeStorage({ bucket: "public" });
    await expect(make(open).put("releases/1/en.json", "{}")).rejects.toThrow(/must be private/);
    expect(open.objects.size).toBe(0);
  });

  const bucketPut = (call: Call) => call.method === "PUT" && call.url.endsWith(`/bucket/${DIRECTORY_BUCKET}`);

  it("widens an existing bucket that only allows JSON to accept the binary type, keeping it private and its size limit", async () => {
    const fake = fakeStorage({ bucket: "private", allowedMime: ["application/json"], limit: 5_000_000 });
    await make(fake).put("releases/1/en.json", "{}");

    const updates = fake.calls.filter(bucketPut);
    expect(updates).toHaveLength(1);
    expect(JSON.parse(updates[0].body as string)).toMatchObject({ public: false, allowed_mime_types: ["application/json", "application/octet-stream"], file_size_limit: 5_000_000 });
  });

  it("leaves a bucket alone that already allows the binary type or has no restriction, and sends no size limit when it had none", async () => {
    for (const allowedMime of [["application/json", "application/octet-stream"], null]) {
      const fake = fakeStorage({ bucket: "private", allowedMime });
      await make(fake).put("releases/1/en.json", "{}");
      expect(fake.calls.some(bucketPut)).toBe(false);
    }
    const fake = fakeStorage({ bucket: "private", allowedMime: ["application/json"] });
    await make(fake).put("releases/1/en.json", "{}");
    expect(JSON.parse(fake.calls.find(bucketPut)!.body as string)).not.toHaveProperty("file_size_limit");
  });

  it("logs a safe line, and still stores, when the bucket cannot be widened", async () => {
    const fake = fakeStorage({ bucket: "private", allowedMime: ["application/json"] });
    const failing = ((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith(`/bucket/${DIRECTORY_BUCKET}`) && init?.method === "PUT" ? Promise.resolve(new Response(JSON.stringify({ message: "secret vendor text" }), { status: 400 })) : fake.fetch(input, init)) as typeof fetch;
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const store = supabaseDirectoryStorage({ url: "https://project.supabase.test", secretKey: "sb_secret_test", fetch: failing });
      await store.put("releases/1/en.json", "{}");
      expect(logged).toHaveBeenCalledTimes(1);
      expect(String(logged.mock.calls[0][0])).toContain("directory_bucket_update_failed");
      expect(String(logged.mock.calls[0][0])).not.toContain("secret vendor text");
    } finally {
      logged.mockRestore();
    }
  });

  it("stores bytes as octet-stream and reads the same bytes back; a missing binary reads as null", async () => {
    const fake = fakeStorage({ bucket: "private" });
    const store = make(fake);
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);

    await store.putBytes!("releases/1/vectors.bin", bytes);

    expect(Array.from((await store.getBytes!("releases/1/vectors.bin"))!)).toEqual(Array.from(bytes));
    expect(await store.getBytes!("releases/2/vectors.bin")).toBeNull();
  });

  it("allows only the release's own vectors.bin besides the language files", async () => {
    const store = make(fakeStorage({ bucket: "private" }));
    await expect(store.putBytes!("releases/1/vectors.bin", new Uint8Array(1))).resolves.toBeUndefined();
    for (const file of ["releases/1/x.bin", "releases/1/vectors.bin.json", "releases/0/vectors.bin", "../releases/1/vectors.bin", "releases/1/a/vectors.bin"]) {
      await expect(store.putBytes!(file, new Uint8Array(1))).rejects.toThrow(/not a release file path/);
      await expect(store.getBytes!(file)).rejects.toThrow(/not a release file path/);
    }
  });

  it("says a failed upload failed, without the store's own message", async () => {
    const store = make(fakeStorage({ bucket: "private", failUploads: true }));

    await expect(store.put("releases/1/en.json", "{}")).rejects.toThrow("the directory file could not be stored");
  });

  it("gives up a download the store never answers after its own timeout (a search's shared load of a release cannot hang on it)", async () => {
    const fake = fakeStorage({ bucket: "private" });
    let aborted = false;
    const hanging = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("/storage/v1/object/")) return fake.fetch(input, init);
      return new Promise<Response>((_, reject) =>
        init?.signal?.addEventListener("abort", () => {
          aborted = true;
          reject(init.signal!.reason);
        }),
      );
    }) as typeof fetch;
    const store = supabaseDirectoryStorage({ url: "https://project.supabase.test", secretKey: "sb_secret_test", fetch: hanging, timeoutMs: 50 });

    const started = performance.now();
    await expect(store.get("releases/1/vectors.json")).rejects.toThrow("the directory file could not be read");

    expect(aborted).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("refuses a path that is not a release file before it reaches the store", async () => {
    const fake = fakeStorage({ bucket: "private" });
    const store = make(fake);

    await expect(store.put("../x.json", "x")).rejects.toThrow(/not a release file path/);
    expect(fake.calls).toEqual([]);
  });
});
