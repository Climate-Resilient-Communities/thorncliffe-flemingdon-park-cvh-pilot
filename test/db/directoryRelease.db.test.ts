// The directory release against a real database (S02.05): the publish job as the app's own role
// (cvh_app_login), with a store of the test's own. Covers the release files and the manifest, the
// atomic current-release pointer, resuming a stopped job, giving up after three failures, the locks
// that make a publish safe against provider changes and other publishes, what a complete release
// may and may not become, and what the app's role may do to the tables.
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import { DirectoryListingV1, DirectoryManifestV1, ListingTextSchema } from "@/contracts/directory";
import { LANG_CODES } from "@/contracts/lang";
import { record, recordRefusal } from "@/modules/audit";
import {
  PUBLISH_FAILURE_CODES,
  currentManifest,
  currentReleaseSummary,
  estimateTokens,
  latestReleaseSummary,
  memoryDirectoryStorage,
  publishDirectory,
  publishProvider,
  readListing,
  seedProviders,
  unpublishProvider,
  confirmProvider,
  type ProviderCatalogueInput,
  type PublishDeps,
  type PublishFailure,
} from "@/modules/directory";
import { directoryRelease } from "@/modules/directory/adapters/schema";
import { VectorsFileSchema } from "@/modules/directory/domain/searchData";
import { catalogueTextId } from "@/modules/directory/adapters/hash";
import { PUBLISH_LOCK_KEY } from "@/modules/directory/application/publishLock";
import { recordOpsEvent } from "@/modules/ops";
import { SPEND_LOCK_KEY } from "@/modules/spend";
import { createDb, type Db } from "@/platform/db";
import { sha256Hex } from "@/platform/hash";
import { connect, serverUrl } from "./helpers";

// The real audit module writes audit_event; the spy only lets a test make it fail once.
vi.mock("@/modules/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/audit")>();
  return { ...actual, record: vi.fn(actual.record), recordRefusal: vi.fn(actual.recordRefusal) };
});

// The Hub's neighbourhood list (data/catalogue/provider-neighbourhoods.json) as the tests publish it: one of each kind.
const NEIGHBOURHOODS: Record<string, readonly ("TP" | "FP")[]> = { M001: ["TP"], M002: ["FP"], M003: [], M004: [], M005: [], M010: ["TP", "FP"] };

const ENGLISH = "Free legal help. Call 911 in an emergency.";
const UR = "مفت قانونی مدد۔ 911 پر کال کریں۔";
const ZH = "免费软务。紧急情况请拨打 911。";
const prov = (english: string, change: Record<string, unknown> = {}) => ({
  model: "command-a-translate",
  status: "reviewed",
  reviewer: "A. Reviewer",
  reviewedOn: "2026-09-01",
  sourceHash: sha256Hex(english),
  ...change,
});

describe("the directory release (S02.05)", () => {
  let sql: ReturnType<typeof connect>;
  let app: Db;
  let appSql: ReturnType<typeof connect>;
  let auditBaseline = 0;
  let mark = 0;
  const staffId = randomUUID();
  const audit = vi.mocked(record);
  const refusal = vi.mocked(recordRefusal);
  let owner: Db;

  async function wipe() {
    await sql.unsafe(`
      alter table directory_release disable trigger directory_release_guard;
      delete from directory_release;
      alter table directory_release enable trigger directory_release_guard;
      delete from ops_event;
      delete from spend_event;
      delete from catalogue_load;
      delete from provider_category; delete from provider_location; delete from provider; delete from category`);
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
    owner = createDb(serverUrl());
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
    await owner.$client.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    audit.mockClear();
    refusal.mockClear();
    await wipe();
    await load();
    [{ max: mark }] = await sql`select coalesce(max(id), 0)::int as max from audit_event`;
  });

  // ------------------------------------------------------------ the catalogue the tests publish from
  /**
   * M001, M002: published and confirmed (M001 with reviewed ur and zh translations, M002 with a stale zh);
   * M003: confirmed, not published; M004: not confirmed; M005: left the catalogue.
   */
  async function load() {
    // The seed ran with the catalogue this deployment carries (what deps().catalogue reports).
    await sql`insert into catalogue_load (hash, git_commit) values (${"b".repeat(64)}, 'abc1234def')`;
    await sql`insert into category (id, name, sort_order, labels, translations) values ('c-legal', 'Legal', 1, ${sql.json({ en: "Legal", ur: "قانونی" })}, ${sql.json({ ur: prov("Legal") })})`;
    await sql`insert into category (id, name, sort_order, labels) values ('c-health', 'Health', 2, ${sql.json({ en: "Health" })})`;
    const rows: [string, string, boolean, boolean, string | null, Record<string, string>, Record<string, unknown>][] = [
      ["M001", "Thorncliffe Legal Clinic", true, true, "2026-09-20", { en: ENGLISH, ur: UR, zh: ZH }, { ur: prov(ENGLISH), zh: prov(ENGLISH) }],
      ["M002", "Flemingdon Health Centre", true, true, "2026-09-21", { en: "Walk-in clinic.", zh: "门诊。" }, { zh: prov("An older walk-in clinic.") }],
      ["M003", "East York Food Bank", true, false, "2026-09-22", { en: "Food hampers." }, {}],
      ["M004", "Unconfirmed Kitchen", true, false, null, { en: "Meals." }, {}],
      ["M005", "Closed Community Kitchen", false, false, "2026-08-15", { en: "Meals." }, {}],
    ];
    for (const [id, name, inCatalogue, published, confirmed, services, translations] of rows) {
      await sql`
        insert into provider (id, name, texts, translations, in_catalogue, published, published_at, last_confirmed)
        values (${id}, ${name}, ${sql.json({ services })}, ${sql.json({ services: translations } as never)}, ${inCatalogue}, ${published}, ${published ? new Date("2026-09-30T12:00:00Z") : null}, ${confirmed})`;
      await sql`insert into provider_location (provider_id, street, city, postal, lat, lng) values (${id}, ${`${id.slice(1)} Overlea Blvd`}, 'East York', 'M4H 1C6', 43.7, -79.34)`;
      await sql`insert into provider_category (provider_id, category_id) values (${id}, ${id === "M002" ? "c-health" : "c-legal"})`;
    }
  }

  // ------------------------------------------------------------ the job's dependencies
  interface Harness extends PublishDeps {
    storage: ReturnType<typeof memoryDirectoryStorage>;
    failures: PublishFailure[];
  }
  function deps(change: Partial<Omit<PublishDeps, "storage">> & { storage?: Harness["storage"] } = {}): Harness {
    const storage = change.storage ?? memoryDirectoryStorage();
    const failures: PublishFailure[] = [];
    return {
      failures,
      catalogue: async () => ({ hash: "b".repeat(64), gitCommit: "abc1234def" }),
      neighbourhoods: async () => ({ reviewed: true, byProvider: NEIGHBOURHOODS }),
      zhHant: async () => ({ convert: (text: string) => text.replaceAll("软", "軟").replaceAll("务", "務"), openccVersion: "1.4.2", config: "test s2twp" }),
      onFailure: async (failure) => void failures.push(failure),
      sleep: async () => {},
      now: () => new Date("2026-10-02T15:00:00Z"),
      ...change,
      storage,
    };
  }
  const publish = (d: Harness) => publishDirectory(app, d, staffId);
  const releases = () => sql.unsafe("select number, status, is_current, attempts, failure, lease_token is not null as leased, staged is not null as staged from directory_release order by number").then((rows) => rows.map((r) => ({ ...r })));
  const auditOf = async (action: string) =>
    (await sql.unsafe("select actor_staff_id, subject_type, subject_id, outcome, meta from audit_event where id > $1 and action = $2 order by id", [mark, action])).map((e) => ({ ...e }));
  const listing = (d: Harness, release: number, lang: string) => DirectoryListingV1.parse(JSON.parse(d.storage.files.get(`releases/${release}/${lang}.json`) as string));
  const sleepMs = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const gate = () => {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => (open = resolve));
    return { promise, open };
  };
  /** True when the promise has not settled after a moment. */
  async function stillPending(promise: Promise<unknown>, ms = 400): Promise<boolean> {
    return (await Promise.race([promise.then(() => false, () => false), sleepMs(ms).then(() => true)])) as boolean;
  }

  // ------------------------------------------------------------ publishing
  describe("publishing", () => {
    it("writes one listing file per language, with only the published providers, and makes the release current", async () => {
      const d = deps();

      const result = await publish(d);

      expect(result).toMatchObject({ ok: true, release: 1, attempts: 1, resumedFiles: 0 });
      expect(await releases()).toEqual([{ number: 1, status: "complete", is_current: true, attempts: 1, failure: null, leased: false, staged: false }]);
      expect([...d.storage.files.keys()].sort()).toEqual(LANG_CODES.map((lang) => `releases/1/${lang}.json`).sort());
      for (const lang of LANG_CODES) {
        const file = listing(d, 1, lang);
        expect(file).toMatchObject({ v: 1, release_v: 1, lang, catalogue_hash: "b".repeat(64) });
        expect(file.providers.map((p) => p.id)).toEqual(["M001", "M002"]);
        expect(file.categories.map((c) => c.id)).toEqual(["c-legal", "c-health"]);
        for (const p of file.providers) expect(ListingTextSchema.safeParse(p.services).success).toBe(true);
      }
      expect(listing(d, 1, "ur").providers[0].services).toMatchObject({ status: "ok", body: UR, original: { body: ENGLISH } });
      // The unpublished, unconfirmed and removed providers appear nowhere.
      for (const body of d.storage.files.values()) for (const id of ["M003", "M004", "M005"]) expect(body).not.toContain(id);
    });

    it("writes each provider's neighbourhoods from the Hub's list into every language's file", async () => {
      const d = deps();

      await publish(d);

      for (const lang of LANG_CODES) expect(listing(d, 1, lang).providers.map((p) => [p.id, p.neighbourhood_ids])).toEqual([["M001", ["TP"]], ["M002", ["FP"]]]);
    });

    it("stops with invalid_catalogue, writing nothing, when a published provider is not in the Hub's neighbourhood list", async () => {
      const d = deps({ neighbourhoods: async () => ({ reviewed: false, byProvider: { M001: ["TP"] } }) });

      const result = await publish(d);

      expect(result).toEqual({ ok: false, reason: "invalid_catalogue", release: null, attempts: 1, detail: ["provider M002 is not in provider-neighbourhoods.json"] });
      expect(await releases()).toEqual([]);
      expect(d.storage.files.size).toBe(0);
    });

    it("a neighbourhood list that cannot be read is a catalogue_unreadable publish, not retried", async () => {
      const d = deps({ neighbourhoods: async () => Promise.reject(new Error("ENOENT: provider-neighbourhoods.json")), sleep: vi.fn(async () => {}) });

      expect(await publish(d)).toMatchObject({ ok: false, reason: "catalogue_unreadable", release: null, attempts: 1 });
      expect(d.sleep).not.toHaveBeenCalled();
      expect(await releases()).toEqual([]);
    });

    it("converts zh to zh-Hant with the conversion recorded, and withholds the stale zh with English and translation.unavailable", async () => {
      const d = deps();
      await publish(d);

      expect(listing(d, 1, "zh-Hant").providers[0].services).toMatchObject({
        status: "script_converted",
        body: "免费軟務。紧急情况请拨打 911。",
        conversion: { from: "zh", from_text_hash: sha256Hex(ZH), opencc_version: "1.4.2" },
      });
      // M002's recorded source hash is that of an older English text: neither zh nor zh-Hant ships.
      expect(listing(d, 1, "zh").providers[1].services).toMatchObject({ status: "fallback_en", body: "Walk-in clinic.", notice: "translation.unavailable" });
      expect(listing(d, 1, "zh-Hant").providers[1].services).toMatchObject({ status: "fallback_en", body: "Walk-in clinic." });
      // A language with no translation at all shows the English too.
      expect(listing(d, 1, "hi").providers[0].services).toMatchObject({ status: "fallback_en", body: ENGLISH, notice: "translation.unavailable" });
      expect((await currentReleaseSummary(app))?.report.stale).toEqual([
        { subject: "M002", name: "Flemingdon Health Centre", text: "services", lang: "zh" },
        { subject: "M002", name: "Flemingdon Health Centre", text: "services", lang: "zh-Hant" },
      ]);
    });

    // The rows above are written by hand, with a translation the seed would never have loaded. The seed leaves the stale
    // translation out of `texts` and notes it in `withheld`; this goes through the seed to the report.
    it("reports a stale translation by provider name and language when the provider came through the real seed", async () => {
      await wipe();
      const text = "Free legal help. Call 911 in an emergency.";
      const catalogue = (source: string): ProviderCatalogueInput => ({
        catalogue: {
          labels: { categories: { Legal: { id: catalogueTextId("Legal"), en: "Legal" } }, subcategories: {} },
          providers: [
            {
              id: "M010",
              name: "Legal Aid Ontario",
              categories: ["Legal"],
              subcategories: [],
              address: { street: "1 Overlea Blvd", city: "East York", postal: "M4H 1C6" },
              location: { lat: 43.7, lng: -79.34 },
              contact: { phone: [], email: [], social: [], web: [] },
              services: { id: catalogueTextId(text), en: text },
              emergencyRole: null,
              sourceNotes: [],
              lastConfirmed: null,
            },
          ],
        },
        translations: {
          ur: { texts: { [catalogueTextId(text)]: { source, text: UR, model: "command-a-translate", status: "reviewed", reviewer: "A. Reviewer", reviewedOn: "2026-09-01" } } },
        },
      });
      const version = { hash: "b".repeat(64), gitCommit: "abc1234def" };
      await seedProviders(owner, catalogue("An older English text."), version);
      await confirmProvider(app, staffId, "M010", "2026-09-30", { now: () => new Date("2026-10-02T15:00:00Z") });
      await publishProvider(app, staffId, "M010", { now: () => new Date("2026-10-02T15:00:00Z") });
      const d = deps();

      const first = await publish(d);

      // The row holds the English only: the stale Urdu is nowhere in it, yet the release reports it.
      expect((await sql`select texts, withheld from provider where id = 'M010'`)[0]).toMatchObject({ texts: { services: { en: text } }, withheld: { services: { ur: "stale" } } });
      expect(first).toMatchObject({ ok: true, release: 1, counts: { stale: 1 } });
      expect((await currentReleaseSummary(app))?.report.stale).toEqual([{ subject: "M010", name: "Legal Aid Ontario", text: "services", lang: "ur" }]);
      expect(listing(d, 1, "ur").providers[0].services).toMatchObject({ status: "fallback_en", body: text, notice: "translation.unavailable" });

      // Retranslated and reviewed: the next release has nothing stale.
      await seedProviders(owner, catalogue(text), version);
      expect(await publish(d)).toMatchObject({ ok: true, release: 2, counts: { stale: 0 } });
      expect((await currentReleaseSummary(app))?.report.stale).toEqual([]);
      expect(listing(d, 2, "ur").providers[0].services).toMatchObject({ status: "ok", body: UR });
    });

    it("records the source version, the files' hashes and the counts, and audits directory.published with the release number and counts", async () => {
      const d = deps();
      await publish(d);

      const [row] = await sql`select catalogue_hash, git_commit, files, counts, started_by, published_at, current_since, search from directory_release where number = 1`;
      expect(row.catalogue_hash).toBe("b".repeat(64));
      expect(row.git_commit).toBe("abc1234def");
      expect(row.started_by).toBe(staffId);
      expect(row.search).toBeNull();
      expect(row.published_at).toEqual(new Date("2026-10-02T15:00:00Z"));
      for (const lang of LANG_CODES) {
        const entry = row.files[lang];
        expect(entry.path).toBe(`releases/1/${lang}.json`);
        expect(entry.sha256).toBe(sha256Hex(d.storage.files.get(entry.path) as string));
        expect(entry.bytes).toBe(Buffer.byteLength(d.storage.files.get(entry.path) as string, "utf8"));
        expect(typeof entry.stored_at).toBe("string");
      }
      expect(row.counts).toMatchObject({ providers: 2, categories: 2, languages: 16, files: 16, stale: 2 });
      expect(await auditOf("directory.published")).toEqual([
        {
          actor_staff_id: staffId,
          subject_type: "directory_release",
          subject_id: "1",
          outcome: "ok",
          meta: expect.objectContaining({ release: 1, providers: 2, categories: 2, files: 16, stale: 2, attempts: 1, resumed_files: 0 }),
        },
      ]);
    });

    it("serves the manifest of the current release, and the next publish is a new, complete release with a new number", async () => {
      const d = deps();
      await publish(d);
      const first = await currentManifest(app);
      expect(DirectoryManifestV1.parse(first)).toMatchObject({ v: 1, release_v: 1, search: { status: "unavailable" } });
      expect(first?.files["zh-Hant"]).toBe("/api/directory/1/zh-Hant.json");
      expect(Object.keys(first?.files ?? {}).sort()).toEqual([...LANG_CODES].sort());

      expect(await unpublishProvider(app, staffId, "M002")).toMatchObject({ ok: true });
      const second = await publish(d);

      expect(second).toMatchObject({ ok: true, release: 2 });
      expect((await currentManifest(app))?.release_v).toBe(2);
      expect(listing(d, 2, "en").providers.map((p) => p.id)).toEqual(["M001"]);
      expect(await releases()).toMatchObject([
        { number: 1, status: "complete", is_current: false },
        { number: 2, status: "complete", is_current: true },
      ]);
    });

    it("never modifies an earlier release: its files, manifest entry and row stay as published", async () => {
      const d = deps();
      await publish(d);
      const files = new Map(d.storage.files);
      const [before] = await sql`select number, status, catalogue_hash, git_commit, counts, report, files, published_at from directory_release where number = 1`;

      await unpublishProvider(app, staffId, "M001");
      await publish(d);

      for (const [path, body] of files) expect(d.storage.files.get(path)).toBe(body);
      const [after] = await sql`select number, status, catalogue_hash, git_commit, counts, report, files, published_at from directory_release where number = 1`;
      expect(after).toEqual(before);
      // Release 1 still serves what it published, although it is no longer current.
      const read = await readListing(app, d.storage, "1", "en.json");
      expect(read).toMatchObject({ found: true });
      expect(JSON.parse((read as { body: string }).body).providers.map((p: { id: string }) => p.id)).toEqual(["M001", "M002"]);
    });

    it("publishes an empty directory as a valid release", async () => {
      await sql`update provider set published = false, published_at = null`;
      const d = deps();

      expect(await publish(d)).toMatchObject({ ok: true, release: 1, counts: { providers: 0, categories: 0 } });
      expect(listing(d, 1, "fr").providers).toEqual([]);
    });
  });

  // ------------------------------------------------------------ stopped part way, and giving up
  describe("a job that is stopped part way", () => {
    it("resumes from the last completed file, keeps the previous release current until every file is written, and a resident never sees a mix", async () => {
      const first = deps();
      await publish(first);
      expect((await currentManifest(app))?.release_v).toBe(1);

      // The second run dies after its 5th file (the function time limit): its promise never settles.
      const stopped = deps({
        storage: first.storage,
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[4]) await new Promise(() => {});
        },
      });
      void publish(stopped);
      while (first.storage.puts.filter((path) => path.startsWith("releases/2/")).length < 5) await sleepMs(20);
      await sleepMs(100);

      // Nothing of release 2 is visible: the manifest still names release 1, and release 2 has no readable file.
      expect((await currentManifest(app))?.release_v).toBe(1);
      expect(await readListing(app, first.storage, "2", "en.json")).toEqual({ found: false, reason: "not_found" });
      expect(await releases()).toMatchObject([
        { number: 1, is_current: true },
        { number: 2, status: "building", is_current: false, leased: true },
      ]);
      // While that run's claim is live, another press is refused.
      expect(await publish(deps({ storage: first.storage }))).toMatchObject({ ok: false, reason: "publish_running", release: null });

      // Later, the claim has expired: the next run resumes release 2, writing only the files that are missing.
      const putsBefore = first.storage.puts.length;
      const later = deps({ storage: first.storage, now: () => new Date("2026-10-02T15:10:00Z") });
      const result = await publish(later);

      expect(result).toMatchObject({ ok: true, release: 2, attempts: 2, resumedFiles: 5 });
      const written = first.storage.puts.slice(putsBefore);
      expect(written).toHaveLength(11);
      expect(new Set(written).size).toBe(11);
      expect(written).toEqual(LANG_CODES.slice(5).map((lang) => `releases/2/${lang}.json`));
      expect((await currentManifest(app))?.release_v).toBe(2);
      // Every file of release 2 comes from the one snapshot.
      const lists = LANG_CODES.map((lang) => listing(first, 2, lang).providers.map((p) => p.id).join());
      expect(new Set(lists).size).toBe(1);
      expect(await auditOf("directory.published")).toMatchObject([
        { subject_id: "1", outcome: "ok" },
        { subject_id: null, outcome: "refused", meta: { reason: "publish_running" } },
        { subject_id: "2", outcome: "ok", meta: { release: 2, resumed_files: 5, attempts: 2 } },
      ]);
    });

    it("resumes the snapshot it was built from, even if a provider changed in between", async () => {
      const first = deps();
      const stopped = deps({
        storage: first.storage,
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[2]) await new Promise(() => {});
        },
      });
      void publish(stopped);
      while (first.storage.puts.length < 3) await sleepMs(20);
      await sleepMs(100);
      expect(await unpublishProvider(app, staffId, "M002")).toMatchObject({ ok: true });

      const result = await publish(deps({ storage: first.storage, now: () => new Date("2026-10-02T15:10:00Z") }));

      expect(result).toMatchObject({ ok: true, release: 1, resumedFiles: 3 });
      // The release is the complete set as of its snapshot: M002 is in every file, including the ones written after the change.
      for (const lang of LANG_CODES) expect(listing(first, 1, lang).providers.map((p) => p.id)).toEqual(["M001", "M002"]);
    });

    it("does not resume a build too old to publish as 'now': it is closed and a new release is built from the providers as they are", async () => {
      const first = deps();
      const stopped = deps({
        storage: first.storage,
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[1]) await new Promise(() => {});
        },
      });
      void publish(stopped);
      while (first.storage.puts.length < 2) await sleepMs(20);
      await sleepMs(100);
      await unpublishProvider(app, staffId, "M002");

      const result = await publish(deps({ storage: first.storage, now: () => new Date("2026-10-02T18:00:00Z") }));

      expect(result).toMatchObject({ ok: true, release: 2, resumedFiles: 0 });
      expect(await releases()).toMatchObject([{ number: 1, status: "failed", failure: "abandoned" }, { number: 2, status: "complete", is_current: true }]);
      expect(listing(first, 2, "en").providers.map((p) => p.id)).toEqual(["M001"]);
      expect(first.failures).toEqual([]);
    });
  });

  describe("a publish that fails", () => {
    const alwaysFailing = (d: Harness): Harness => {
      const storage = d.storage;
      storage.put = async () => {
        throw new Error("the store is down");
      };
      return d;
    };

    it("gives up after three failures: the previous release stays current, the failure goes to ops_event and the audit trail", async () => {
      const first = deps();
      await publish(first);
      const failing = alwaysFailing(deps({ sleep: vi.fn(async () => {}), onFailure: async (failure) => recordOpsEvent(app, { kind: "directory.publish_failed", subjectType: "directory_release", subjectId: String(failure.release), detail: { reason: failure.reason, attempts: failure.attempts, files_stored: failure.filesStored } }) }));

      const result = await publish(failing);

      expect(result).toEqual({ ok: false, reason: "storage_unavailable", release: 2, attempts: 3, detail: [] });
      expect(failing.sleep).toHaveBeenCalledTimes(2);
      expect(await releases()).toMatchObject([
        { number: 1, status: "complete", is_current: true },
        { number: 2, status: "failed", is_current: false, attempts: 3, failure: "storage_unavailable", leased: false, staged: false },
      ]);
      expect((await currentManifest(app))?.release_v).toBe(1);
      expect(await readListing(app, first.storage, "2", "en.json")).toEqual({ found: false, reason: "not_found" });
      const events = await sql`select kind, severity, subject_type, subject_id, detail from ops_event`;
      expect(events.map((e) => ({ ...e }))).toEqual([
        { kind: "directory.publish_failed", severity: "error", subject_type: "directory_release", subject_id: "2", detail: { reason: "storage_unavailable", attempts: 3, files_stored: 0 } },
      ]);
      expect(await auditOf("directory.published")).toMatchObject([
        { subject_id: "1", outcome: "ok" },
        { subject_id: "2", outcome: "refused", meta: { reason: "publish_failed", failure: "storage_unavailable" } },
      ]);
      expect((await latestReleaseSummary(app))?.failure).toBe("storage_unavailable");
    });

    it("succeeds when a retry works, and records no failure", async () => {
      const d = deps();
      const put = d.storage.put.bind(d.storage);
      let calls = 0;
      d.storage.put = async (path, body) => {
        calls += 1;
        if (calls <= 2) throw new Error("the store hiccupped");
        await put(path, body);
      };

      const result = await publish(d);

      expect(result).toMatchObject({ ok: true, release: 1, attempts: 3 });
      expect(d.failures).toEqual([]);
      expect(await releases()).toMatchObject([{ number: 1, status: "complete", attempts: 3, is_current: true }]);
    });

    it("a failed release is closed for good: it cannot be reopened, completed or made current", async () => {
      await publish(alwaysFailing(deps()));
      await expect(sql.unsafe("update directory_release set status = 'building', failure = null where number = 1")).rejects.toThrow(/cannot be changed/);
      await expect(sql.unsafe("update directory_release set is_current = true where number = 1")).rejects.toThrow(/directory_release_current_is_complete/);
    });

    it("does not retry a failure retrying cannot fix: a provider with no English text names itself and no release is made", async () => {
      await sql`update provider set texts = ${sql.json({ services: { ur: UR } })} where id = 'M001'`;
      const d = deps({ sleep: vi.fn(async () => {}) });

      const result = await publish(d);

      expect(result).toEqual({ ok: false, reason: "invalid_catalogue", release: null, attempts: 1, detail: ["provider M001 has no English services text"] });
      expect(d.sleep).not.toHaveBeenCalled();
      expect(await releases()).toEqual([]);
      expect(d.failures).toEqual([{ release: null, reason: "invalid_catalogue", attempts: 1, filesStored: 0 }]);
    });

    it("a catalogue that cannot be read (its files are not in the function) is a failed publish of its own kind, not retried", async () => {
      const d = deps({ catalogue: async () => Promise.reject(new Error("ENOENT: data/catalogue")), sleep: vi.fn(async () => {}) });

      expect(await publish(d)).toMatchObject({ ok: false, reason: "catalogue_unreadable", release: null, attempts: 1 });
      expect(d.sleep).not.toHaveBeenCalled();
      expect(await releases()).toEqual([]);
      expect(d.failures).toEqual([{ release: null, reason: "catalogue_unreadable", attempts: 1, filesStored: 0 }]);
      expect(await auditOf("directory.published")).toMatchObject([{ outcome: "refused", meta: { reason: "publish_failed", failure: "catalogue_unreadable" } }]);
    });

    it("a build stopped three times, found by the next press, is closed as gave_up and that failure is the answer; the press after it builds", async () => {
      const first = deps();
      const stopped = deps({
        storage: first.storage,
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[0]) await new Promise(() => {});
        },
      });
      void publish(stopped);
      while (first.storage.puts.length < 1) await sleepMs(20);
      await sleepMs(100);
      await sql`update directory_release set attempts = 3 where number = 1`;

      const d = deps({ storage: first.storage, now: () => new Date("2026-10-02T15:05:00Z") });
      const result = await publish(d);

      // The Admin is told, in this press: nothing is built in the same breath.
      expect(result).toEqual({ ok: false, reason: "gave_up", release: 1, attempts: 3, detail: [] });
      expect(await releases()).toMatchObject([{ number: 1, status: "failed", failure: "gave_up", attempts: 3 }]);
      expect(d.failures).toEqual([{ release: 1, reason: "gave_up", attempts: 3, filesStored: 1 }]);
      expect(await auditOf("directory.published")).toMatchObject([{ subject_id: "1", outcome: "refused", meta: { reason: "publish_failed", failure: "gave_up" } }]);

      // The next press builds a new release, and the gave_up failure is not told a second time.
      expect(await publish(d)).toMatchObject({ ok: true, release: 2 });
      expect(await releases()).toMatchObject([{ number: 1, status: "failed", failure: "gave_up", attempts: 3 }, { number: 2, status: "complete", is_current: true }]);
      expect(d.failures).toHaveLength(1);
    });

    it("rolls the whole completion back when the audit record cannot be written: the previous release stays current", async () => {
      const first = deps();
      await publish(first);
      audit.mockImplementationOnce(async () => {
        throw new Error("audit is down");
      });

      const d = deps({ storage: first.storage, maxAttempts: 1 });
      const result = await publish(d);

      expect(result).toMatchObject({ ok: false, release: 2 });
      expect((await currentManifest(app))?.release_v).toBe(1);
      expect(await releases()).toMatchObject([{ number: 1, is_current: true }, { number: 2, status: "failed", is_current: false }]);
    });

    it("every failure code the job can give is one ops_event accepts", async () => {
      const { PUBLISH_FAILURE_REASONS } = await import("@/modules/ops");
      expect([...PUBLISH_FAILURE_CODES].sort()).toEqual([...PUBLISH_FAILURE_REASONS].sort());
    });
  });

  // ------------------------------------------------------------ the catalogue the database holds
  describe("the catalogue the database holds (catalogue_load)", () => {
    const loaded = (hash: string, commit: string | null = null) => sql`insert into catalogue_load (hash, git_commit) values (${hash}, ${commit})`;
    const toOps = (failure: PublishFailure) =>
      recordOpsEvent(app, { kind: "directory.publish_failed", ...(failure.release === null ? {} : { subjectType: "directory_release", subjectId: String(failure.release) }), detail: { reason: failure.reason, attempts: failure.attempts, files_stored: failure.filesStored } });

    it("refuses to publish when the latest load is not the catalogue this deployment carries: nothing is built, ops_event and the audit trail hear of it, the Admin is told what to run", async () => {
      await sql`delete from catalogue_load`;
      await loaded("a".repeat(64), "1111111");
      const d = deps({ onFailure: toOps, sleep: vi.fn(async () => {}) });

      const result = await publish(d);

      expect(result).toEqual({
        ok: false,
        reason: "catalogue_not_loaded",
        release: null,
        attempts: 1,
        detail: [],
        catalogue: { loaded: "a".repeat(64), deployed: "b".repeat(64), commit: "abc1234def" },
      });
      // Retrying cannot fix it, and nothing was written to the store or the release table.
      expect(d.sleep).not.toHaveBeenCalled();
      expect(d.storage.puts).toEqual([]);
      expect(await releases()).toEqual([]);
      expect((await sql`select kind, subject_id, detail from ops_event`).map((e) => ({ ...e }))).toEqual([
        { kind: "directory.publish_failed", subject_id: null, detail: { reason: "catalogue_not_loaded", attempts: 1, files_stored: 0 } },
      ]);
      expect(await auditOf("directory.published")).toMatchObject([{ subject_id: null, outcome: "refused", meta: { reason: "publish_failed", failure: "catalogue_not_loaded" } }]);
    });

    it("refuses when the seed never ran (no load at all)", async () => {
      await sql`delete from catalogue_load`;

      expect(await publish(deps())).toMatchObject({ ok: false, reason: "catalogue_not_loaded", catalogue: { loaded: null, deployed: "b".repeat(64), commit: "abc1234def" } });
      expect(await releases()).toEqual([]);
    });

    it("the latest load decides: an older load of another catalogue does not matter, a newer one does", async () => {
      await sql`delete from catalogue_load`;
      await loaded("a".repeat(64));
      await loaded("b".repeat(64));
      expect(await publish(deps())).toMatchObject({ ok: true, release: 1 });

      await loaded("c".repeat(64));
      expect(await publish(deps())).toMatchObject({ ok: false, reason: "catalogue_not_loaded", catalogue: { loaded: "c".repeat(64) } });
      expect(await releases()).toMatchObject([{ number: 1, is_current: true }]);
    });

    it("does not resume a build made for another catalogue: it is closed as abandoned and the new one is built", async () => {
      const first = deps();
      const stopped = deps({
        storage: first.storage,
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[1]) await new Promise(() => {});
        },
      });
      void publish(stopped);
      while (first.storage.puts.length < 2) await sleepMs(20);
      await sleepMs(100);
      // The app is deployed with another catalogue and the seed has loaded it.
      await loaded("c".repeat(64), "9999999");

      const result = await publish(deps({ storage: first.storage, now: () => new Date("2026-10-02T15:10:00Z"), catalogue: async () => ({ hash: "c".repeat(64), gitCommit: "9999999" }) }));

      expect(result).toMatchObject({ ok: true, release: 2, resumedFiles: 0 });
      expect(await releases()).toMatchObject([{ number: 1, status: "failed", failure: "abandoned" }, { number: 2, status: "complete", is_current: true }]);
      expect((await sql`select catalogue_hash from directory_release where number = 2`)[0].catalogue_hash).toBe("c".repeat(64));
    });

    it("is refused rather than resumed when the deployment and the database disagree, even for a build in progress", async () => {
      const first = deps();
      const stopped = deps({
        storage: first.storage,
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[0]) await new Promise(() => {});
        },
      });
      void publish(stopped);
      while (first.storage.puts.length < 1) await sleepMs(20);
      await sleepMs(100);
      await loaded("c".repeat(64));

      const result = await publish(deps({ storage: first.storage, now: () => new Date("2026-10-02T15:10:00Z") }));

      expect(result).toMatchObject({ ok: false, reason: "catalogue_not_loaded" });
      expect(await releases()).toMatchObject([{ number: 1, status: "building" }]);
    });
  });

  // ------------------------------------------------------------ the lease, the clock and the audit trail
  describe("a failing job: the lease token, the time budget and the audit trail", () => {
    const failingStore = (d: Harness): Harness => {
      d.storage.put = async () => {
        throw new Error("the store is down");
      };
      return d;
    };

    it("a job whose claim was taken over cannot close the release that is now another job's: it answers publish_running and tells ops nothing", async () => {
      const putting = gate();
      const reached = gate();
      const slow = deps({ maxAttempts: 1 });
      // The store call hangs until the test lets it fail, long after another job took the claim over.
      slow.storage.put = async () => {
        reached.open();
        await putting.promise;
        throw new Error("the store is down");
      };
      const running = publish(slow);
      await reached.promise;
      const takerHeld = gate();
      const takerAt = gate();
      const taker = deps({
        now: () => new Date("2026-10-02T15:10:00Z"),
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[0]) {
            takerAt.open();
            await takerHeld.promise;
          }
        },
      });
      const taking = publish(taker);
      await takerAt.promise;
      expect(await releases()).toMatchObject([{ number: 1, status: "building", leased: true }]);

      putting.open();
      const lost = await running;

      // The release is still the taker's, building, and the first job told no one it failed.
      expect(lost).toMatchObject({ ok: false, reason: "publish_running", release: 1 });
      expect(await releases()).toMatchObject([{ number: 1, status: "building", leased: true, attempts: 2 }]);
      expect(slow.failures).toEqual([]);
      expect(await sql`select id from ops_event`).toHaveLength(0);
      expect(await auditOf("directory.published")).toMatchObject([{ subject_id: "1", outcome: "refused", meta: { reason: "publish_running" } }]);
      takerHeld.open();
      expect(await taking).toMatchObject({ ok: true, release: 1 });
      expect(await releases()).toMatchObject([{ number: 1, status: "complete", is_current: true }]);
    });

    it("stops retrying when the time budget is spent: the lease is let go, ops hears of it, the release stays building and the next press resumes it", async () => {
      let t = Date.parse("2026-10-02T15:00:00Z");
      const slept: number[] = [];
      const d = failingStore(
        deps({
          now: () => new Date(t),
          sleep: async (ms) => {
            slept.push(ms);
            t += ms;
          },
          budgetMs: 1200,
        }),
      );

      const result = await publish(d);

      // Pass 1 fails and waits 500 ms (fits); pass 2 fails and would wait 1500 ms more: past the 1200 ms budget, so it stops there, not at three.
      expect(result).toEqual({ ok: false, reason: "storage_unavailable", release: 1, attempts: 2, detail: [] });
      expect(slept).toEqual([500]);
      expect(await releases()).toEqual([{ number: 1, status: "building", is_current: false, attempts: 2, failure: null, leased: false, staged: true }]);
      expect(d.failures).toEqual([{ release: 1, reason: "storage_unavailable", attempts: 2, filesStored: 0 }]);
      expect(await auditOf("directory.published")).toMatchObject([{ subject_id: "1", outcome: "refused", meta: { reason: "publish_failed", failure: "storage_unavailable" } }]);

      // The store is back: the next press resumes the same release (its third pass) without waiting for any lease to run out.
      const healthy = deps();
      expect(await publish(healthy)).toMatchObject({ ok: true, release: 1, attempts: 3 });
    });

    it("also stops after a slow file when the clock has run past the budget, leaving the files stored so far for the next press", async () => {
      let t = Date.parse("2026-10-02T15:00:00Z");
      const d = deps({ now: () => new Date(t), budgetMs: 40_000 });
      const put = d.storage.put.bind(d.storage);
      d.storage.put = async (path, body) => {
        await put(path, body);
        t += 25_000; // each file takes 25 s
      };

      const result = await publish(d);

      expect(result).toMatchObject({ ok: false, reason: "storage_unavailable", release: 1 });
      expect(d.storage.puts).toHaveLength(2);
      expect(await releases()).toMatchObject([{ number: 1, status: "building", leased: false }]);
      expect(d.failures).toEqual([{ release: 1, reason: "storage_unavailable", attempts: 1, filesStored: 2 }]);
      const next = deps({ storage: d.storage });
      expect(await publish(next)).toMatchObject({ ok: true, release: 1, resumedFiles: 2 });
    });

    it("a refusal that cannot be written to the audit trail never turns the answer into a crash", async () => {
      // A failed publish ...
      refusal.mockImplementationOnce(async () => {
        throw new Error("audit is down");
      });
      expect(await publish(failingStore(deps()))).toMatchObject({ ok: false, reason: "storage_unavailable", release: 1 });
      expect(await releases()).toMatchObject([{ number: 1, status: "failed", failure: "storage_unavailable" }]);

      // ... and a publish refused because another is running.
      const held = gate();
      const reached = gate();
      const first = deps({
        hook: async (point) => {
          if (point === "snapshot_taken") {
            reached.open();
            await held.promise;
          }
        },
      });
      const running = publish(first);
      await reached.promise;
      refusal.mockImplementationOnce(async () => {
        throw new Error("audit is down");
      });
      expect(await publish(deps({ storage: first.storage }))).toMatchObject({ ok: false, reason: "publish_running" });
      held.open();
      expect(await running).toMatchObject({ ok: true });
    });

    it("reads one language's staged text at a time, never the whole staged column", async () => {
      const selected: unknown[] = [];
      const spy = new Proxy(app, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver);
          if (prop === "select") {
            return (...args: unknown[]) => {
              selected.push(args[0]);
              return (value as (...a: unknown[]) => unknown).apply(target, args);
            };
          }
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as Db;

      expect(await publishDirectory(spy, deps(), staffId)).toMatchObject({ ok: true, release: 1 });

      const columns = selected.filter((fields): fields is Record<string, unknown> => typeof fields === "object" && fields !== null).flatMap((fields) => Object.values(fields));
      expect(columns).not.toContain(directoryRelease.staged);
      expect(columns.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------ the seed and the publish exclude each other
  describe("the seed and a publish", () => {
    const seedInput = (): ProviderCatalogueInput => ({
      catalogue: {
        labels: { categories: { Seeded: { id: catalogueTextId("Seeded"), en: "Seeded" } }, subcategories: {} },
        providers: [
          {
            id: "M001",
            name: "Renamed By The Seed",
            categories: ["Seeded"],
            subcategories: [],
            address: { street: "1 Overlea Blvd", city: "East York", postal: "M4H 1C6" },
            location: { lat: 43.7, lng: -79.34 },
            contact: { phone: [], email: [], social: [], web: [] },
            services: { id: catalogueTextId("Free legal help."), en: "Free legal help." },
            emergencyRole: null,
            sourceNotes: [],
            lastConfirmed: null,
          },
        ],
      },
      translations: {},
    });
    const version = { hash: "b".repeat(64), gitCommit: "abc1234def" };

    it("a seed waits for the publish lock: it cannot run while a claim holds it", async () => {
      const release = gate();
      const locked = gate();
      // Its own connection: `sql` has one, and the test reads through it meanwhile.
      const holder = connect(serverUrl());
      const holding = holder.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(${PUBLISH_LOCK_KEY})`;
        locked.open();
        await release.promise;
      });
      await locked.promise;

      const seeding = seedProviders(owner, seedInput(), version);

      expect(await stillPending(seeding)).toBe(true);
      expect((await sql`select name from provider where id = 'M001'`)[0].name).toBe("Thorncliffe Legal Clinic");
      release.open();
      await holding;
      await holder.end({ timeout: 5 });
      await expect(seeding).resolves.toBeDefined();
    });

    it("a seed cannot change the providers while a claim is taking its snapshot: the release is the providers as they were", async () => {
      const held = gate();
      const reached = gate();
      const d = deps({
        hook: async (point) => {
          if (point === "snapshot_locked") {
            reached.open();
            await held.promise;
          }
        },
      });
      const publishing = publish(d);
      await reached.promise;

      const seeding = seedProviders(owner, seedInput(), version);
      expect(await stillPending(seeding)).toBe(true);
      expect((await sql`select name from provider where id = 'M001'`)[0].name).toBe("Thorncliffe Legal Clinic");
      held.open();
      const result = await publishing;
      await seeding;

      expect(result).toMatchObject({ ok: true, release: 1 });
      expect(listing(d, 1, "en").providers.map((p) => [p.id, p.name])).toEqual([["M001", "Thorncliffe Legal Clinic"], ["M002", "Flemingdon Health Centre"]]);
      // The seed ran after the claim: M001 is now the seed's.
      expect((await sql`select name from provider where id = 'M001'`)[0].name).toBe("Renamed By The Seed");
    });
  });

  // ------------------------------------------------------------ search data (S03.02)
  describe("search data of a release", () => {
    const MODEL = "embed-v4.0";
    /** A vector that depends only on the text, like a real embedding: four numbers from its hash. */
    const vectorOf = (text: string) => [0, 4, 8, 12].map((at) => parseInt(sha256Hex(text).slice(at, at + 4), 16) / 65535);

    /** A fake of the embedding model: records every call, and fails or stalls on the calls a test names. */
    function fakeEmbedder(options: { model?: string; failCalls?: number[]; stallCalls?: number[]; tokens?: number | null; dims?: number | null; inputType?: string } = {}) {
      const calls: string[][] = [];
      const signals: AbortSignal[] = [];
      const embedder = {
        model: options.model ?? MODEL,
        config: { model: options.model ?? MODEL, inputType: options.inputType ?? "search_document", embeddingType: "float", dims: options.dims ?? null },
        async embedDocuments(texts: string[], { signal }: { signal: AbortSignal }) {
          calls.push(texts);
          signals.push(signal);
          const n = calls.length;
          if (options.failCalls?.includes(n)) throw new Error("the embedding service is down");
          if (options.stallCalls?.includes(n)) await new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
          return { vectors: texts.map(vectorOf), tokens: options.tokens === undefined ? texts.join(" ").length : options.tokens };
        },
      };
      return { embedder, calls, signals };
    }
    const searchOf = (embedder: ReturnType<typeof fakeEmbedder>["embedder"], change: Partial<NonNullable<PublishDeps["search"]>> = {}): NonNullable<PublishDeps["search"]> => ({
      embedder,
      threshold: 0.3,
      emergencyCategories: ["Health"],
      allowance: { callsPerMonth: 100, tokensPerMonth: 1_000_000 },
      ...change,
    });
    const vectorsOf = (d: Harness, release: number) => VectorsFileSchema.parse(JSON.parse(d.storage.files.get(`releases/${release}/vectors.json`) as string));
    const searchRow = async (release: number) => (await sql`select search from directory_release where number = ${release}`)[0].search;
    const spend = () => sql.unsafe("select kind, purpose, model, release_v, calls, tokens, tokens_estimated, price_per_million_tokens_cad, ms from spend_event order by id").then((rows) => rows.map((r) => ({ ...r, tokens: Number(r.tokens) }) as Record<string, unknown>));
    const M001_TEXT = "Thorncliffe Legal Clinic\nCategories: Legal\nServices: Free legal help. Call 911 in an emergency.";
    const M002_TEXT = "Flemingdon Health Centre\nCategories: Health\nServices: Walk-in clinic.";

    it("a release published without a search model has none, and the manifest says search is unavailable", async () => {
      const d = deps();

      const result = await publish(d);

      expect(result).toMatchObject({ ok: true, search: null });
      expect((await currentManifest(app))?.search).toEqual({ status: "unavailable" });
      expect(await searchRow(1)).toBeNull();
      expect([...d.storage.files.keys()].some((path) => path.includes("vectors"))).toBe(false);
      expect(await spend()).toEqual([]);
    });

    it("embeds each published provider's search text once as a document and writes the vectors file into the same release", async () => {
      const model = fakeEmbedder();
      const d = deps({ search: searchOf(model.embedder) });

      const result = await publish(d);

      expect(result).toMatchObject({ ok: true, release: 1, search: { vectors: 2, reused: 0, embedded: 2 } });
      // One call, with the English search text of the two published providers: no contact details, address or other language.
      expect(model.calls).toEqual([[M001_TEXT, M002_TEXT]]);
      const file = vectorsOf(d, 1);
      expect(file).toMatchObject({ v: 1, release_v: 1, catalogue_hash: "b".repeat(64), embed_model: MODEL, dims: 4 });
      expect(file.providers).toEqual([
        { id: "M001", text_hash: sha256Hex(M001_TEXT), vector: vectorOf(M001_TEXT) },
        { id: "M002", text_hash: sha256Hex(M002_TEXT), vector: vectorOf(M002_TEXT) },
      ]);
      expect(file.providers.map((p) => p.id)).toEqual(listing(d, 1, "en").providers.map((p) => p.id));
      // The release records the model, vector count, catalogue_hash, threshold and emergency categories.
      const body = d.storage.files.get("releases/1/vectors.json") as string;
      expect(await searchRow(1)).toMatchObject({
        embed_model: MODEL,
        vectors_path: "releases/1/vectors.json",
        catalogue_hash: "b".repeat(64),
        release_v: 1,
        vector_count: 2,
        dims: 4,
        threshold: 0.3,
        emergency_categories: ["Health"],
        sha256: sha256Hex(body),
        bytes: Buffer.byteLength(body, "utf8"),
        reused: 0,
        embedded: 2,
      });
      expect((await releases())[0]).toMatchObject({ status: "complete", is_current: true, staged: false });
    });

    it("the manifest of a release with matching search data says it is available, with the model and the vectors path", async () => {
      const d = deps({ search: searchOf(fakeEmbedder().embedder) });
      await publish(d);

      const manifest = await currentManifest(app);

      expect(manifest?.search).toEqual({ status: "available", embed_model: MODEL, vectors_path: "releases/1/vectors.json" });
      expect(DirectoryManifestV1.parse(manifest)).toMatchObject({ release_v: 1 });
    });

    it("keeps the vectors file private: no resident route reads it, and the listing reader refuses it by every name", async () => {
      const d = deps({ search: searchOf(fakeEmbedder().embedder) });
      await publish(d);

      for (const file of ["vectors.json", "vectors", "../1/vectors.json", "en/../vectors.json"]) {
        expect(await readListing(app, d.storage, "1", file), file).toEqual({ found: false, reason: "not_found" });
      }
      // Nor does the manifest list it among the files a phone is told to fetch.
      expect(Object.values((await currentManifest(app))?.files ?? {}).some((path) => path.includes("vectors"))).toBe(false);
    });

    it("records each embedding call in spend_event: the model, the tokens the vendor billed and the release, with the price left null", async () => {
      const model = fakeEmbedder({ tokens: 321 });
      const d = deps({ search: searchOf(model.embedder) });

      await publish(d);

      expect(await spend()).toMatchObject([{ kind: "embed", purpose: "publish", model: MODEL, release_v: 1, calls: 1, tokens: 321, tokens_estimated: false, price_per_million_tokens_cad: null }]);
    });

    it("counts an estimate, and says so, when the vendor does not say how many tokens it billed", async () => {
      const d = deps({ search: searchOf(fakeEmbedder({ tokens: null }).embedder) });

      await publish(d);

      const [row] = await spend();
      expect(row).toMatchObject({ tokens_estimated: true });
      expect(Number(row.tokens)).toBeGreaterThan(0);
    });

    it("copies the previous release's vectors, instead of embedding again, when the model and catalogue_hash match", async () => {
      const model = fakeEmbedder();
      const first = deps({ search: searchOf(model.embedder) });
      await publish(first);
      const before = { file: first.storage.files.get("releases/1/vectors.json"), row: await searchRow(1) };

      const result = await publish(deps({ storage: first.storage, search: searchOf(model.embedder) }));

      // No second call, no second spend row, and the new release has its own file with its own release number.
      expect(model.calls).toHaveLength(1);
      expect(await spend()).toHaveLength(1);
      expect(result).toMatchObject({ ok: true, release: 2, search: { vectors: 2, reused: 2, embedded: 0 } });
      const copied = vectorsOf(first, 2);
      expect(copied).toMatchObject({ release_v: 2, catalogue_hash: "b".repeat(64), embed_model: MODEL });
      expect(copied.providers).toEqual(vectorsOf(first, 1).providers);
      expect(await searchRow(2)).toMatchObject({ vectors_path: "releases/2/vectors.json", release_v: 2, vector_count: 2, reused: 2, embedded: 0 });
      expect((await currentManifest(app))?.search).toMatchObject({ status: "available", vectors_path: "releases/2/vectors.json" });
      // The earlier release is exactly as it was published (S02.05): its file, its row, its listing files.
      expect(first.storage.files.get("releases/1/vectors.json")).toBe(before.file);
      expect(await searchRow(1)).toEqual(before.row);
      expect((await releases())[0]).toMatchObject({ number: 1, status: "complete", is_current: false });
    });

    it("embeds only the providers whose search text changed, or that are new, and drops the ones no longer published", async () => {
      const model = fakeEmbedder();
      const first = deps({ search: searchOf(model.embedder) });
      await publish(first);
      await sql`update provider set name = 'Flemingdon Family Health Centre' where id = 'M002'`;
      expect(await publishProvider(app, staffId, "M003", { now: () => new Date("2026-10-02T15:00:00Z") })).toMatchObject({ ok: true });
      expect(await unpublishProvider(app, staffId, "M001")).toMatchObject({ ok: true });

      const result = await publish(deps({ storage: first.storage, search: searchOf(model.embedder) }));

      expect(result).toMatchObject({ ok: true, release: 2, search: { vectors: 2, reused: 0, embedded: 2 } });
      expect(model.calls).toHaveLength(2);
      expect(model.calls[1].map((text) => text.split("\n")[0])).toEqual(["Flemingdon Family Health Centre", "East York Food Bank"]);
      expect(vectorsOf(first, 2).providers.map((p) => p.id)).toEqual(["M002", "M003"]);
      expect(listing(first, 2, "en").providers.map((p) => p.id)).toEqual(["M002", "M003"]);
    });

    it("copies only what is still true when the catalogue_hash differs: a text that did not change keeps its vector", async () => {
      const model = fakeEmbedder();
      const first = deps({ search: searchOf(model.embedder) });
      await publish(first);
      await sql`update catalogue_load set hash = ${"c".repeat(64)}`;

      const result = await publish(deps({ storage: first.storage, catalogue: async () => ({ hash: "c".repeat(64), gitCommit: "abc1234def" }), search: searchOf(model.embedder) }));

      expect(result).toMatchObject({ ok: true, search: { reused: 2, embedded: 0 } });
      expect(vectorsOf(first, 2)).toMatchObject({ release_v: 2, catalogue_hash: "c".repeat(64) });
    });

    it("embeds everything again when the model changed: a vector of one model is no use to another", async () => {
      const first = deps({ search: searchOf(fakeEmbedder().embedder) });
      await publish(first);
      const other = fakeEmbedder({ model: "embed-multilingual-v3.0" });

      const result = await publish(deps({ storage: first.storage, search: searchOf(other.embedder) }));

      expect(result).toMatchObject({ ok: true, release: 2, search: { reused: 0, embedded: 2 } });
      expect(other.calls).toHaveLength(1);
      expect(vectorsOf(first, 2).embed_model).toBe("embed-multilingual-v3.0");
      expect((await currentManifest(app))?.search).toMatchObject({ embed_model: "embed-multilingual-v3.0" });
    });

    it("works in chunks, and an empty directory publishes with an empty vectors file", async () => {
      const model = fakeEmbedder();
      const chunked = deps({ search: searchOf(model.embedder, { chunkSize: 1 }) });
      await publish(chunked);
      expect(model.calls.map((texts) => texts.length)).toEqual([1, 1]);
      expect((await spend()).map((row) => row.calls)).toEqual([1, 1]);

      await wipe();
      await sql`insert into catalogue_load (hash, git_commit) values (${"b".repeat(64)}, 'abc1234def')`;
      const empty = deps({ search: searchOf(model.embedder, { emergencyCategories: [] }) });
      const emptied = await publish(empty);
      expect(emptied, JSON.stringify(emptied)).toMatchObject({ ok: true, search: { vectors: 0, embedded: 0 } });
      expect(vectorsOf(empty, 1)).toMatchObject({ dims: 0, providers: [] });
    });

    // ---------------------------------------------------------- stopped, failing and slow embedding
    it("resumes from the last completed chunk when the job is stopped part way, and residents keep the previous release meanwhile", async () => {
      const first = deps();
      await publish(first);
      const model = fakeEmbedder();
      const stopped = deps({
        storage: first.storage,
        search: searchOf(model.embedder, { chunkSize: 1 }),
        hook: async (point) => {
          if (point === "chunk_embedded") await new Promise(() => {});
        },
      });
      void publish(stopped);
      while (model.calls.length < 1) await sleepMs(20);
      await sleepMs(150);

      // Nothing of release 2 is visible, and the first chunk is kept in the release.
      expect((await currentManifest(app))?.release_v).toBe(1);
      expect((await currentManifest(app))?.search).toEqual({ status: "unavailable" });
      expect(await releases()).toMatchObject([{ number: 1, is_current: true }, { number: 2, status: "building", leased: true }]);
      expect((await sql`select staged ? 'search_chunk_0' as kept, staged ? 'search_chunk_1' as more from directory_release where number = 2`)[0]).toEqual({ kept: true, more: false });

      // The claim expires: the next run embeds only what the kept chunk lacks.
      const later = fakeEmbedder();
      const result = await publish(deps({ storage: first.storage, now: () => new Date("2026-10-02T15:10:00Z"), search: searchOf(later.embedder, { chunkSize: 1 }) }));

      expect(result).toMatchObject({ ok: true, release: 2, attempts: 2, search: { vectors: 2, embedded: 2 } });
      expect(later.calls).toEqual([[M002_TEXT]]);
      expect(model.calls).toEqual([[M001_TEXT]]);
      expect(vectorsOf(first, 2).providers.map((p) => p.id)).toEqual(["M001", "M002"]);
      expect(await spend()).toHaveLength(2);
      expect((await currentManifest(app))?.release_v).toBe(2);
    });

    it("tries again after a failed call and does not embed the chunks it already has", async () => {
      const model = fakeEmbedder({ failCalls: [2] });
      const d = deps({ search: searchOf(model.embedder, { chunkSize: 1 }) });

      const result = await publish(d);

      expect(result).toMatchObject({ ok: true, release: 1, attempts: 2 });
      expect(model.calls).toEqual([[M001_TEXT], [M002_TEXT], [M002_TEXT]]);
      // The call that failed may have been billed: it is recorded too, as an estimate (the two that returned are as billed).
      const rows = await spend();
      expect(rows).toHaveLength(3);
      expect(rows.map((row) => row.tokens_estimated)).toEqual([false, true, false]);
      expect(rows[1]).toMatchObject({ kind: "embed", purpose: "publish", release_v: 1, calls: 1, tokens: estimateTokens([M002_TEXT]) });
      expect(d.failures).toEqual([]);
    });

    it("gives up after three failed passes: the previous release (with search) stays current, ops hears of it, and nothing of the new release is served", async () => {
      const first = deps({ search: searchOf(fakeEmbedder().embedder) });
      await publish(first);
      const down = fakeEmbedder({ failCalls: [1, 2, 3, 4, 5, 6] });
      const failing = deps({ storage: first.storage, search: searchOf(down.embedder) });
      await sql`update provider set name = 'Renamed Clinic' where id = 'M001'`;

      const result = await publish(failing);

      expect(result).toMatchObject({ ok: false, reason: "embedding_unavailable", release: 2, attempts: 3 });
      expect(down.calls).toHaveLength(3);
      expect(await releases()).toMatchObject([
        { number: 1, status: "complete", is_current: true },
        { number: 2, status: "failed", is_current: false, failure: "embedding_unavailable", staged: false },
      ]);
      expect(failing.failures).toMatchObject([{ release: 2, reason: "embedding_unavailable", attempts: 3 }]);
      expect(await currentManifest(app)).toMatchObject({ release_v: 1, search: { status: "available", vectors_path: "releases/1/vectors.json" } });
      expect(failing.storage.files.has("releases/2/vectors.json")).toBe(false);
      expect(await readListing(app, failing.storage, "2", "en.json")).toEqual({ found: false, reason: "not_found" });
    });

    it("cuts off a call that takes too long and treats it as a failed pass, not as a hung publish", async () => {
      const slow = fakeEmbedder({ stallCalls: [1] });
      const d = deps({ search: searchOf(slow.embedder, { callTimeoutMs: 30 }) });

      const result = await publish(d);

      // The first pass was cut off; the second worked.
      expect(result).toMatchObject({ ok: true, attempts: 2 });
      expect(slow.signals[0].aborted).toBe(true);
      expect(slow.calls).toHaveLength(2);
    });

    it("stops with the lease let go when the publish has no time left, keeping the build for the next press", async () => {
      let late = false;
      const model = fakeEmbedder();
      const d = deps({
        // The listing files are stored in time; the clock then runs past the budget before the first call.
        now: () => new Date(Date.parse("2026-10-02T15:00:00Z") + (late ? 60 * 1000 : 0)),
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[LANG_CODES.length - 1]) late = true;
        },
        budgetMs: 40 * 1000,
        search: searchOf(model.embedder),
      });

      const result = await publish(d);

      expect(result).toMatchObject({ ok: false, reason: "embedding_unavailable" });
      expect(model.calls).toHaveLength(0);
      expect((await releases())[0]).toMatchObject({ status: "building", leased: false });
    });

    // ---------------------------------------------------------- the usage allowance
    it("refuses to embed when the month's calls would pass the allowance, before any call is made", async () => {
      await sql`insert into spend_event (at, kind, purpose, model, calls, tokens) values (${new Date("2026-10-01T14:00:00Z")}, 'embed', 'publish', ${MODEL}, 3, 1000)`;
      const model = fakeEmbedder();
      const d = deps({ search: searchOf(model.embedder, { allowance: { callsPerMonth: 3, tokensPerMonth: 1_000_000 } }) });

      const result = await publish(d);

      expect(result).toMatchObject({ ok: false, reason: "usage_allowance_exceeded", release: 1, attempts: 1, detail: ["calls"] });
      expect(model.calls).toHaveLength(0);
      expect(d.failures).toMatchObject([{ release: 1, reason: "usage_allowance_exceeded" }]);
      // The build is not closed (that would throw away the chunks it has paid for): it waits, its lease let go.
      expect(await releases()).toMatchObject([{ number: 1, status: "building", failure: null, leased: false, staged: true }]);
      expect(await currentReleaseSummary(app)).toBeNull();
    });

    it("refuses when the tokens this release needs would pass the allowance, and keeps the previous release current", async () => {
      const first = deps({ search: searchOf(fakeEmbedder().embedder) });
      await publish(first);
      await sql`update provider set name = 'Another Name' where id = 'M002'`;
      const model = fakeEmbedder();
      const d = deps({ storage: first.storage, search: searchOf(model.embedder, { allowance: { callsPerMonth: 100, tokensPerMonth: 20 } }) });

      const result = await publish(d);

      expect(result).toMatchObject({ ok: false, reason: "usage_allowance_exceeded", detail: ["tokens"] });
      expect(model.calls).toHaveLength(0);
      expect((await currentManifest(app))?.release_v).toBe(1);
    });

    it("counts the calendar month in Toronto: last month's usage and a call that is only allowed once more are not over the line", async () => {
      // 2026-10-01 00:30 UTC is still September 30th in Toronto: last month's usage does not count against this month.
      await sql`insert into spend_event (at, kind, purpose, model, calls, tokens) values (${new Date("2026-10-01T00:30:00Z")}, 'embed', 'publish', ${MODEL}, 50, 900000)`;
      const model = fakeEmbedder();
      const d = deps({ search: searchOf(model.embedder, { allowance: { callsPerMonth: 1, tokensPerMonth: 1_000_000 } }) });

      const result = await publish(d);

      expect(result).toMatchObject({ ok: true });
      expect(model.calls).toHaveLength(1);
      // The next one, a month's allowance of one call spent, is refused.
      await sql`update provider set name = 'Yet Another Name' where id = 'M001'`;
      expect(await publish(deps({ storage: d.storage, search: searchOf(fakeEmbedder().embedder, { allowance: { callsPerMonth: 1, tokensPerMonth: 1_000_000 } }) }))).toMatchObject({
        ok: false,
        reason: "usage_allowance_exceeded",
      });
    });

    // ---------------------------------------------------------- the check before the release goes live
    /** Replaces the vectors file of the release being built, and the record that vouches for it, just before it is made current. */
    function tamper(change: (file: ReturnType<typeof vectorsOf>) => unknown, options: { record?: boolean } = { record: true }): NonNullable<PublishDeps["hook"]> {
      return async (point, detail) => {
        if (point !== "before_current") return;
        const path = `releases/${detail.release}/vectors.json`;
        const current = VectorsFileSchema.parse(JSON.parse(storageOf.files.get(path) as string));
        const body = JSON.stringify(change(current));
        storageOf.files.set(path, body);
        if (options.record) {
          const count = (JSON.parse(body) as { providers: unknown[] }).providers.length;
          await sql`update directory_release set search = search || ${sql.json({ sha256: sha256Hex(body), bytes: Buffer.byteLength(body, "utf8"), vector_count: count })} where number = ${detail.release}`;
        }
      };
    }
    let storageOf: ReturnType<typeof memoryDirectoryStorage>;

    it.each([
      ["another release number", (f: ReturnType<typeof vectorsOf>) => ({ ...f, release_v: 9 }), "release"],
      ["another catalogue_hash", (f: ReturnType<typeof vectorsOf>) => ({ ...f, catalogue_hash: "d".repeat(64) }), "catalogue"],
      ["another model than the release recorded", (f: ReturnType<typeof vectorsOf>) => ({ ...f, embed_model: "embed-v3.0" }), "model"],
      ["a provider the listing files have missing", (f: ReturnType<typeof vectorsOf>) => ({ ...f, providers: f.providers.slice(0, 1) }), "en:missing:M002"],
      [
        "a provider no listing file has",
        (f: ReturnType<typeof vectorsOf>) => ({ ...f, providers: [...f.providers, { id: "M009", text_hash: "e".repeat(64), vector: f.providers[0].vector }] }),
        "en:extra:M009",
      ],
    ])("refuses to make a release current when its vectors have %s: the previous release stays current and ops hears of it", async (_name, change, problem) => {
      const first = deps();
      await publish(first);
      storageOf = first.storage;
      const d = deps({ storage: first.storage, search: searchOf(fakeEmbedder().embedder), hook: tamper(change) });

      const result = await publish(d);

      expect(result).toMatchObject({ ok: false, reason: "search_mismatch", release: 2, attempts: 1 });
      expect((result as { detail: string[] }).detail).toContain(problem);
      expect((await currentManifest(app))?.release_v).toBe(1);
      expect((await currentManifest(app))?.search).toEqual({ status: "unavailable" });
      expect(await releases()).toMatchObject([{ number: 1, is_current: true }, { number: 2, status: "failed", failure: "search_mismatch", is_current: false }]);
      expect(d.failures).toMatchObject([{ release: 2, reason: "search_mismatch" }]);
      expect(await readListing(app, first.storage, "2", "en.json")).toEqual({ found: false, reason: "not_found" });
    });

    it("refuses a vectors file that is not the one the release recorded (its bytes differ from the record), or that is gone", async () => {
      const first = deps();
      await publish(first);
      storageOf = first.storage;
      const swapped = deps({ storage: first.storage, search: searchOf(fakeEmbedder().embedder), hook: tamper((f) => ({ ...f, providers: [] }), { record: false }) });

      expect(await publish(swapped)).toMatchObject({ ok: false, reason: "search_mismatch", detail: ["vectors_changed"] });

      const gone = deps({
        storage: first.storage,
        search: searchOf(fakeEmbedder().embedder),
        hook: async (point, detail) => {
          if (point === "before_current") first.storage.files.delete(`releases/${detail.release}/vectors.json`);
        },
      });
      expect(await publish(gone)).toMatchObject({ ok: false, reason: "search_mismatch", detail: ["vectors_missing"] });
      expect((await currentManifest(app))?.release_v).toBe(1);
    });

    it("checks again under the row lock that the vectors are still the ones it checked", async () => {
      const first = deps();
      await publish(first);
      storageOf = first.storage;
      const d = deps({
        storage: first.storage,
        search: searchOf(fakeEmbedder().embedder),
        hook: async (point, detail) => {
          // After the check and before the transaction: the record is swapped for another one's.
          if (point === "search_verified") await sql`update directory_release set search = search || ${sql.json({ sha256: "f".repeat(64) })} where number = ${detail.release}`;
        },
      });

      expect(await publish(d)).toMatchObject({ ok: false, reason: "search_mismatch", detail: ["vectors_changed"] });
      expect((await currentManifest(app))?.release_v).toBe(1);
    });

    // ---------------------------------------------------------- the review of S03.02
    const LATER = () => new Date("2026-10-02T15:10:00Z");
    const never = () => new Promise<never>(() => {});
    /** A build that stops for good after its first chunk (M001's) is kept: the next release stays building, its claim run out by LATER. */
    async function stopAfterFirstChunk(first: Harness, change: Partial<NonNullable<PublishDeps["search"]>> = {}) {
      const model = fakeEmbedder();
      void publish(
        deps({
          storage: first.storage,
          search: searchOf(model.embedder, { chunkSize: 1, ...change }),
          hook: async (point) => {
            if (point === "chunk_embedded") await never();
          },
        }),
      );
      while (model.calls.length < 1) await sleepMs(20);
      await sleepMs(150);
      return model;
    }
    const toOps = (failure: PublishFailure) =>
      recordOpsEvent(app, { kind: "directory.publish_failed", ...(failure.release === null ? {} : { subjectType: "directory_release", subjectId: String(failure.release) }), detail: { reason: failure.reason, attempts: failure.attempts, files_stored: failure.filesStored } });

    describe("a deployment without a search model", () => {
      it("is refused when the current release has search data: nothing is built, ops_event and the audit trail hear of it, and search stays on", async () => {
        const first = deps({ search: searchOf(fakeEmbedder().embedder) });
        await publish(first);
        const bare = deps({ storage: first.storage, onFailure: toOps });

        const result = await publish(bare);

        expect(result).toMatchObject({ ok: false, reason: "search_not_configured", release: null, detail: ["current_release_has_search"] });
        expect(await releases()).toMatchObject([{ number: 1, status: "complete", is_current: true }]);
        expect((await currentManifest(app))?.search).toMatchObject({ status: "available", vectors_path: "releases/1/vectors.json" });
        expect(bare.storage.puts.filter((path) => path.startsWith("releases/2/"))).toEqual([]);
        expect((await sql`select kind, subject_id, detail from ops_event`).map((e) => ({ ...e }))).toEqual([
          { kind: "directory.publish_failed", subject_id: null, detail: { reason: "search_not_configured", attempts: 1, files_stored: 0 } },
        ]);
        expect(await auditOf("directory.published")).toMatchObject([{}, { outcome: "refused", meta: { reason: "publish_failed", failure: "search_not_configured" } }]);
      });

      it("may still publish while no release has ever had search data", async () => {
        const first = deps();
        await publish(first);

        expect(await publish(deps({ storage: first.storage }))).toMatchObject({ ok: true, release: 2, search: null });
      });

      it("is refused even to resume a build that was planned with search data", async () => {
        const first = deps({ search: searchOf(fakeEmbedder().embedder) });
        await publish(first);
        await sql`update provider set name = 'Another Name' where id = 'M002'`;
        await stopAfterFirstChunk(first);

        const result = await publish(deps({ storage: first.storage, now: LATER }));

        expect(result).toMatchObject({ ok: false, reason: "search_not_configured" });
        expect((await currentManifest(app))?.release_v).toBe(1);
      });
    });

    describe("the usage allowance of the publish", () => {
      it("is checked for all the calls the build still needs before the first one is made", async () => {
        const model = fakeEmbedder();
        const d = deps({ search: searchOf(model.embedder, { chunkSize: 1, allowance: { callsPerMonth: 1, tokensPerMonth: 1_000_000 } }) });

        const result = await publish(d);

        expect(result).toMatchObject({ ok: false, reason: "usage_allowance_exceeded", detail: ["calls"] });
        expect(model.calls).toHaveLength(0);
        expect(await spend()).toEqual([]);
      });

      it("is checked for the tokens of all the remaining texts too, not just the next chunk's", async () => {
        const model = fakeEmbedder();
        const oneChunk = estimateTokens([M001_TEXT]);
        const d = deps({ search: searchOf(model.embedder, { chunkSize: 1, allowance: { callsPerMonth: 100, tokensPerMonth: oneChunk + 1 } }) });

        const result = await publish(d);

        expect(result).toMatchObject({ ok: false, reason: "usage_allowance_exceeded", detail: ["tokens"] });
        expect(model.calls).toHaveLength(0);
      });

      it("never destroys the chunks already kept: the lease is let go, the build stays, and the next press resumes it", async () => {
        const first = deps();
        await publish(first);
        await stopAfterFirstChunk(first);
        const none = fakeEmbedder();
        const refused = deps({ storage: first.storage, now: LATER, search: searchOf(none.embedder, { chunkSize: 1, allowance: { callsPerMonth: 1, tokensPerMonth: 1_000_000 } }) });

        const result = await publish(refused);

        expect(result).toMatchObject({ ok: false, reason: "usage_allowance_exceeded", release: 2, detail: ["calls"] });
        expect(none.calls).toHaveLength(0);
        expect(refused.failures).toMatchObject([{ release: 2, reason: "usage_allowance_exceeded" }]);
        expect(await releases()).toMatchObject([{ number: 1 }, { number: 2, status: "building", leased: false, staged: true }]);
        expect((await sql`select staged ? 'search_chunk_0' as kept from directory_release where number = 2`)[0].kept).toBe(true);

        // The allowance allows it again: the next press continues the same build after the kept chunk.
        const next = fakeEmbedder();
        const resumed = await publish(deps({ storage: first.storage, now: LATER, search: searchOf(next.embedder, { chunkSize: 1 }) }));

        expect(resumed).toMatchObject({ ok: true, release: 2, attempts: 3, search: { vectors: 2, embedded: 2 } });
        expect(next.calls).toEqual([[M002_TEXT]]);
      });

      it("counts the publish's own usage only: questions and test-set runs do not use up the publish allowance", async () => {
        await sql`insert into spend_event (at, kind, purpose, model, calls, tokens) values (${new Date("2026-10-01T14:00:00Z")}, 'embed', 'query', ${MODEL}, 500, 9000000), (${new Date("2026-10-01T15:00:00Z")}, 'embed', 'test_set', ${MODEL}, 500, 9000000)`;
        const model = fakeEmbedder();
        const first = deps({ search: searchOf(model.embedder, { allowance: { callsPerMonth: 3, tokensPerMonth: 100_000 } }) });

        expect(await publish(first)).toMatchObject({ ok: true });
        expect(model.calls).toHaveLength(1);

        // The publish's own call does count: an allowance of one call is spent by it.
        await sql`update provider set name = 'Another Name' where id = 'M002'`;
        const second = deps({ storage: first.storage, search: searchOf(fakeEmbedder().embedder, { allowance: { callsPerMonth: 1, tokensPerMonth: 100_000 } }) });
        expect(await publish(second)).toMatchObject({ ok: false, reason: "usage_allowance_exceeded", detail: ["calls"] });
      });

      it("never refuses a publish that needs no call, however little allowance is left", async () => {
        const first = deps({ search: searchOf(fakeEmbedder().embedder) });
        await publish(first);
        const idle = fakeEmbedder();

        const result = await publish(deps({ storage: first.storage, search: searchOf(idle.embedder, { allowance: { callsPerMonth: 1, tokensPerMonth: 1 } }) }));

        expect(result).toMatchObject({ ok: true, release: 2, search: { reused: 2, embedded: 0 } });
        expect(idle.calls).toHaveLength(0);
      });

      it("waits for the spend lock before it reads the allowance and makes a call", async () => {
        const holder = connect(serverUrl());
        const held = gate();
        const letGo = gate();
        const holding = holder.begin(async (tx) => {
          await tx`select pg_advisory_xact_lock(${SPEND_LOCK_KEY})`;
          held.open();
          await letGo.promise;
        });
        await held.promise;
        const model = fakeEmbedder();
        const running = publish(deps({ search: searchOf(model.embedder) }));

        expect(await stillPending(running)).toBe(true);
        expect(model.calls).toHaveLength(0);
        letGo.open();
        await holding;

        expect(await running).toMatchObject({ ok: true });
        expect(model.calls).toHaveLength(1);
        await holder.end({ timeout: 5 });
      });
    });

    describe("the time of a publish", () => {
      it("does not start a call that the time left cannot hold: out_of_time, without a call", async () => {
        const model = fakeEmbedder();
        // 10 s for the whole publish; one call may take 15 s.
        const d = deps({ budgetMs: 10 * 1000, search: searchOf(model.embedder) });

        const result = await publish(d);

        expect(result).toMatchObject({ ok: false, reason: "embedding_unavailable", detail: ["out_of_time"] });
        expect(model.calls).toHaveLength(0);
      });

      it("gives the write of the vectors file its own time limit: a store that hangs is a failed pass, not a hung publish", async () => {
        const store = memoryDirectoryStorage();
        let hung = false;
        const storage = {
          ...store,
          async put(path: string, body: string) {
            if (path.endsWith("vectors.json") && !hung) {
              hung = true;
              await never();
            }
            return store.put(path, body);
          },
        };
        const d = deps({ storage, search: searchOf(fakeEmbedder().embedder, { vectorsPutTimeoutMs: 30 }) });

        expect(await publish(d)).toMatchObject({ ok: true, attempts: 2 });
        expect(hung).toBe(true);
      });

      it("gives the read of the vectors file its own time limit too", async () => {
        const store = memoryDirectoryStorage();
        let hung = false;
        const storage = {
          ...store,
          async get(path: string) {
            if (path.endsWith("vectors.json") && !hung) {
              hung = true;
              await never();
            }
            return store.get(path);
          },
        };
        const d = deps({ storage, search: searchOf(fakeEmbedder().embedder, { vectorsGetTimeoutMs: 30 }) });

        expect(await publish(d)).toMatchObject({ ok: true, attempts: 2 });
        expect(hung).toBe(true);
      });

      it("records a call that was cut off as an estimate: it may have been billed", async () => {
        const slow = fakeEmbedder({ stallCalls: [1] });
        const d = deps({ search: searchOf(slow.embedder, { callTimeoutMs: 30 }) });

        expect(await publish(d)).toMatchObject({ ok: true, attempts: 2 });

        const rows = await spend();
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({ calls: 1, tokens: estimateTokens([M001_TEXT, M002_TEXT]), tokens_estimated: true, release_v: 1, purpose: "publish" });
        expect(rows[1]).toMatchObject({ tokens_estimated: false });
      });
    });

    describe("the embedding config", () => {
      const KEY = "model=embed-v4.0;input_type=search_document;embedding_type=float;dims=default";

      it("is recorded with the release, and a vector is copied only under the same config, not just the same model id", async () => {
        const first = deps({ search: searchOf(fakeEmbedder().embedder) });
        await publish(first);
        expect(await searchRow(1)).toMatchObject({ embed_config: { model: MODEL, input_type: "search_document", embedding_type: "float", dims: null }, embed_config_key: KEY });

        const wider = fakeEmbedder({ dims: 512 });
        const second = await publish(deps({ storage: first.storage, search: searchOf(wider.embedder) }));
        expect(second).toMatchObject({ ok: true, release: 2, search: { reused: 0, embedded: 2 } });
        expect(wider.calls).toHaveLength(1);
        expect(await searchRow(2)).toMatchObject({ embed_config: { dims: 512 }, embed_config_key: "model=embed-v4.0;input_type=search_document;embedding_type=float;dims=512" });

        const query = fakeEmbedder({ inputType: "search_query" });
        expect(await publish(deps({ storage: first.storage, search: searchOf(query.embedder) }))).toMatchObject({ ok: true, release: 3, search: { reused: 0, embedded: 2 } });
      });

      it("is the config a stopped build was planned with: another dimension of the same model does not resume it", async () => {
        const first = deps();
        await publish(first);
        await stopAfterFirstChunk(first);
        const other = fakeEmbedder({ dims: 512 });

        const result = await publish(deps({ storage: first.storage, now: LATER, search: searchOf(other.embedder, { chunkSize: 1 }) }));

        expect(result).toMatchObject({ ok: false, reason: "search_config_invalid", detail: ["embed_config_changed"] });
        expect(other.calls).toHaveLength(0);
      });
    });

    describe("a build that is resumed with other settings than it was planned with", () => {
      it("is refused when the threshold differs", async () => {
        const first = deps();
        await publish(first);
        await stopAfterFirstChunk(first);
        const next = fakeEmbedder();

        const result = await publish(deps({ storage: first.storage, now: LATER, search: searchOf(next.embedder, { chunkSize: 1, threshold: 0.5 }) }));

        expect(result).toMatchObject({ ok: false, reason: "search_config_invalid", detail: ["threshold_changed"] });
        expect(next.calls).toHaveLength(0);
      });

      it("is refused when the emergency categories differ", async () => {
        const first = deps();
        await publish(first);
        await stopAfterFirstChunk(first, { emergencyCategories: ["Health", "Legal"] });
        const next = fakeEmbedder();

        const result = await publish(deps({ storage: first.storage, now: LATER, search: searchOf(next.embedder, { chunkSize: 1, emergencyCategories: ["Legal"] }) }));

        expect(result).toMatchObject({ ok: false, reason: "search_config_invalid", detail: ["emergency_categories_changed"] });
        expect(next.calls).toHaveLength(0);
      });

      it("resumes when the settings are the same, whatever the order of the categories", async () => {
        const first = deps();
        await publish(first);
        await stopAfterFirstChunk(first, { emergencyCategories: ["Health", "Legal"] });
        const next = fakeEmbedder();

        const result = await publish(deps({ storage: first.storage, now: LATER, search: searchOf(next.embedder, { chunkSize: 1, emergencyCategories: ["Legal", "Health"] }) }));

        expect(result).toMatchObject({ ok: true, release: 2 });
        expect(next.calls).toEqual([[M002_TEXT]]);
      });
    });

    describe("the paid work of a build that did not finish", () => {
      it("is copied by the next release when the build failed: only what was never embedded is embedded", async () => {
        const first = deps();
        await publish(first);
        await stopAfterFirstChunk(first);
        const down = fakeEmbedder({ failCalls: [1, 2, 3, 4, 5, 6] });

        const failed = await publish(deps({ storage: first.storage, now: LATER, search: searchOf(down.embedder, { chunkSize: 1 }) }));

        expect(failed).toMatchObject({ ok: false, reason: "embedding_unavailable", release: 2, attempts: 3 });
        expect(await releases()).toMatchObject([{ number: 1 }, { number: 2, status: "failed", staged: false }]);
        const kept = (await sql`select search from directory_release where number = 2`)[0].search as { kept: { embed_config_key: string; entries: { id: string }[] } };
        expect(kept.kept.entries.map((entry) => entry.id)).toEqual(["M001"]);

        const next = fakeEmbedder();
        const result = await publish(deps({ storage: first.storage, now: LATER, search: searchOf(next.embedder, { chunkSize: 1 }) }));

        expect(result).toMatchObject({ ok: true, release: 3, search: { vectors: 2, reused: 1, embedded: 1 } });
        expect(next.calls).toEqual([[M002_TEXT]]);
        expect(vectorsOf(first, 3).providers.find((p) => p.id === "M001")?.vector).toEqual(vectorOf(M001_TEXT));
      });

      it("is copied by the next release when the build was abandoned for being too old", async () => {
        const first = deps();
        await publish(first);
        await stopAfterFirstChunk(first);
        const next = fakeEmbedder();

        const result = await publish(deps({ storage: first.storage, now: () => new Date("2026-10-02T15:40:01Z"), search: searchOf(next.embedder, { chunkSize: 1 }) }));

        expect(await releases()).toMatchObject([{ number: 1 }, { number: 2, status: "failed", failure: "abandoned" }, { number: 3, status: "complete" }]);
        expect(result).toMatchObject({ ok: true, release: 3, search: { vectors: 2, reused: 1, embedded: 1 } });
        expect(next.calls).toEqual([[M002_TEXT]]);
      });

      it("is copied after a build that gave up on the allowance", async () => {
        const first = deps();
        await publish(first);
        await stopAfterFirstChunk(first);
        const tight = { callsPerMonth: 1, tokensPerMonth: 1_000_000 };
        for (let press = 0; press < 2; press += 1) await publish(deps({ storage: first.storage, now: LATER, search: searchOf(fakeEmbedder().embedder, { chunkSize: 1, allowance: tight }) }));
        // The third press finds the build stopped three times: it is closed as gave_up, and that is its answer.
        expect(await publish(deps({ storage: first.storage, now: LATER, search: searchOf(fakeEmbedder().embedder, { chunkSize: 1, allowance: tight }) }))).toMatchObject({ ok: false, reason: "gave_up", release: 2 });

        const next = fakeEmbedder();
        const result = await publish(deps({ storage: first.storage, now: LATER, search: searchOf(next.embedder, { chunkSize: 1 }) }));

        expect(result).toMatchObject({ ok: true, release: 3, search: { reused: 1, embedded: 1 } });
        expect(next.calls).toEqual([[M002_TEXT]]);
      });

      it("is not copied under another embedding config: a vector of another dimension is no use", async () => {
        const first = deps();
        await publish(first);
        await stopAfterFirstChunk(first);
        const down = fakeEmbedder({ failCalls: [1, 2, 3, 4, 5, 6] });
        await publish(deps({ storage: first.storage, now: LATER, search: searchOf(down.embedder, { chunkSize: 1 }) }));

        const wider = fakeEmbedder({ dims: 512 });
        const result = await publish(deps({ storage: first.storage, now: LATER, search: searchOf(wider.embedder, { chunkSize: 1 }) }));

        expect(result).toMatchObject({ ok: true, release: 3, search: { reused: 0, embedded: 2 } });
        expect(wider.calls).toEqual([[M001_TEXT], [M002_TEXT]]);
      });
    });

    // ---------------------------------------------------------- settings that do not fit
    it("refuses an emergency category the catalogue does not have, before anything is embedded or built", async () => {
      const model = fakeEmbedder();
      const d = deps({ search: searchOf(model.embedder, { emergencyCategories: ["Support and Emergency"] }) });

      const result = await publish(d);

      expect(result).toMatchObject({ ok: false, reason: "search_config_invalid", release: null, detail: ["emergency_category_unknown"] });
      expect(model.calls).toHaveLength(0);
      expect(await releases()).toEqual([]);
      expect(d.failures).toMatchObject([{ release: null, reason: "search_config_invalid" }]);
    });

    it("does not resume a build with another model than the one it was planned for", async () => {
      const first = deps();
      const stopped = deps({
        storage: first.storage,
        search: searchOf(fakeEmbedder().embedder, { chunkSize: 1 }),
        hook: async (point) => {
          if (point === "chunk_embedded") await new Promise(() => {});
        },
      });
      void publish(stopped);
      while ((await sql`select count(*)::int as n from directory_release`)[0].n < 1) await sleepMs(20);
      await sleepMs(200);

      const other = fakeEmbedder({ model: "embed-multilingual-v3.0" });
      const result = await publish(deps({ storage: first.storage, now: () => new Date("2026-10-02T15:10:00Z"), search: searchOf(other.embedder) }));

      expect(result).toMatchObject({ ok: false, reason: "search_config_invalid", detail: ["embed_model_changed"] });
      expect(other.calls).toHaveLength(0);
    });

    it("does not publish a build planned with search data when the model is no longer configured", async () => {
      const first = deps();
      const stopped = deps({
        storage: first.storage,
        search: searchOf(fakeEmbedder().embedder, { chunkSize: 1 }),
        hook: async (point) => {
          if (point === "chunk_embedded") await new Promise(() => {});
        },
      });
      void publish(stopped);
      while ((await sql`select count(*)::int as n from directory_release`)[0].n < 1) await sleepMs(20);
      await sleepMs(200);

      const result = await publish(deps({ storage: first.storage, now: () => new Date("2026-10-02T15:10:00Z") }));

      expect(result).toMatchObject({ ok: false, reason: "search_config_invalid", detail: ["search_not_configured"] });
      expect((await currentManifest(app))).toBeNull();
    });
  });

  // ------------------------------------------------------------ concurrency
  describe("safe against concurrent changes", () => {
    it("a second publish while one is running is refused, and only the first makes a release", async () => {
      const held = gate();
      const reached = gate();
      const first = deps({
        hook: async (point) => {
          if (point === "snapshot_taken") {
            reached.open();
            await held.promise;
          }
        },
      });
      const running = publish(first);
      await reached.promise;

      const second = await publish(deps({ storage: first.storage }));
      held.open();
      const done = await running;

      expect(second).toMatchObject({ ok: false, reason: "publish_running" });
      expect(done).toMatchObject({ ok: true, release: 1 });
      expect(await releases()).toMatchObject([{ number: 1, status: "complete", is_current: true }]);
      expect(await auditOf("directory.published")).toMatchObject([{ outcome: "refused", meta: { reason: "publish_running" } }, { outcome: "ok", subject_id: "1" }]);
    });

    it("a job whose claim was taken over stops without writing or completing anything", async () => {
      const held = gate();
      const reached = gate();
      const slow = deps({
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[1]) {
            reached.open();
            await held.promise;
          }
        },
      });
      const running = publish(slow);
      await reached.promise;
      // Another instance takes the expired claim over and finishes the release.
      const taker = deps({ storage: slow.storage, now: () => new Date("2026-10-02T15:05:00Z") });
      const taken = await publish(taker);
      held.open();
      const stopped = await running;

      expect(taken).toMatchObject({ ok: true, release: 1 });
      expect(stopped).toMatchObject({ ok: false, reason: "publish_running", release: 1 });
      expect(await releases()).toMatchObject([{ number: 1, status: "complete", is_current: true }]);
      expect(await auditOf("directory.published")).toHaveLength(2);
    });

    it("simultaneous presses never leave two current releases, a half-written one current, or a missing file", async () => {
      const results = await Promise.all(Array.from({ length: 4 }, () => publish(deps())));

      const rows = await releases();
      expect(rows.filter((r) => r.is_current)).toHaveLength(1);
      expect(rows.filter((r) => r.status === "building")).toEqual([]);
      for (const result of results) expect(result.ok || result.reason === "publish_running").toBe(true);
      expect(results.filter((r) => r.ok).length).toBe(rows.length);
      const manifest = await currentManifest(app);
      expect(manifest?.release_v).toBe(rows.find((r) => r.is_current)?.number);
    });

    it("waits for a provider change in progress, then publishes it: an unpublish that commits first is not in the release", async () => {
      const change = gate();
      const locked = gate();
      // A provider change (as providers.ts makes it) holding M002's row, not yet committed.
      const changing = sql.begin(async (tx) => {
        await tx`select id from provider where id = 'M002' for update`;
        await tx`update provider set published = false, published_at = null where id = 'M002'`;
        locked.open();
        await change.promise;
      });
      await locked.promise;
      const d = deps();
      const publishing = publish(d);

      expect(await stillPending(publishing)).toBe(true);
      expect(d.storage.puts).toEqual([]);
      change.open();
      await changing;
      const result = await publishing;

      expect(result).toMatchObject({ ok: true, release: 1, counts: { providers: 1 } });
      expect(listing(d, 1, "en").providers.map((p) => p.id)).toEqual(["M001"]);
    });

    it("holds off a provider change while its snapshot is taken: the change waits, and the release is the providers as they were", async () => {
      const held = gate();
      const reached = gate();
      const d = deps({
        hook: async (point) => {
          if (point === "snapshot_locked") {
            reached.open();
            await held.promise;
          }
        },
      });
      const publishing = publish(d);
      await reached.promise;

      const unpublishing = unpublishProvider(app, staffId, "M002");
      const confirming = confirmProvider(app, staffId, "M001", "2026-10-01", { now: () => new Date("2026-10-02T15:00:00Z") });
      expect(await stillPending(unpublishing)).toBe(true);
      expect(await stillPending(confirming, 100)).toBe(true);
      expect((await sql`select published from provider where id = 'M002'`)[0].published).toBe(true);
      held.open();
      const result = await publishing;
      expect(await unpublishing).toMatchObject({ ok: true });
      expect(await confirming).toMatchObject({ ok: true });

      expect(result).toMatchObject({ ok: true, release: 1, counts: { providers: 2 } });
      expect(listing(d, 1, "en").providers.map((p) => [p.id, p.last_confirmed])).toEqual([["M001", "2026-09-20"], ["M002", "2026-09-21"]]);
      // The change that waited is in the next release.
      expect(await publish(d)).toMatchObject({ ok: true, release: 2, counts: { providers: 1 } });
      expect(listing(d, 2, "en").providers.map((p) => [p.id, p.last_confirmed])).toEqual([["M001", "2026-10-01"]]);
    });

    it("a provider published or unpublished after the snapshot does not change the release being written", async () => {
      const d = deps({
        hook: async (point, detail) => {
          if (point === "file_stored" && detail.lang === LANG_CODES[0]) {
            await unpublishProvider(app, staffId, "M001");
            await publishProvider(app, staffId, "M003");
          }
        },
      });

      const result = await publish(d);

      expect(result).toMatchObject({ ok: true, release: 1, counts: { providers: 2 } });
      for (const lang of LANG_CODES) expect(listing(d, 1, lang).providers.map((p) => p.id)).toEqual(["M001", "M002"]);
    });

    it("the manifest names the old release or the new one at every moment of a publish, never none and never a mix", async () => {
      const first = deps();
      await publish(first);
      const second = deps({ storage: first.storage });
      let done = false;
      const seen = new Set<number>();
      const reader = (async () => {
        while (!done) {
          const manifest = await currentManifest(app);
          expect(manifest).not.toBeNull();
          const release = (manifest as NonNullable<typeof manifest>).release_v;
          seen.add(release);
          // Every path of the manifest is of that one release, and each file is readable now.
          for (const path of Object.values((manifest as NonNullable<typeof manifest>).files)) expect(path.startsWith(`/api/directory/${release}/`)).toBe(true);
          expect(await readListing(app, first.storage, String(release), "en.json")).toMatchObject({ found: true });
        }
      })();
      const result = await publish(second);
      done = true;
      await reader;

      expect(result).toMatchObject({ ok: true, release: 2 });
      expect([...seen].every((n) => n === 1 || n === 2)).toBe(true);
      expect((await currentManifest(app))?.release_v).toBe(2);
    });
  });

  // ------------------------------------------------------------ the tables
  describe("the tables", () => {
    it("have row level security, nothing for the client roles, and for the app only what the job needs", async () => {
      const rls = await sql.unsafe("select relname, relrowsecurity as rls from pg_class where relname in ('catalogue_load', 'directory_release', 'ops_event') and relkind = 'r' order by 1");
      expect(rls.map((t) => ({ ...t }))).toEqual([{ relname: "catalogue_load", rls: true }, { relname: "directory_release", rls: true }, { relname: "ops_event", rls: true }]);
      const clients = await sql.unsafe(
        `select r.rolname, c.relname from pg_roles r, pg_class c
         where r.rolname in ('anon', 'authenticated', 'service_role') and c.relname in ('catalogue_load', 'directory_release', 'ops_event') and c.relkind = 'r'
           and has_table_privilege(r.oid, c.oid, 'select, insert, update, delete, truncate, references, trigger')`,
      );
      expect(clients).toEqual([]);
      const sequences = await sql.unsafe(
        `select r.rolname from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role') and (has_sequence_privilege(r.oid, 'ops_event_id_seq', 'usage, select, update') or has_sequence_privilege(r.oid, 'catalogue_load_id_seq', 'usage, select, update'))`,
      );
      expect(sequences).toEqual([]);

      const access = await sql.unsafe(
        `select c.relname, has_table_privilege('cvh_app', c.oid, 'select') as can_select, has_table_privilege('cvh_app', c.oid, 'insert') as can_insert,
                has_table_privilege('cvh_app', c.oid, 'delete') as can_delete, has_table_privilege('cvh_app', c.oid, 'update') as can_update_table
         from pg_class c where c.relname in ('catalogue_load', 'directory_release', 'ops_event') and c.relkind = 'r' order by 1`,
      );
      expect(access.map((t) => ({ ...t }))).toEqual([
        // Written by the seed (the owner role) only: the app reads it.
        { relname: "catalogue_load", can_select: true, can_insert: false, can_delete: false, can_update_table: false },
        { relname: "directory_release", can_select: true, can_insert: true, can_delete: false, can_update_table: false },
        { relname: "ops_event", can_select: true, can_insert: true, can_delete: false, can_update_table: false },
      ]);
      const columns = await sql.unsafe(
        `select a.attname from pg_attribute a where a.attrelid = 'directory_release'::regclass and a.attnum > 0 and not a.attisdropped
           and has_column_privilege('cvh_app', 'directory_release', a.attname, 'update') order by 1`,
      );
      expect(columns.map((c) => c.attname)).toEqual(["attempts", "failure", "files", "is_current", "lease_token", "lease_until", "published_at", "search", "staged", "status", "current_since"].sort());
    });

    it("the app's role cannot delete a release or change its source version, counts or number", async () => {
      await publish(deps());

      await expect(appSql.unsafe("delete from directory_release where number = 1")).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe("update directory_release set catalogue_hash = repeat('e', 64) where number = 1")).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe("update directory_release set counts = '{}' where number = 1")).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe("update directory_release set number = 9 where number = 1")).rejects.toThrow(/permission denied/);
    });

    it("a complete release keeps its files, search data, status and publication time, for the owner as for the app", async () => {
      await publish(deps());

      for (const connection of [sql, appSql]) {
        await expect(connection.unsafe("update directory_release set files = '{}'::jsonb where number = 1")).rejects.toThrow(/cannot be changed|directory_release/);
        await expect(connection.unsafe("update directory_release set search = '{}'::jsonb where number = 1")).rejects.toThrow(/cannot be changed/);
        await expect(connection.unsafe("update directory_release set status = 'failed', failure = 'unexpected', is_current = false where number = 1")).rejects.toThrow(/cannot be changed|directory_release/);
        await expect(connection.unsafe("update directory_release set published_at = now() where number = 1")).rejects.toThrow(/cannot be changed/);
      }
      await expect(sql.unsafe("update directory_release set counts = '{}'::jsonb where number = 1")).rejects.toThrow(/never change/);
      await expect(sql.unsafe("update directory_release set catalogue_hash = repeat('e', 64) where number = 1")).rejects.toThrow(/never change/);
      await expect(sql.unsafe("delete from directory_release where number = 1")).rejects.toThrow(/never deleted/);
      await expect(sql.unsafe("truncate directory_release")).rejects.toThrow();
      // Only the pointer moves.
      await expect(appSql.unsafe("update directory_release set is_current = false where number = 1")).resolves.toBeDefined();
      await expect(appSql.unsafe("update directory_release set is_current = true, current_since = now() where number = 1")).resolves.toBeDefined();
    });

    it("refuse two current releases, a current one that is not complete, and a release born complete or current", async () => {
      const d = deps();
      await publish(d);
      await publish(d);

      await expect(sql.unsafe("update directory_release set is_current = true, current_since = now() where number = 1")).rejects.toThrow(/directory_release_one_current/);
      const row = (status: string, current: boolean) =>
        sql.unsafe(
          `insert into directory_release (number, status, catalogue_hash, counts, report, files, published_at, is_current, current_since)
           values (9, '${status}', repeat('a', 64), '{}', '{}', '{}', ${status === "complete" ? "now()" : "null"}, ${current}, ${current ? "now()" : "null"})`,
        );
      await expect(row("complete", false)).rejects.toThrow(/born building/);
      await expect(row("building", true)).rejects.toThrow(/born building|directory_release_current_is_complete/);
    });

    it("complete only when every file is stored", async () => {
      await sql.unsafe(
        `insert into directory_release (number, status, catalogue_hash, counts, report, files, staged)
         values (1, 'building', repeat('a', 64), '{}', '{}', '{"en": {"path": "releases/1/en.json", "sha256": "x", "bytes": 1, "stored_at": null}}', '{"en": "{}"}')`,
      );

      await expect(sql.unsafe("update directory_release set status = 'complete', published_at = now(), staged = null where number = 1")).rejects.toThrow(/every file is stored/);
      await expect(sql.unsafe("update directory_release set files = '{}', status = 'complete', published_at = now(), staged = null where number = 1")).rejects.toThrow(/every file is stored/);
    });

    it("keep their guard functions out of reach of the client roles, with the search_path pinned", async () => {
      const fns = await sql.unsafe(`
        select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon, has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated,
               has_function_privilege('public', p.oid, 'EXECUTE') as public, p.proconfig as config
        from pg_proc p where p.proname like 'directory_release_%' order by 1`);
      expect(fns.map((f) => f.proname)).toEqual(["directory_release_complete_needs_files", "directory_release_guard"]);
      for (const fn of fns) {
        expect(fn).toMatchObject({ anon: false, authenticated: false, public: false });
        expect(fn.config).toContain('search_path=""');
      }
    });

    it("ops_event takes only well-formed kinds and severities, and no update or delete by the app", async () => {
      await expect(recordOpsEvent(app, { kind: "directory.publish_failed", detail: { reason: "unexpected", attempts: 3 } })).resolves.toBeUndefined();
      await expect(appSql.unsafe("insert into ops_event (kind, severity) values ('Bad Kind', 'error')")).rejects.toThrow(/ops_event_kind_format/);
      await expect(appSql.unsafe("insert into ops_event (kind, severity) values ('x.y', 'loud')")).rejects.toThrow(/ops_event_severity/);
      await expect(appSql.unsafe("update ops_event set severity = 'info'")).rejects.toThrow(/permission denied/);
      await expect(appSql.unsafe("delete from ops_event")).rejects.toThrow(/permission denied/);
    });
  });

  describe("what a resident reads", () => {
    it("is only a complete release: one being built, one that failed and one that does not exist have no readable file", async () => {
      const d = deps();
      await publish(d);
      await sql.unsafe(
        `insert into directory_release (number, status, catalogue_hash, counts, report, files, staged)
         values (2, 'building', repeat('a', 64), '{}', '{}', '{"en": {"path": "releases/2/en.json", "sha256": "x", "bytes": 1, "stored_at": null}}', '{"en": "{}"}')`,
      );
      d.storage.files.set("releases/2/en.json", "{}");

      expect(await readListing(app, d.storage, "1", "en.json")).toMatchObject({ found: true });
      for (const [release, file] of [["2", "en.json"], ["3", "en.json"], ["1", "xx.json"], ["1", "en"], ["01", "en.json"], ["-1", "en.json"], ["abc", "en.json"], ["1", "../en.json"]]) {
        expect(await readListing(app, d.storage, release, file), `${release}/${file}`).toEqual({ found: false, reason: "not_found" });
      }
    });

    it("is never bytes that differ from what the release recorded", async () => {
      const d = deps();
      await publish(d);
      d.storage.files.set("releases/1/en.json", `${d.storage.files.get("releases/1/en.json")} `);

      expect(await readListing(app, d.storage, "1", "en.json")).toEqual({ found: false, reason: "unavailable" });
      d.storage.files.delete("releases/1/en.json");
      expect(await readListing(app, d.storage, "1", "en.json")).toEqual({ found: false, reason: "unavailable" });
    });
  });
});
