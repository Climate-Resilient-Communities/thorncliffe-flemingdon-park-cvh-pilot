import { describe, expect, it } from "vitest";
import type { AuditEvent } from "./actions";

// Compile-time checks (npm run typecheck): an action whose meta schema has a
// required field cannot be recorded without its meta.
const base = { actorStaffId: null, subjectType: "guides_and_numbers", subjectId: null } as const;

describe("AuditEvent meta typing", () => {
  it("requires meta for actions whose schema has required fields", () => {
    // @ts-expect-error seed.run needs meta.seed
    const noMeta: AuditEvent<"seed.run"> = { ...base, action: "seed.run" };
    // @ts-expect-error session.revoked needs meta.cause
    const noCause: AuditEvent<"session.revoked"> = { ...base, action: "session.revoked" };
    // @ts-expect-error auth.locked needs meta.lock
    const noLock: AuditEvent<"auth.locked"> = { ...base, action: "auth.locked" };
    // @ts-expect-error permission.denied needs meta.status
    const noStatus: AuditEvent<"permission.denied"> = { ...base, action: "permission.denied" };
    // @ts-expect-error the required field itself is checked
    const wrong: AuditEvent<"seed.run"> = { ...base, action: "seed.run", meta: { warnings: 1 } };

    expect([noMeta, noCause, noLock, noStatus, wrong]).toHaveLength(5);
  });

  it("allows leaving meta out when every field is optional", () => {
    const changed: AuditEvent<"password.changed"> = { ...base, action: "password.changed" };
    const seeded: AuditEvent<"seed.run"> = {
      ...base,
      action: "seed.run",
      meta: { seed: "guides_and_numbers", counts: { guides: 3 }, warnings: 0, failures: 0 },
    };

    expect([changed, seeded]).toHaveLength(2);
  });
});
