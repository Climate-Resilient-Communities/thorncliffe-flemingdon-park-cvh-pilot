// What /api/directory/manifest and /api/directory/{v}/{lang}.json answer (S02.05, AD-11, AD-20), against a
// real database and a release the publish job really wrote: the contract schemas of src/contracts/directory.ts
// validate both bodies, the headers are the story's (manifest no-store; files public, immutable, a year),
// and an unknown release or language is a 404.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listingResponse, manifestResponse, type DirectoryServeDeps } from "../../src/app/api/directory/serve";
import { migrate } from "../../scripts/db/migrate.mjs";
import { DirectoryErrorV1, DirectoryListingV1, DirectoryManifestV1 } from "@/contracts/directory";
import { LANG_CODES } from "@/contracts/lang";
import { memoryDirectoryStorage, publishDirectory, type PublishDeps } from "@/modules/directory";
import { createDb, type Db } from "@/platform/db";
import { connect, serverUrl } from "./helpers";

describe("the directory routes' answers", () => {
  let sql: ReturnType<typeof connect>;
  let app: Db;
  let appSql: ReturnType<typeof connect>;
  let auditBaseline = 0;
  const staffId = randomUUID();
  const storage = memoryDirectoryStorage();
  const serve: DirectoryServeDeps = { db: () => app, storage: () => storage };

  const publishDeps = (): PublishDeps => ({
    storage,
    catalogue: async () => ({ hash: "b".repeat(64), gitCommit: null }),
    neighbourhoods: async () => ({ reviewed: true, byProvider: { M001: ["TP"] } }),
    zhHant: async () => ({ convert: (text: string) => text, openccVersion: "1.4.2", config: "test" }),
    onFailure: async () => {},
    sleep: async () => {},
  });

  async function wipe() {
    await sql.unsafe(`
      alter table directory_release disable trigger directory_release_guard;
      delete from directory_release;
      alter table directory_release enable trigger directory_release_guard;
      delete from catalogue_load;
      delete from provider_category; delete from provider_location; delete from provider; delete from category`);
    storage.files.clear();
  }

  beforeAll(async () => {
    sql = connect(serverUrl());
    await migrate({ sql });
    [{ max: auditBaseline }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
    const password = randomBytes(18).toString("hex");
    await sql.unsafe(`alter role cvh_app_login password '${password}'`);
    const url = new URL(serverUrl());
    url.username = "cvh_app_login";
    url.password = password;
    app = createDb(url.href);
    appSql = connect(url.href);
    await sql`
      insert into staff_account (id, auth_user_id, username, first_name, last_name, email, role, must_change_password)
      values (${staffId}, ${randomUUID()}, ${`admin${randomBytes(3).toString("hex")}`}, 'Ann', 'Okafor', 'someone@example.org', 'admin', false)`;
  });

  afterAll(async () => {
    await wipe();
    await sql.unsafe("alter table audit_event disable trigger audit_event_no_update_or_delete");
    await sql`delete from audit_event where id > ${auditBaseline}`;
    await sql.unsafe("alter table audit_event enable trigger audit_event_no_update_or_delete");
    await sql`delete from staff_account where id = ${staffId}`;
    await sql.unsafe("alter role cvh_app_login password null");
    await appSql.end({ timeout: 5 });
    await app.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await wipe();
    // The seed ran with the catalogue this deployment carries (the hash publishDeps() reports).
    await sql`insert into catalogue_load (hash) values (${"b".repeat(64)})`;
    await sql`insert into category (id, name, sort_order, labels) values ('c-legal', 'Legal', 1, ${sql.json({ en: "Legal" })})`;
    await sql`
      insert into provider (id, name, texts, published, published_at, last_confirmed)
      values ('M001', 'Thorncliffe Legal Clinic', ${sql.json({ services: { en: "Free legal help. Call 911 in an emergency." } })}, true, now(), '2026-09-20')`;
    await sql`insert into provider_location (provider_id, street, city, lat, lng) values ('M001', '1 Overlea Blvd', 'East York', 43.7, -79.34)`;
    await sql`insert into provider_category (provider_id, category_id) values ('M001', 'c-legal')`;
  });

  const publish = () => publishDirectory(app, publishDeps(), staffId);
  const errorOf = async (response: Response) => DirectoryErrorV1.parse(await response.json());

  describe("/api/directory/manifest", () => {
    it("is 404 no_release, uncached, before the first release", async () => {
      const response = await manifestResponse(serve);

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await errorOf(response)).toEqual({ v: 1, error: { code: "no_release", message_key: "directory.no_release" } });
    });

    it("returns DirectoryManifestV1 for the current release, never cached, with search unavailable and a path for every language", async () => {
      await publish();

      const response = await manifestResponse(serve);

      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(response.headers.get("Set-Cookie")).toBeNull();
      const manifest = DirectoryManifestV1.parse(await response.json());
      expect(manifest).toMatchObject({ v: 1, release_v: 1, catalogue_hash: "b".repeat(64), search: { status: "unavailable" } });
      expect(Object.keys(manifest.files).sort()).toEqual([...LANG_CODES].sort());
      expect(manifest.files.ur).toBe("/api/directory/1/ur.json");
    });

    it("follows the current release: after the next publish it names release 2", async () => {
      await publish();
      await publish();

      expect(DirectoryManifestV1.parse(await (await manifestResponse(serve)).json()).release_v).toBe(2);
    });

    it("is 503 unavailable, uncached, when the database cannot be read", async () => {
      const response = await manifestResponse({ ...serve, db: () => { throw new Error("no database"); } });

      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await errorOf(response)).error.code).toBe("unavailable");
    });
  });

  describe("/api/directory/{v}/{lang}.json", () => {
    it("serves each language's file of a release from the app's own origin, public and immutable for a year, valid against the contract", async () => {
      await publish();
      const manifest = DirectoryManifestV1.parse(await (await manifestResponse(serve)).json());

      for (const lang of LANG_CODES) {
        const [, , , v, file] = manifest.files[lang].split("/");
        const response = await listingResponse(serve, v, file);
        expect(response.status, lang).toBe(200);
        expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
        expect(response.headers.get("CDN-Cache-Control")).toBe("max-age=31536000");
        expect(response.headers.get("Content-Type")).toMatch(/^application\/json/);
        expect(response.headers.get("Set-Cookie")).toBeNull();
        const body = await response.text();
        expect(body).toBe(storage.files.get(`releases/1/${lang}.json`));
        expect(DirectoryListingV1.parse(JSON.parse(body))).toMatchObject({ v: 1, release_v: 1, lang });
      }
    });

    it("still serves an earlier release's files, unchanged, after a newer release is current", async () => {
      await publish();
      const before = await (await listingResponse(serve, "1", "en.json")).text();
      await sql`update provider set published = false, published_at = null where id = 'M001'`;
      await publish();

      expect(await (await listingResponse(serve, "1", "en.json")).text()).toBe(before);
      expect(DirectoryListingV1.parse(JSON.parse(await (await listingResponse(serve, "2", "en.json")).text())).providers).toEqual([]);
    });

    it.each([
      ["an unknown release", "9", "en.json"],
      ["release 0", "0", "en.json"],
      ["a release that is not a number", "abc", "en.json"],
      ["a release with a leading zero", "01", "en.json"],
      ["an unknown language", "1", "xx.json"],
      ["a language without .json", "1", "en"],
      ["a path that climbs out", "1", "../en.json"],
      ["a manifest-like name", "1", "manifest.json"],
    ])("is 404 for %s, uncached", async (_name, release, file) => {
      await publish();

      const response = await listingResponse(serve, release, file);

      expect(response.status).toBe(404);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      // Only a complete release's file is cached by the CDN, never an error.
      expect(response.headers.get("CDN-Cache-Control")).toBeNull();
      expect((await errorOf(response)).error.code).toBe("not_found");
    });

    it("is 404 for a release that is not complete", async () => {
      await publish();
      await sql.unsafe(
        `insert into directory_release (number, status, catalogue_hash, counts, report, files, staged)
         values (2, 'building', repeat('a', 64), '{}', '{}', '{"en": {"path": "releases/2/en.json", "sha256": "x", "bytes": 2, "stored_at": null}}', '{"en": "{}"}')`,
      );
      storage.files.set("releases/2/en.json", "{}");

      expect((await listingResponse(serve, "2", "en.json")).status).toBe(404);
    });

    it("is 503 unavailable, uncached, when the store cannot give the file or gives other bytes", async () => {
      await publish();

      const broken = await listingResponse({ ...serve, storage: () => ({ put: async () => {}, get: async () => { throw new Error("down"); } }) }, "1", "en.json");
      expect(broken.status).toBe(503);
      expect(broken.headers.get("Cache-Control")).toBe("no-store");
      expect(broken.headers.get("CDN-Cache-Control")).toBeNull();
      storage.files.set("releases/1/en.json", "{}");
      expect((await listingResponse(serve, "1", "en.json")).status).toBe(503);
    });
  });
});
