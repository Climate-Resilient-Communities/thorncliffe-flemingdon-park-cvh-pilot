import { describe, expect, it, vi } from "vitest";
import type { DbTransaction } from "../../../platform/db";
import type { TransactionalInput } from "../../messaging";
import type { NewEscalation } from "../adapters/markStore";
import { createEscalationTexts, type EscalationRecipients, type EscalationTextsDeps } from "./escalations";

const tx = {} as DbTransaction;
const ESCALATION: NewEscalation = {
  id: "0199b6f2-7c3a-7d41-9e2b-4f6a8c1d2e3f",
  roundRef: "6b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  status: "needs_help",
  alertId: "0199b6f2-0000-7000-8000-000000000001",
  rsn: "4154146",
  floorId: "0199b6f2-0000-7000-8000-0000000000f1",
  raisedBy: "0199b6f2-0000-7000-8000-0000000000a1",
  late: false,
};
const ON_DUTY = "0199b6f2-0000-7000-8000-0000000000c1";
const ONCALL = ["0199b6f2-0000-7000-8000-0000000000c2", "0199b6f2-0000-7000-8000-0000000000c3"];

function world(recipients: EscalationRecipients, refused = false) {
  const queued: TransactionalInput[] = [];
  const rendered: unknown[] = [];
  const deps: EscalationTextsDeps = {
    recipients: async () => recipients,
    place: async () => ({ building: "4 Milepost Pl", floor: "3" }),
    render: (input) => {
      rendered.push(input);
      return { body: `CVH: ${input.status}: ${input.building}, floor ${input.floor}. Open: ${input.link}`, segments: 1 };
    },
    link: (id) => `https://hub.example/staff/rounds/escalation?id=${id}`,
    enqueue: vi.fn(async (_tx, input: TransactionalInput) => {
      queued.push(input);
      return refused ? { ok: false as const, error: "PURPOSE_NOT_ALLOWED" as const } : { ok: true as const, value: {} as never };
    }),
    pricePerSegmentCents: () => 1.5,
  };
  return { deps, queued, rendered };
}

describe("the text that follows an escalation (S08.08, E08 'Escalation', 'On-duty Admin')", () => {
  it("queues one transactional text, purpose escalation, to the on-duty Admin's roster entry, with the building, floor and staff link and never anything of the resident", async () => {
    const w = world({ ids: [ON_DUTY], onDuty: true });
    await createEscalationTexts(w.deps).raised(tx, ESCALATION);
    expect(w.rendered).toEqual([{ status: "needs_help", building: "4 Milepost Pl", floor: "3", link: `https://hub.example/staff/rounds/escalation?id=${ESCALATION.id}` }]);
    expect(w.queued).toEqual([
      {
        module: "checkins",
        purpose: "escalation",
        recipient: { kind: "oncall", id: ON_DUTY },
        subject: ESCALATION.id,
        nonce: ON_DUTY,
        lang: "en",
        body: `CVH: needs_help: 4 Milepost Pl, floor 3. Open: https://hub.example/staff/rounds/escalation?id=${ESCALATION.id}`,
        segments: 1,
        costEstimateCents: 2,
      },
    ]);
    expect(JSON.stringify(w.queued)).not.toContain(ESCALATION.roundRef);
  });

  it("goes to every on-call number when nobody is on duty, one text each", async () => {
    const w = world({ ids: ONCALL, onDuty: false });
    await createEscalationTexts(w.deps).raised(tx, ESCALATION);
    expect(w.queued.map((input) => input.recipient)).toEqual(ONCALL.map((id) => ({ kind: "oncall", id })));
  });

  it("queues nothing for an empty roster (the Hub's list still shows the escalation)", async () => {
    const w = world({ ids: [], onDuty: false });
    await createEscalationTexts(w.deps).raised(tx, ESCALATION);
    expect(w.queued).toEqual([]);
  });

  it("throws when the outbox refuses, so the mark's transaction rolls back with it", async () => {
    await expect(createEscalationTexts(world({ ids: [ON_DUTY], onDuty: true }, true).deps).raised(tx, ESCALATION)).rejects.toThrow(/refused an escalation's text \(PURPOSE_NOT_ALLOWED\)/);
  });
});
