import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DirectoryListingV1, TRANSLATION_UNAVAILABLE } from "@/contracts/directory";
import { LANG_CODES } from "@/contracts/lang";
import {
  RELEASE_LANGS,
  ReleaseDataError,
  checkReleaseSearch,
  planRelease,
  type ReleaseInput,
  type SnapshotCategory,
  type SnapshotProvider,
  type ZhHantConverter,
} from "./directoryRelease";

const sha256Hex = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

// A converter that is visibly not the identity, so a test can tell converted text from copied text.
const zhHant: ZhHantConverter = { convert: (text) => text.replaceAll("软", "軟").replaceAll("务", "務"), openccVersion: "1.4.2", config: "test s2twp" };
const HASH = "c".repeat(64);

const ENGLISH = "Free legal help. Call 911 in an emergency.";
const provenance = (english: string, overrides: Record<string, unknown> = {}) => ({
  model: "command-a-translate",
  status: "reviewed",
  reviewer: "A. Reviewer",
  reviewedOn: "2026-09-01",
  sourceHash: sha256Hex(english),
  ...overrides,
});

function provider(id: string, change: Partial<SnapshotProvider> = {}): SnapshotProvider {
  return {
    id,
    name: `Provider ${id}`,
    subcategories: [{ name: "Legal", labels: { en: "Legal", ur: "قانونی", zh: "软务" } }],
    contact: { phone: ["416-555-0100"] },
    texts: { services: { en: ENGLISH, ur: "مفت قانونی مدد۔ 911 پر کال کریں۔", zh: "免费软务。紧急情况请拨打 911。", fr: "Aide juridique gratuite. Appelez le 911." } },
    translations: {
      services: {
        ur: provenance(ENGLISH),
        zh: provenance(ENGLISH),
        fr: provenance(ENGLISH),
      },
    },
    lastConfirmed: "2026-09-20",
    locations: [{ street: "1 Overlea Blvd", city: "Toronto", postal: "M4H 1C6", lat: 43.7, lng: -79.34 }],
    categoryIds: ["c-legal"],
    ...change,
  };
}

const CATEGORIES: SnapshotCategory[] = [
  { id: "c-legal", sortOrder: 2, labels: { en: "Legal", ur: "قانونی" }, translations: { ur: provenance("Legal") } },
  { id: "c-unused", sortOrder: 1, labels: { en: "Unused" }, translations: {} },
];

function plan(providers: SnapshotProvider[], categories = CATEGORIES, number = 7) {
  const input: ReleaseInput = { number, catalogueHash: HASH, providers, categories, hash: sha256Hex, zhHant };
  const result = planRelease(input);
  const files = Object.fromEntries(result.files.map((file) => [file.lang, DirectoryListingV1.parse(JSON.parse(file.body))]));
  return { ...result, files, raw: result.files };
}

describe("planRelease: the files of a release", () => {
  it("writes one listing file per launch language plus zh-Hant, each valid against the contract and named for the release", () => {
    const { files, raw } = plan([provider("M001")]);

    expect(raw.map((file) => file.lang)).toEqual([...RELEASE_LANGS]);
    expect(Object.keys(files).sort()).toEqual([...LANG_CODES].sort());
    expect(RELEASE_LANGS).toHaveLength(16);
    for (const lang of LANG_CODES) {
      expect(files[lang]).toMatchObject({ v: 1, release_v: 7, lang, catalogue_hash: HASH });
      expect(files[lang].providers.map((p) => p.id)).toEqual(["M001"]);
    }
  });

  it("holds only the providers it is given, each once, in id order, and only the categories they are in", () => {
    const { files, counts } = plan([provider("M020"), provider("M003", { categoryIds: ["c-legal", "c-unused"] })]);

    expect(files.en.providers.map((p) => p.id)).toEqual(["M003", "M020"]);
    expect(files.en.categories.map((c) => c.id)).toEqual(["c-unused", "c-legal"]);
    expect(counts).toMatchObject({ providers: 2, categories: 2, languages: 16, files: 16 });
    expect(plan([provider("M020")]).files.en.categories.map((c) => c.id)).toEqual(["c-legal"]);
  });

  it("is deterministic: the same snapshot gives the same bytes and hashes", () => {
    const first = plan([provider("M001"), provider("M002")]);
    const second = plan([provider("M002"), provider("M001")]);

    expect(second.raw.map((file) => file.sha256)).toEqual(first.raw.map((file) => file.sha256));
    for (const file of first.raw) {
      expect(file.sha256).toBe(sha256Hex(file.body));
      expect(file.bytes).toBe(Buffer.byteLength(file.body, "utf8"));
    }
  });

  it("an empty snapshot is a valid release with no providers", () => {
    const { files, counts } = plan([]);

    expect(files.en.providers).toEqual([]);
    expect(counts).toMatchObject({ providers: 0, categories: 0, translations: 0, fallbacks: 0, stale: 0 });
  });
});

describe("planRelease: which text ships in a language", () => {
  it("ships a reviewed, current translation with its traceability: English original, source hash, model, review status", () => {
    const { files } = plan([provider("M001")]);
    const ur = files.ur.providers[0].services;

    expect(ur).toEqual({
      lang: "ur",
      body: "مفت قانونی مدد۔ 911 پر کال کریں۔",
      machine: true,
      model: "command-a-translate",
      status: "ok",
      source_hash: sha256Hex(ENGLISH),
      original: { lang: "en", body: ENGLISH },
      review_status: "reviewed",
      reviewed_on: "2026-09-01",
    });
    expect(files.en.providers[0].services).toMatchObject({ status: "source", machine: false, model: null, review_status: "source", body: ENGLISH, source_hash: sha256Hex(ENGLISH) });
  });

  it("a text that is null in a language's catalogue shows the English with translation.unavailable", () => {
    const { files, report } = plan([provider("M001")]);
    const hi = files.hi.providers[0].services;

    expect(hi).toMatchObject({ lang: "hi", body: ENGLISH, status: "fallback_en", machine: false, model: null, review_status: "none", notice: TRANSLATION_UNAVAILABLE, original: { body: ENGLISH } });
    expect(report.unavailable).toContainEqual({ lang: "hi", reason: "not_translated", count: 3 });
    expect(report.stale).toEqual([]);
  });

  it("a translation whose recorded source hash no longer matches the English is not published, and the report lists it by provider and language", () => {
    const old = "Free legal help.";
    const stale = provider("M002", { translations: { services: { ur: provenance(ENGLISH), fr: provenance(old), zh: provenance(old) } } });
    const { files, report, counts } = plan([provider("M001"), stale]);

    expect(files.fr.providers.find((p) => p.id === "M002")?.services).toMatchObject({ status: "fallback_en", body: ENGLISH, notice: TRANSLATION_UNAVAILABLE });
    expect(files.fr.providers.find((p) => p.id === "M001")?.services.status).toBe("ok");
    // zh is stale, so zh-Hant, converted from it, is withheld too.
    expect(files.zh.providers.find((p) => p.id === "M002")?.services.status).toBe("fallback_en");
    expect(files["zh-Hant"].providers.find((p) => p.id === "M002")?.services.status).toBe("fallback_en");
    expect(report.stale).toEqual([
      { subject: "M002", text: "services", lang: "fr" },
      { subject: "M002", text: "services", lang: "zh" },
      { subject: "M002", text: "services", lang: "zh-Hant" },
    ]);
    expect(counts.stale).toBe(3);
    // Nothing of the stale Chinese is in any file.
    for (const file of plan([stale]).raw) expect(file.body).not.toContain("免费软务");
  });

  it.each([
    ["machine, not reviewed", { status: "machine" }],
    ["reviewed without a reviewer", { reviewer: "" }],
    ["a placeholder reviewer", { reviewer: "PLACEHOLDER reviewer" }],
    ["reviewed without a valid date", { reviewedOn: "2026-13-40" }],
    ["no recorded model", { model: undefined }],
    ["no recorded source hash", { sourceHash: undefined }],
  ])("withholds a translation that is %s", (_name, change) => {
    const p = provider("M001", { translations: { services: { ur: provenance(ENGLISH, change) } } });
    const { files, report } = plan([p]);

    expect(files.ur.providers[0].services).toMatchObject({ status: "fallback_en", body: ENGLISH });
    // Not stale, so not in the stale list.
    expect(report.stale.filter((item) => item.lang === "ur")).toEqual([]);
  });

  it("withholds a translation that lost the 911 the English has", () => {
    const p = provider("M001", { texts: { services: { en: ENGLISH, ur: "مفت قانونی مدد۔" } }, translations: { services: { ur: provenance(ENGLISH) } } });

    expect(plan([p]).files.ur.providers[0].services.status).toBe("fallback_en");
  });

  it("a translation with no provenance at all is not shipped", () => {
    const p = provider("M001", { translations: {} });

    expect(plan([p]).files.fr.providers[0].services.status).toBe("fallback_en");
  });

  it("a provider with no emergency role has none; one with a role carries it as a text of its own", () => {
    const role = "Police. Call 911 first.";
    const p = provider("M001", {
      texts: { services: { en: ENGLISH }, emergency_role: { en: role, fr: "Police. Appelez d'abord le 911." } },
      translations: { emergency_role: { fr: provenance(role) } },
    });
    const { files } = plan([provider("M002"), p]);

    expect(files.fr.providers.find((x) => x.id === "M002")?.emergency_role).toBeNull();
    expect(files.fr.providers.find((x) => x.id === "M001")?.emergency_role).toMatchObject({ status: "ok", body: "Police. Appelez d'abord le 911." });
    expect(files.ur.providers.find((x) => x.id === "M001")?.emergency_role).toMatchObject({ status: "fallback_en", body: role });
  });

  it("carries category names and subcategory names the same way", () => {
    const { files } = plan([provider("M001")]);

    expect(files.ur.categories[0].name).toMatchObject({ status: "ok", body: "قانونی", model: "command-a-translate" });
    expect(files.fr.categories[0].name).toMatchObject({ status: "fallback_en", body: "Legal" });
    expect(files.ur.providers[0].subcategories[0]).toMatchObject({ status: "ok", body: "قانونی", original: { body: "Legal" } });
    expect(files.fr.providers[0].subcategories[0]).toMatchObject({ status: "fallback_en", body: "Legal" });
  });

  it("keeps name, contact and locations as they are, in every language, and leaves staff-only notes out", () => {
    const { files } = plan([provider("M001", { contact: { phone: ["416-555-0100"], web: ["https://example.org"] } })]);

    for (const lang of LANG_CODES) {
      expect(files[lang].providers[0]).toMatchObject({
        name: "Provider M001",
        contact: { phone: ["416-555-0100"], email: [], social: [], web: ["https://example.org"] },
        locations: [{ street: "1 Overlea Blvd", city: "Toronto", postal: "M4H 1C6", lat: 43.7, lng: -79.34 }],
        last_confirmed: "2026-09-20",
      });
      expect(Object.keys(files[lang].providers[0])).not.toContain("source_notes");
    }
  });
});

describe("planRelease: zh-Hant", () => {
  it("is converted from the reviewed zh text with OpenCC, marked script_converted, with the conversion recorded", () => {
    const { files } = plan([provider("M001")]);
    const text = files["zh-Hant"].providers[0].services;

    expect(text).toEqual({
      lang: "zh-Hant",
      body: "免费軟務。紧急情况请拨打 911。",
      machine: true,
      model: "opencc-js 1.4.2",
      status: "script_converted",
      source_hash: sha256Hex(ENGLISH),
      original: { lang: "en", body: ENGLISH },
      review_status: "reviewed",
      reviewed_on: "2026-09-01",
      conversion: { from: "zh", from_text_hash: sha256Hex("免费软务。紧急情况请拨打 911。"), opencc_version: "1.4.2", config: "test s2twp" },
    });
    expect(files.zh.providers[0].services.body).toBe("免费软务。紧急情况请拨打 911。");
  });

  it("is never read from the catalogue's own zh-Hant: a stored zh-Hant text is ignored", () => {
    const p = provider("M001");
    p.texts.services["zh-Hant"] = "假的繁體";
    p.translations.services["zh-Hant"] = provenance(ENGLISH);

    expect(plan([p]).files["zh-Hant"].providers[0].services.body).toBe("免费軟務。紧急情况请拨打 911。");
  });

  it("is English with translation.unavailable while there is no reviewed zh", () => {
    const p = provider("M001", { translations: { services: { ur: provenance(ENGLISH), zh: provenance(ENGLISH, { status: "machine" }) } } });
    const text = plan([p]).files["zh-Hant"].providers[0].services;

    expect(text).toMatchObject({ status: "fallback_en", body: ENGLISH, notice: TRANSLATION_UNAVAILABLE });
  });

  it("converts category and subcategory names from zh too", () => {
    const categories: SnapshotCategory[] = [{ id: "c-legal", sortOrder: 1, labels: { en: "Legal", zh: "软务" }, translations: { zh: provenance("Legal") } }];
    const { files } = plan([provider("M001")], categories);

    expect(files["zh-Hant"].categories[0].name).toMatchObject({ status: "script_converted", body: "軟務" });
    expect(files["zh-Hant"].providers[0].subcategories[0]).toMatchObject({ status: "script_converted", body: "軟務", conversion: { from: "zh" } });
  });
});

describe("planRelease: counts and the report", () => {
  it("counts the translations published, the texts shown in English, and the stale ones", () => {
    const { counts, report } = plan([provider("M001")]);

    // services: ur, zh, fr and zh-Hant ship; the category name: ur; the subcategory name: ur, zh and zh-Hant. That is 8 of
    // the 3 texts in each of the 15 other files (45): the rest are English.
    expect(counts.translations).toBe(8);
    expect(counts.fallbacks).toBe(45 - 8);
    expect(report.unavailable.every((item) => item.lang !== ("en" as string))).toBe(true);
    expect(counts.stale).toBe(report.stale.length);
  });

  it("is reproducible: report entries are sorted", () => {
    const old = "Free legal help.";
    const a = provider("M009", { translations: { services: { fr: provenance(old), ur: provenance(old) } } });
    const b = provider("M002", { translations: { services: { fr: provenance(old) } } });
    const { report } = plan([a, b]);

    expect(report.stale.map((item) => `${item.subject}:${item.lang}`)).toEqual(["M002:fr", "M009:fr", "M009:ur"]);
  });
});

describe("planRelease: a snapshot that cannot be published", () => {
  it("refuses a provider with no English services text, naming it, and plans nothing", () => {
    const broken = provider("M005", { texts: { services: { ur: "x" } } });

    expect(() => plan([provider("M001"), broken])).toThrow(ReleaseDataError);
    try {
      plan([broken]);
    } catch (error) {
      expect((error as ReleaseDataError).problems).toEqual(["provider M005 has no English services text"]);
    }
  });
});

describe("checkReleaseSearch: search data must belong to the release", () => {
  const release = { number: 7, catalogueHash: HASH };
  const search = { embedModel: "embed-multilingual-v3.0", vectorsPath: "releases/7/vectors.bin", catalogueHash: HASH, releaseV: 7 };

  it("accepts no search data (every release until E03) and matching search data", () => {
    expect(checkReleaseSearch(release, null)).toEqual({ ok: true });
    expect(checkReleaseSearch(release, search)).toEqual({ ok: true });
  });

  it("refuses search data of another release or of another catalogue version", () => {
    expect(checkReleaseSearch(release, { ...search, releaseV: 6 })).toEqual({ ok: false, problem: "release" });
    expect(checkReleaseSearch(release, { ...search, catalogueHash: "d".repeat(64) })).toEqual({ ok: false, problem: "catalogue" });
  });
});
