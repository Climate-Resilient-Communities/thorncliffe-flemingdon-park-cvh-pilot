import { describe, expect, it, vi } from "vitest";
import { currentStaffSession } from "../session";
import { addPersonFromForm, type AddPersonDeps } from "./addPerson";

const ADMIN = "01900000-0000-7000-8000-000000000001";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const filled = { username: "ofarouk", firstName: "Omar", lastName: "Farouk", email: "omar@example.org", role: "coordinator" };

function deps(overrides: Partial<{ session: AddPersonDeps["session"]; addPerson: ReturnType<typeof vi.fn> }> = {}) {
  const service = {
    addPerson: overrides.addPerson ?? vi.fn(),
    refuseUnauthenticated: vi.fn(async () => {}),
  };
  return { service, deps: { session: overrides.session ?? (async () => ({ staffId: ADMIN })), identity: () => service } as AddPersonDeps };
}

describe("Add a person (server action)", () => {
  it("is refused without a session, audited as unauthenticated, and never reaches the identity module's creation", async () => {
    const { service, deps: d } = deps({ session: async () => null });

    const state = await addPersonFromForm(d, form(filled));

    expect(state).toEqual({ status: "refused", message: "Sign in to continue.", values: filled });
    expect(service.refuseUnauthenticated).toHaveBeenCalledWith("accounts.create", "/staff/people");
    expect(service.addPerson).not.toHaveBeenCalled();
  });

  it("stays refused when the refusal cannot be audited", async () => {
    const d: AddPersonDeps = {
      session: async () => null,
      identity: () => {
        throw new Error("DATABASE_URL is not set");
      },
    };

    expect(await addPersonFromForm(d, form(filled))).toMatchObject({ status: "refused", message: "Sign in to continue." });
  });

  it("is refused by the session stub in every environment until S01.07", async () => {
    expect(await currentStaffSession()).toBeNull();
  });

  it("passes the signed-in staff member and the fields to the identity module, and shows what to hand over", async () => {
    const addPerson = vi.fn(async () => ({
      ok: true as const,
      value: { staffId: "x", username: "ofarouk", startingPassword: "rvh-omar-farouk", role: "coordinator" as const },
    }));
    const { deps: d } = deps({ addPerson });

    const state = await addPersonFromForm(d, form(filled));

    expect(addPerson).toHaveBeenCalledWith(ADMIN, filled);
    expect(state).toEqual({
      status: "created",
      heading: "Account created for Omar Farouk",
      username: "Username: ofarouk",
      password: "Starting password: rvh-omar-farouk",
      line: expect.stringContaining("works once, within 24 hours"),
    });
  });

  it.each([
    ["bootstrap_incomplete", "Finish setting up two Admins first", undefined],
    ["username_taken", "That username is already taken. Choose another.", "username"],
    ["starting_password_empty", expect.stringContaining("Latin letters"), "firstName"],
  ])("shows the %s refusal with its message", async (error, message, field) => {
    const { deps: d } = deps({ addPerson: vi.fn(async () => ({ ok: false as const, error })) });

    expect(await addPersonFromForm(d, form(filled))).toEqual({ status: "refused", message, field, values: filled });
  });
});
