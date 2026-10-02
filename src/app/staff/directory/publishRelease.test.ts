import { beforeEach, describe, expect, it, vi } from "vitest";

const directory = vi.hoisted(() => ({ publishDirectory: vi.fn() }));
vi.mock("@/modules/directory", () => directory);

import type { PublishDeps } from "@/modules/directory";
import type { Db } from "@/platform/db";
import { publishFromForm } from "./publishRelease";
import { failureReason, staleLines } from "./words";

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
    expect(state).toMatchObject({ status: "done", message: "Release 4 is now current. Providers: 99. Languages: 16.", stale: null });
  });

  it("lists every stale text by provider and language, and counts the texts that show in English", async () => {
    directory.publishDirectory.mockResolvedValue(
      ok({ report: { stale: [{ subject: "M002", text: "services", lang: "zh" }, { subject: "M002", text: "services", lang: "zh-Hant" }], unavailable: [] } }),
    );

    const state = await publishFromForm(deps, session);

    expect(state).toMatchObject({
      status: "done",
      stale: {
        heading: "Translations not published because the English changed after they were made: 2. Residents see the English for these.",
        items: ["M002, services, zh", "M002, services, zh-Hant"],
      },
      notes: ["Texts with no reviewed translation yet, shown in English: 38."],
    });
  });

  it("says when it continued a stopped publish", async () => {
    directory.publishDirectory.mockResolvedValue(ok({ resumedFiles: 5, counts: { ...counts, fallbacks: 0, stale: 0 } }));

    expect(await publishFromForm(deps, session)).toMatchObject({ status: "done", notes: ["Files already stored when this publish continued: 5."] });
  });

  it.each([
    ["storage_unavailable", "Publish failed: the files could not be stored. The previous release is still current."],
    ["invalid_catalogue", "Publish failed: the catalogue could not be turned into a release. The previous release is still current."],
    ["search_mismatch", "Publish failed: the search data does not match this release. The previous release is still current."],
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
    for (const code of ["storage_unavailable", "invalid_catalogue", "search_mismatch", "gave_up", "unexpected"]) expect(failureReason(code)).not.toMatch(/^staff\./);
    expect(failureReason("something_new")).toBe("something went wrong");
    expect(staleLines({ stale: [{ subject: "category:c-legal", text: "name", lang: "fr" }] })).toEqual(["category:c-legal, name, fr"]);
  });
});
