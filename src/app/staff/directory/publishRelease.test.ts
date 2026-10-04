import { beforeEach, describe, expect, it, vi } from "vitest";

const directory = vi.hoisted(() => ({ publishDirectory: vi.fn() }));
vi.mock("@/modules/directory", () => directory);

import { LANG_CODES } from "@/contracts/lang";
import type { PublishDeps } from "@/modules/directory";
import type { Db } from "@/platform/db";
import { publishFromForm } from "./publishRelease";
import { failureReason, languageName, staleLines } from "./words";

const PUBLISH_FAILURE_CODES = ["storage_unavailable", "invalid_catalogue", "catalogue_unreadable", "catalogue_not_loaded", "search_mismatch", "embedding_unavailable", "usage_allowance_exceeded", "search_config_invalid", "gave_up", "unexpected"];

const ADMIN = "01900000-0000-7000-8000-000000000001";
const db = {} as Db;
const publishDeps = {} as PublishDeps;
const deps = { db: () => db, publish: () => publishDeps };
const session = { staffId: ADMIN };

const counts = { providers: 99, categories: 8, languages: 16, files: 16, translations: 1200, fallbacks: 40, stale: 2 };
const ok = (change: Record<string, unknown> = {}) => ({
  ok: true,
  release: 4,
  counts,
  report: { stale: [], unavailable: [] },
  attempts: 1,
  resumedFiles: 0,
  search: null,
  ...change,
});

beforeEach(() => directory.publishDirectory.mockReset());

// Who may call this (Admins, at aal2) is the guard's decision, asked before this code runs:
// test/db/permissions.db.test.ts calls the real action as every role.
describe("Publish directory (server action work)", () => {
  it("publishes as the signed-in Admin and says which release is now current", async () => {
    directory.publishDirectory.mockResolvedValue(ok());

    const state = await publishFromForm(deps, session);

    expect(directory.publishDirectory).toHaveBeenCalledWith(db, publishDeps, ADMIN);
    expect(state).toEqual({ status: "done", message: "Release 4 is now current. Providers: 99. Languages: 16.", notes: ["Texts with no reviewed translation yet, shown in English: 38.", "This release has no search data, so search is not available to residents until a release has it."] });
  });

  it("does not list the stale texts itself: the page, read again after the publish, does (once)", async () => {
    directory.publishDirectory.mockResolvedValue(
      ok({ report: { stale: [{ subject: "M002", name: "Legal Aid Ontario", text: "services", lang: "zh" }], unavailable: [] } }),
    );

    const state = await publishFromForm(deps, session);

    expect(state).not.toHaveProperty("stale");
    expect(JSON.stringify(state)).not.toContain("Legal Aid Ontario");
  });

  it("says when it continued a stopped publish", async () => {
    directory.publishDirectory.mockResolvedValue(ok({ resumedFiles: 5, counts: { ...counts, fallbacks: 0, stale: 0 } }));

    expect(await publishFromForm(deps, session)).toMatchObject({ status: "done", notes: ["Files already stored when this publish continued: 5.", "This release has no search data, so search is not available to residents until a release has it."] });
  });

  it("says how many unreviewed machine translations of descriptions the publish sent out (AD-11 pilot change)", async () => {
    directory.publishDirectory.mockResolvedValue(ok({ counts: { ...counts, machine: 656, fallbacks: 0, stale: 0 } }));

    expect(await publishFromForm(deps, session)).toMatchObject({
      status: "done",
      notes: [
        'Descriptions sent out as machine translations no person has reviewed, labelled "Machine-translated; not reviewed by a person" for residents: 656.',
        "This release has no search data, so search is not available to residents until a release has it.",
      ],
    });
  });

  it("says the search data went out without its compact copy, with the safe reason, and only then", async () => {
    directory.publishDirectory.mockResolvedValue(ok({ counts: { ...counts, fallbacks: 0, stale: 0 }, search: { vectors: 99, reused: 0, embedded: 99, binary_issue: "binary_put_failed:mime_not_allowed" } }));

    const state = await publishFromForm(deps, session);

    expect(state).toMatchObject({ status: "done" });
    expect((state as { notes: string[] }).notes).toEqual([
      "Search data: 99 providers, 0 copied from the previous release, 99 made new.",
      "Search data was published without its compact copy, so search loads more slowly when it starts; check the storage bucket allows application/octet-stream. Reason: binary_put_failed:mime_not_allowed.",
    ]);
  });

  it("has no compact-copy note when the binary was written", async () => {
    directory.publishDirectory.mockResolvedValue(ok({ counts: { ...counts, fallbacks: 0, stale: 0 }, search: { vectors: 99, reused: 0, embedded: 99 } }));

    const state = await publishFromForm(deps, session);

    expect(JSON.stringify(state)).not.toContain("compact copy");
  });

  it("says how many search vectors the release holds and how many were copied from the previous release", async () => {
    directory.publishDirectory.mockResolvedValue(ok({ counts: { ...counts, fallbacks: 0, stale: 0 }, search: { vectors: 99, reused: 97, embedded: 2 } }));

    expect(await publishFromForm(deps, session)).toMatchObject({ status: "done", notes: ["Search data: 99 providers, 97 copied from the previous release, 2 made new."] });
  });

  it.each([
    ["storage_unavailable", "Publish failed: the files could not be stored. The previous release is still current."],
    ["invalid_catalogue", "Publish failed: the catalogue could not be turned into a release. The previous release is still current."],
    ["catalogue_unreadable", "Publish failed: the catalogue files are missing from this deployment. The previous release is still current."],
    ["catalogue_not_loaded", "Publish failed: the database holds a different catalogue than this deployment. The previous release is still current."],
    ["search_mismatch", "Publish failed: the search data does not match this release. The previous release is still current."],
    ["embedding_unavailable", "Publish failed: the search data could not be made in time (the build is kept; press Publish again to continue it). The previous release is still current."],
    ["usage_allowance_exceeded", "Publish failed: making the search data would go over this month's usage allowance (the build is kept; press Publish again when the allowance allows it). The previous release is still current."],
    ["search_not_configured", "Publish failed: search is switched off on this deployment (no valid Cohere key), and the current release has search data, so publishing without it would take search away from residents; nothing was published. The previous release is still current."],
    ["search_config_invalid", "Publish failed: the search settings do not fit this release. The previous release is still current."],
    ["gave_up", "Publish failed: an earlier publish stopped three times. The previous release is still current."],
    ["unexpected", "Publish failed: something went wrong. The previous release is still current."],
  ])("shows 'Publish failed' with the reason for %s", async (reason, message) => {
    directory.publishDirectory.mockResolvedValue({ ok: false, reason, release: 3, attempts: 3, detail: [] });

    expect(await publishFromForm(deps, session)).toEqual({ status: "refused", message, problems: null });
  });

  it("names what is wrong in the catalogue when it is", async () => {
    directory.publishDirectory.mockResolvedValue({ ok: false, reason: "invalid_catalogue", release: null, attempts: 1, detail: ["provider M005 has no English services text"] });

    expect(await publishFromForm(deps, session)).toMatchObject({ status: "refused", problems: "What is wrong: provider M005 has no English services text" });
  });

  it("tells the Admin which catalogue the database holds, which this deployment has, and what to run", async () => {
    const mismatch = { loaded: "a1b2c3d4e5f6" + "0".repeat(52), deployed: "f6e5d4c3b2a1" + "0".repeat(52), commit: "3ac94e1d2c" };
    directory.publishDirectory.mockResolvedValue({ ok: false, reason: "catalogue_not_loaded", release: null, attempts: 1, detail: [], catalogue: mismatch });

    expect(await publishFromForm(deps, session)).toMatchObject({
      status: "refused",
      problems: "The database holds catalogue a1b2c3d4e5f6, this deployment has f6e5d4c3b2a1: run `npm run seed:providers` from commit 3ac94e1, then publish.",
    });
  });

  it("says so when the database never loaded a catalogue, and names no commit for a local build", async () => {
    const mismatch = { loaded: null, deployed: "f6e5d4c3b2a1" + "0".repeat(52), commit: null };
    directory.publishDirectory.mockResolvedValue({ ok: false, reason: "catalogue_not_loaded", release: null, attempts: 1, detail: [], catalogue: mismatch });

    expect(await publishFromForm(deps, session)).toMatchObject({
      problems: "The database holds no loaded catalogue, this deployment has f6e5d4c3b2a1: run `npm run seed:providers` from the commit this deployment was built from, then publish.",
    });
  });

  it("says a publish is already running without calling it a failure", async () => {
    directory.publishDirectory.mockResolvedValue({ ok: false, reason: "publish_running", release: null, attempts: 1, detail: [] });

    const state = await publishFromForm(deps, session);

    expect(state).toEqual({ status: "refused", message: "A publish is already running. Wait a few minutes, then check the current release here.", problems: null });
  });

  it("is 'Publish failed' when this environment has no store, and starts nothing", async () => {
    const state = await publishFromForm({ db: () => db, publish: () => { throw new Error("The directory store is not configured"); } }, session);

    expect(state).toMatchObject({ status: "refused", message: "Publish failed: the files could not be stored. The previous release is still current." });
    expect(directory.publishDirectory).not.toHaveBeenCalled();
  });

  it("has words for every reason the job gives, and for one it does not know", () => {
    for (const code of PUBLISH_FAILURE_CODES) expect(failureReason(code), code).not.toMatch(/^staff\./);
    expect(failureReason("something_new")).toBe("something went wrong");
  });

  it("writes a stale text as the provider's name, a field label and an English language name", () => {
    expect(
      staleLines({
        stale: [
          { subject: "M014", name: "Legal Aid Ontario", text: "services", lang: "ur" },
          { subject: "M014", name: "Legal Aid Ontario", text: "emergency_role", lang: "zh-Hant" },
          { subject: "category:c-legal", name: "Legal", text: "name", lang: "fr" },
        ],
      }),
    ).toEqual(["Legal Aid Ontario: Services, Urdu", "Legal Aid Ontario: Emergency role, Chinese (Traditional)", "Legal: Name, French"]);
  });

  it("names every language of a release in English, and falls back to the id for a report made before names were stored", () => {
    for (const lang of LANG_CODES) expect(languageName(lang), lang).toMatch(/^[A-Z][a-z]+( \([A-Za-z]+\))?$/);
    expect(staleLines({ stale: [{ subject: "M014", text: "services", lang: "ps" }] })).toEqual(["M014: Services, Pashto"]);
  });
});
