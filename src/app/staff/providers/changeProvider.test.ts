import { beforeEach, describe, expect, it, vi } from "vitest";

const directory = vi.hoisted(() => ({ publishProvider: vi.fn(), unpublishProvider: vi.fn(), confirmProvider: vi.fn() }));
vi.mock("@/modules/directory", () => directory);

import type { Db } from "@/platform/db";
import { confirmFromForm, publishFromForm, unpublishFromForm } from "./changeProvider";

const ADMIN = "01900000-0000-7000-8000-000000000001";
const db = {} as Db;
const deps = { db: () => db };
const session = { staffId: ADMIN };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

beforeEach(() => {
  for (const mock of Object.values(directory)) mock.mockReset();
});

// Who may call these (Admins, at aal2) is the guard's decision, asked before this code runs:
// test/db/permissions.db.test.ts calls the real actions as every role.
describe("the provider row's buttons (server action work)", () => {
  it("publishes the provider named in the form as the signed-in Admin", async () => {
    directory.publishProvider.mockResolvedValue({ ok: true, name: "Thorncliffe Office", lastConfirmed: "2026-09-30" });

    const state = await publishFromForm(deps, session, form({ providerId: " M001 " }));

    expect(directory.publishProvider).toHaveBeenCalledWith(db, ADMIN, "M001", undefined);
    expect(state).toEqual({ status: "done", providerId: "M001", message: "Thorncliffe Office is published." });
  });

  it("says 'Confirm this provider first' when the provider has no last-confirmed date", async () => {
    directory.publishProvider.mockResolvedValue({ ok: false, error: "confirm_first" });

    expect(await publishFromForm(deps, session, form({ providerId: "M001" }))).toEqual({
      status: "refused",
      providerId: "M001",
      message: "Confirm this provider first",
    });
  });

  it("unpublishes", async () => {
    directory.unpublishProvider.mockResolvedValue({ ok: true, name: "Thorncliffe Office", lastConfirmed: "2026-09-30" });

    expect(await unpublishFromForm(deps, session, form({ providerId: "M001" }))).toEqual({
      status: "done",
      providerId: "M001",
      message: "Thorncliffe Office is no longer published.",
    });
    expect(directory.unpublishProvider).toHaveBeenCalledWith(db, ADMIN, "M001", undefined);
  });

  it("sets the date from the form and says which date was saved", async () => {
    directory.confirmProvider.mockResolvedValue({ ok: true, name: "Thorncliffe Office", lastConfirmed: "2026-10-01" });

    const state = await confirmFromForm(deps, session, form({ providerId: "M001", date: "2026-10-01" }));

    expect(directory.confirmProvider).toHaveBeenCalledWith(db, ADMIN, "M001", "2026-10-01", undefined);
    expect(state).toEqual({ status: "done", providerId: "M001", message: "Thorncliffe Office was confirmed on 2026-10-01." });
  });

  it.each([
    ["date_in_future", "The date cannot be later than today."],
    ["date_invalid", "Choose a date."],
    ["not_found", "That provider is not in the list."],
    ["not_in_catalogue", "This provider is no longer in the catalogue, so it cannot be published or confirmed."],
    ["already_published", "This provider is already published."],
    ["not_published", "This provider is not published."],
  ] as const)("turns the refusal %s into its catalog text", async (error, message) => {
    directory.confirmProvider.mockResolvedValue({ ok: false, error });

    expect(await confirmFromForm(deps, session, form({ providerId: "M001", date: "x" }))).toEqual({ status: "refused", providerId: "M001", message });
  });

  it("passes a missing date field on as an empty date, which the module refuses", async () => {
    directory.confirmProvider.mockResolvedValue({ ok: false, error: "date_invalid" });

    await confirmFromForm(deps, session, form({ providerId: "M001" }));

    expect(directory.confirmProvider).toHaveBeenCalledWith(db, ADMIN, "M001", "", undefined);
  });
});
