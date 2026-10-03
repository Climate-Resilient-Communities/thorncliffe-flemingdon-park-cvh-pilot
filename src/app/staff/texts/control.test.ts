import { describe, expect, it, vi } from "vitest";
import type { MessagingPause, PauseOutcome, ResumeOutcome } from "@/modules/messaging";
import { pauseFromForm, resumeFromForm, type ControlDeps } from "./control";

const ADMIN = { staffId: "01900000-0000-7000-8000-0000000000a1" };
const PAUSER = "01900000-0000-7000-8000-0000000000a2";
const AT = new Date("2026-10-05T18:15:00Z");
const form = (reason?: string) => {
  const data = new FormData();
  if (reason !== undefined) data.set("reason", reason);
  return data;
};
const paused = (handedOffAtPause: number | null = null) => ({ paused: true as const, pausedBy: ADMIN.staffId, pausedAt: AT, reason: "Stop", handedOffAtPause });

function world(options: { pause?: PauseOutcome | Error; resume?: ResumeOutcome | Error; kick?: () => Promise<void> } = {}) {
  const calls: string[] = [];
  const logged: { event: string; fields: Record<string, string> }[] = [];
  const service = {
    status: vi.fn(),
    pause: vi.fn(async (input: { actorStaffId: string; reason: unknown }) => {
      calls.push(`pause ${input.actorStaffId} ${JSON.stringify(input.reason)}`);
      if (options.pause instanceof Error) throw options.pause;
      return options.pause ?? { kind: "paused" as const, status: paused(), waiting: 0, handedOff: 0 };
    }),
    resume: vi.fn(async (input: { actorStaffId: string }) => {
      calls.push(`resume ${input.actorStaffId}`);
      if (options.resume instanceof Error) throw options.resume;
      return options.resume ?? { kind: "resumed" as const, waiting: 0 };
    }),
  } satisfies MessagingPause;
  const deps: ControlDeps = {
    pause: () => service,
    nameOf: async (id) => (id === PAUSER ? "Priya Sharma" : null),
    startSending: options.kick ?? (async () => void calls.push("start sending")),
    logError: (event, fields) => void logged.push({ event, fields }),
  };
  return { deps, calls, logged, service };
}

describe("pressing 'Pause all texts'", () => {
  it("pauses as the signed-in Admin with the reason from the form, and says what it holds", async () => {
    const w = world({ pause: { kind: "paused", status: paused(5), waiting: 12, handedOff: 5 } });

    const answer = await pauseFromForm(w.deps, ADMIN, form("Wrong alert sent"));

    expect(w.calls).toEqual([`pause ${ADMIN.staffId} "Wrong alert sent"`]);
    expect(answer).toEqual({
      status: "done",
      lines: ["Texts are paused.", "12 texts are waiting and will go out when you resume.", "5 texts were already handed to the provider and cannot be recalled"],
    });
  });

  it("leaves out the already-handed-off line when none had gone", async () => {
    const w = world({ pause: { kind: "paused", status: paused(0), waiting: 1, handedOff: 0 } });

    expect(await pauseFromForm(w.deps, ADMIN, form("x"))).toEqual({ status: "done", lines: ["Texts are paused.", "1 text is waiting and will go out when you resume."] });
  });

  it("hands the use case what the form holds, whatever it is: the use case cleans and judges the reason", async () => {
    const w = world();

    await pauseFromForm(w.deps, ADMIN, form());

    expect(w.calls).toEqual([`pause ${ADMIN.staffId} null`]);
  });

  it.each([
    ["missing", "Say why you are pausing texts."],
    ["too_long", "The reason can have at most 500 characters."],
  ] as const)("shows a refused reason (%s) as an error, with nothing changed", async (problem, message) => {
    const w = world({ pause: { kind: "refused", problem } });

    expect(await pauseFromForm(w.deps, ADMIN, form(""))).toEqual({ status: "refused", message });
  });

  it("names who paused when texts were already paused, and says nothing changed", async () => {
    const w = world({ pause: { kind: "already_paused", status: { ...paused(), pausedBy: PAUSER } } });

    expect(await pauseFromForm(w.deps, ADMIN, form("again"))).toEqual({ status: "done", lines: ["Texts were already paused by Priya Sharma. Nothing changed."] });
  });

  it("says 'an Admin' when it cannot read the name, and still reports the pause", async () => {
    const w = world({ pause: { kind: "already_paused", status: paused() } });
    w.deps.nameOf = async () => {
      throw new Error("db down");
    };

    expect(await pauseFromForm(w.deps, ADMIN, form("again"))).toEqual({ status: "done", lines: ["Texts were already paused by an Admin. Nothing changed."] });
  });

  it("says in as many words that texts were NOT paused when the pause failed, and logs only the error's name", async () => {
    const w = world({ pause: new TypeError("could not connect to 10.0.0.5 as postgres://user:secret@host") });

    const answer = await pauseFromForm(w.deps, ADMIN, form("Stop"));

    expect(answer).toEqual({ status: "refused", message: "Texts were not paused. Try again. If it fails again, tell IT." });
    expect(w.logged).toEqual([{ event: "messaging.pause_failed", fields: { error: "TypeError" } }]);
    expect(JSON.stringify(w.logged)).not.toContain("secret");
  });
});

describe("pressing 'Resume texts'", () => {
  it("resumes as the signed-in Admin, then starts a dispatcher run, and says what it let go", async () => {
    const w = world({ resume: { kind: "resumed", waiting: 40 } });

    expect(await resumeFromForm(w.deps, ADMIN)).toEqual({ status: "done", lines: ["Texts resumed. 40 texts were waiting and now go out in order."] });

    // The run starts only after the resume has committed (the use case returned).
    expect(w.calls).toEqual([`resume ${ADMIN.staffId}`, "start sending"]);
  });

  it("starts no run when texts were not paused, and says nothing changed", async () => {
    const w = world({ resume: { kind: "not_paused" } });

    expect(await resumeFromForm(w.deps, ADMIN)).toEqual({ status: "done", lines: ["Texts were not paused. Nothing changed."] });
    expect(w.calls).toEqual([`resume ${ADMIN.staffId}`]);
  });

  it("stands when the run cannot be started: pg_cron's next run sends the texts, and the failure is logged by name", async () => {
    const w = world({
      resume: { kind: "resumed", waiting: 1 },
      kick: async () => {
        throw new RangeError("no scheduler");
      },
    });

    expect(await resumeFromForm(w.deps, ADMIN)).toEqual({ status: "done", lines: ["Texts resumed. 1 text was waiting and now goes out in order."] });
    expect(w.logged).toEqual([{ event: "messaging.resume_kick_failed", fields: { error: "RangeError" } }]);
  });

  it("says texts were not resumed when the resume failed, starts no run and logs only the error's name", async () => {
    const w = world({ resume: new Error("connection reset") });

    expect(await resumeFromForm(w.deps, ADMIN)).toEqual({ status: "refused", message: "Texts were not resumed. Try again. If it fails again, tell IT." });
    expect(w.calls).toEqual([`resume ${ADMIN.staffId}`]);
    expect(w.logged).toEqual([{ event: "messaging.resume_failed", fields: { error: "Error" } }]);
  });
});
