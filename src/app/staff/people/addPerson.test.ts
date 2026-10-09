import { describe, expect, it, vi } from "vitest";
import { addPersonFromForm, type AddPersonDeps } from "./addPerson";

const ADMIN = "01900000-0000-7000-8000-000000000001";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const filled = { username: "ofarouk", firstName: "Omar", lastName: "Farouk", email: "omar@example.org", role: "coordinator" };

function deps(overrides: Partial<{ addPerson: ReturnType<typeof vi.fn> }> = {}) {
  const service = { addPerson: overrides.addPerson ?? vi.fn() };
  return { service, deps: { identity: () => service } as AddPersonDeps };
}

const session = { staffId: ADMIN };

// Without a session, or at another setup gate, the guard refuses the action before this code runs:
// see test/staff-guard.test.ts, which calls the real action.
describe("Add a person (server action)", () => {
  it("passes the signed-in staff member and the fields to the identity module, and shows what to hand over", async () => {
    const addPerson = vi.fn(async () => ({
      ok: true as const,
      value: { staffId: "x", username: "ofarouk", startingPassword: "cvh-omar-farouk", role: "coordinator" as const },
    }));
    const { deps: d } = deps({ addPerson });

    const state = await addPersonFromForm(d, session, form(filled));

    expect(addPerson).toHaveBeenCalledWith(ADMIN, filled);
    expect(state).toEqual({
      status: "created",
      heading: "Account created for Omar Farouk",
      username: "Username: ofarouk",
      password: "Starting password: cvh-omar-farouk",
      line: expect.stringContaining("works once, within 72 hours"),
    });
  });

  it.each([
    ["bootstrap_incomplete", "Finish setting up two Admins first", undefined],
    ["username_taken", "That username is already taken. Choose another.", "username"],
    ["starting_password_empty", expect.stringContaining("Latin letters"), "firstName"],
    ["starting_password_too_long", expect.stringContaining("Shorten the name used for the password"), "firstName"],
    ["starting_password_unsupported_letter", expect.stringContaining("cannot be written with a to z"), "firstName"],
    ["provider_rejected", "Supabase rejected the starting password; check the project's password policy.", undefined],
  ])("shows the %s refusal with its message", async (error, message, field) => {
    const { deps: d } = deps({ addPerson: vi.fn(async () => ({ ok: false as const, error })) });

    expect(await addPersonFromForm(d, session, form(filled))).toEqual({ status: "refused", message, field, values: filled });
  });
});
