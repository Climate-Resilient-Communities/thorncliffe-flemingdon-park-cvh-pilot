import { describe, expect, it } from "vitest";
import type { DbTransaction } from "../../../platform/db";
import type { AuditEvent } from "../../audit";
import type { RevocationCause } from "../domain/sessionLimits";
import { createSessionRevocation } from "./sessionRevocation";

const NOW = new Date("2026-10-05T09:00:00Z");
const STAFF = "01900000-0000-7000-8000-000000000003";
const ACTOR = "01900000-0000-7000-8000-000000000001";

function setup() {
  const calls: string[] = [];
  const recorded: AuditEvent[] = [];
  const revocation = createSessionRevocation({
    store: { bumpSessionGeneration: async (_tx, staffId) => void calls.push(`bump:${staffId}`) },
    sessions: {
      revokeAll: async (_tx, staffId, at) => {
        calls.push(`revoke:${staffId}:${at.toISOString()}`);
        return 3;
      },
    },
    audit: { record: async (_tx: DbTransaction, event: AuditEvent) => void recorded.push(event), recordRefusal: async () => {} },
    now: () => NOW,
  });
  return { revocation, calls, recorded };
}

describe("session revocation (S01.08)", () => {
  // S01.11's authenticator reset calls the hook with this cause.
  it("ends every session, counts one revocation and audits session.revoked with the cause factor_reset", async () => {
    const t = setup();

    const ended = await t.revocation.revokeAll({} as DbTransaction, { staffId: STAFF, actorStaffId: ACTOR, cause: "factor_reset" });

    expect(ended).toBe(3);
    expect(t.calls).toEqual([`bump:${STAFF}`, `revoke:${STAFF}:${NOW.toISOString()}`]);
    expect(t.recorded).toEqual([
      { action: "session.revoked", actorStaffId: ACTOR, subjectType: "staff_account", subjectId: STAFF, meta: { cause: "factor_reset", sessions: 3 } },
    ]);
  });

  it.each<RevocationCause>(["suspended", "removed", "password_reset", "role_changed"])("audits the cause %s as given", async (cause) => {
    const t = setup();
    await t.revocation.revokeAll({} as DbTransaction, { staffId: STAFF, actorStaffId: null, cause });
    expect(t.recorded[0]).toMatchObject({ actorStaffId: null, meta: { cause, sessions: 3 } });
  });
});
