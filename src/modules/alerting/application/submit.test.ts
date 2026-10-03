// The submit flow's orchestration against a fake lifecycle and a fake preparer (S04.05): what is asked in which order, what is
// written while the translation runs, and how every way of failing ends. The same flow against Postgres, with the real lifecycle,
// is test/db/alertSubmit.db.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlertRoutesUnavailableError, RouteConfigError } from "../../translation";
import type { OpsEvent } from "../../ops";
import type { EntryContent } from "../domain/content";
import type { FrozenTranslation } from "../domain/translations";
import type { AttemptView } from "./lifecycle";
import type { AlertActor, EntryPreparer, FreezeResult, FrozenContent, PrepareContext } from "./ports";
import { createSubmitter, refusalOfPreparationError, type SubmitterDeps } from "./submit";

const ACTOR: AlertActor = { staffId: "01900000-0000-7000-8000-000000000001", aal: "aal2" };
const REF = { alertId: "01900000-0000-7000-8000-0000000000a1", entryId: "01900000-0000-7000-8000-0000000000e1" };
const KEY = "0190a000-0000-7000-8000-00000000000b";
const HASH = "a".repeat(64);

const CONTENT: EntryContent = {
  text: "Power is out.",
  types: ["power"],
  audience: { scope: "neighbourhood", neighbourhood_ids: ["TP"], groups: [], types: ["power"] },
  phase: "problem",
  validUntil: new Date("2026-10-04T12:00:00Z"),
};
const CONTEXT: PrepareContext = {
  alertId: REF.alertId,
  entryId: REF.entryId,
  isDrill: false,
  kind: "ack",
  supersedesId: null,
  channels: ["sms", "web"],
  slug: "k3x9a2bc",
  verified: true,
  attribution: { role: "hub" },
};
const attempt = (over: Partial<AttemptView> = {}): AttemptView => ({
  key: KEY,
  kind: "submit",
  state: "running",
  outcome: null,
  startedAt: new Date("2026-10-03T12:00:00Z"),
  finishedAt: null,
  budgetMs: null,
  progress: {},
  resultVersion: null,
  resultHash: null,
  ...over,
});
const translation = (lang: string, status: FrozenTranslation["status"] = "translated"): FrozenTranslation => ({ lang, body: "b", machine: status !== "fallback_en", model: status === "fallback_en" ? null : "m", status, sourceHash: HASH });
const FROZEN: FrozenContent = { contentHash: HASH, smsBodies: { en: { body: "x", encoding: "gsm7", segments: 1 } }, translations: [translation("ur"), translation("ps", "fallback_en")] };

function setup(options: { begin?: unknown; prepare?: EntryPreparer["prepare"]; complete?: unknown; deps?: Partial<SubmitterDeps> } = {}) {
  const calls: string[] = [];
  const ops: OpsEvent[] = [];
  const lifecycle = {
    beginSubmit: vi.fn(async () => (calls.push("begin"), options.begin ?? { ok: true, value: { kind: "started", attempt: attempt(), expected: CONTENT, context: CONTEXT, possibleDuplicateOf: null } })),
    completeSubmit: vi.fn(async () => (calls.push("complete"), options.complete ?? { ok: true, value: { version: 1 } })),
    failSubmit: vi.fn(async () => void calls.push("fail")),
    recordProgress: vi.fn<(ref: unknown, key: string, lang: string, status: string) => Promise<void>>(async () => undefined),
    recordBudget: vi.fn<(ref: unknown, key: string, budgetMs: number) => Promise<void>>(async () => undefined),
    entryState: vi.fn(async () => null),
  };
  const preparer: EntryPreparer = { prepare: options.prepare ?? (async (_content, _context, hooks) => (calls.push("prepare"), hooks?.onBudget?.(25_000), hooks?.onLanguage?.(translation("ur")), hooks?.onLanguage?.(translation("ps", "fallback_en")), { ok: true, value: FROZEN } as FreezeResult)) };
  const submitter = createSubmitter({
    lifecycle: lifecycle as unknown as SubmitterDeps["lifecycle"],
    preparer,
    ops: { record: async (event) => void ops.push(event) },
    now: () => new Date(),
    ...options.deps,
  });
  return { calls, ops, lifecycle, submitter };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("a submit that works", () => {
  it("claims the key, prepares outside the transactions, writes the budget and each language's progress, then freezes in one commit", async () => {
    const t = setup();

    const report = await t.submitter.submit(ACTOR, REF, KEY);

    expect(report).toEqual({ state: "committed", key: KEY, outcome: null });
    expect(t.calls).toEqual(["begin", "prepare", "complete"]);
    expect(t.lifecycle.beginSubmit).toHaveBeenCalledWith(ACTOR, REF, KEY, { kind: "submit" });
    expect(t.lifecycle.recordBudget).toHaveBeenCalledWith(REF, KEY, 25_000);
    expect(t.lifecycle.recordProgress.mock.calls.map((call) => [call[2], call[3]])).toEqual([["ur", "translated"], ["ps", "fallback_en"]]);
    // The commit gets what the draft was when Submit was pressed, so a change since is refused.
    expect(t.lifecycle.completeSubmit).toHaveBeenCalledWith(ACTOR, REF, KEY, FROZEN, CONTENT, null);
    expect(t.lifecycle.failSubmit).not.toHaveBeenCalled();
  });

  it("records an ops event when a language fell back, and none when every language was translated", async () => {
    const withFallback = setup();
    await withFallback.submitter.submit(ACTOR, REF, KEY);
    expect(withFallback.ops).toEqual([{ kind: "alert.translation_fallback", subjectType: "alert_entry", subjectId: REF.entryId, detail: { languages: 1 } }]);

    const clean = setup({ prepare: async () => ({ ok: true, value: { ...FROZEN, translations: [translation("ur")] } }) });
    await clean.submitter.submit(ACTOR, REF, KEY);
    expect(clean.ops).toEqual([]);
  });

  it("records no fallback event where no translation model is configured, since every language falling back is expected there", async () => {
    const t = setup({ deps: { translationConfigured: false } });
    await t.submitter.submit(ACTOR, REF, KEY);
    expect(t.ops).toEqual([]);
  });

  it("passes a 'Try translation again' to the lifecycle with what the person saw", async () => {
    const t = setup();

    await t.submitter.retranslate(ACTOR, REF, KEY, { version: 2, contentHash: HASH });

    expect(t.lifecycle.beginSubmit).toHaveBeenCalledWith(ACTOR, REF, KEY, { kind: "retranslate", seen: { version: 2, contentHash: HASH } });
  });

  it("is not held up by progress writes that never finish: it goes on after the settle time", async () => {
    const t = setup();
    t.lifecycle.recordProgress.mockImplementation(() => new Promise<void>(() => {}));
    let done = false;

    const run = t.submitter.submit(ACTOR, REF, KEY).then((report) => {
      done = true;
      return report;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);

    expect(await run).toMatchObject({ state: "committed" });
  });
});

describe("a key that was used before, or a draft that cannot be submitted", () => {
  it("returns the first attempt's result for the same key and does nothing else: committed, running or failed", async () => {
    for (const settled of [attempt({ state: "committed", resultVersion: 3, resultHash: HASH }), attempt(), attempt({ state: "failed", outcome: "DRAFT_CHANGED" })]) {
      const t = setup({ begin: { ok: true, value: { kind: "replay", attempt: settled } } });

      const report = await t.submitter.submit(ACTOR, REF, KEY);

      expect(report).toEqual({ state: settled.state, key: KEY, outcome: settled.outcome });
      expect(t.calls).toEqual(["begin"]);
    }
  });

  it("reports a refusal before any attempt exists as refused, and asks no model", async () => {
    const t = setup({ begin: { ok: false, error: "VALID_UNTIL_PAST" } });

    expect(await t.submitter.submit(ACTOR, REF, KEY)).toEqual({ state: "refused", refusal: "VALID_UNTIL_PAST" });
    expect(t.calls).toEqual(["begin"]);
  });
});

describe("a submit that cannot freeze anything", () => {
  it("refuses with ROUTES_UNAVAILABLE and an ops event when translation_route cannot be read in time: never a half result", async () => {
    const t = setup({
      prepare: async () => {
        throw new AlertRoutesUnavailableError();
      },
    });

    const report = await t.submitter.submit(ACTOR, REF, KEY);

    expect(report).toEqual({ state: "failed", key: KEY, outcome: "ROUTES_UNAVAILABLE" });
    expect(t.lifecycle.completeSubmit).not.toHaveBeenCalled();
    expect(t.lifecycle.failSubmit).toHaveBeenCalledWith(ACTOR, REF, KEY, "ROUTES_UNAVAILABLE", false);
    expect(t.ops).toEqual([{ kind: "alert.submit_failed", subjectType: "alert_entry", subjectId: REF.entryId, detail: { reason: "routes_unavailable", ms: expect.any(Number) } }]);
  });

  it("refuses with ROUTES_INVALID and an ops event when a translation_route row is bad (RouteConfigError)", async () => {
    const t = setup({
      prepare: async () => {
        throw new RouteConfigError("ur", "a position is repeated");
      },
    });

    expect(await t.submitter.submit(ACTOR, REF, KEY)).toEqual({ state: "failed", key: KEY, outcome: "ROUTES_INVALID" });
    expect(t.lifecycle.completeSubmit).not.toHaveBeenCalled();
    expect(t.ops).toMatchObject([{ kind: "alert.submit_failed", detail: { reason: "routes_invalid" } }]);
  });

  it("refuses with SMS_BODY_TOO_LONG and TRANSLATION_STALE as the freeze reports them, naming the reason in an ops event", async () => {
    for (const [error, reason] of [["SMS_BODY_TOO_LONG", "sms_body_too_long"], ["TRANSLATION_STALE", "translation_stale"]] as const) {
      const t = setup({ prepare: async () => ({ ok: false, error, lang: "ta" }) });

      expect(await t.submitter.submit(ACTOR, REF, KEY)).toEqual({ state: "failed", key: KEY, outcome: error });
      expect(t.lifecycle.completeSubmit).not.toHaveBeenCalled();
      expect(t.ops).toMatchObject([{ kind: "alert.submit_failed", detail: { reason } }]);
    }
  });

  it("refuses with PREPARATION_FAILED for anything else the preparation throws", async () => {
    const t = setup({
      prepare: async () => {
        throw new Error("a set that is not whole");
      },
    });

    expect(await t.submitter.submit(ACTOR, REF, KEY)).toEqual({ state: "failed", key: KEY, outcome: "PREPARATION_FAILED" });
    expect(t.ops).toMatchObject([{ kind: "alert.submit_failed", detail: { reason: "preparation_failed" } }]);
  });

  it("ends the attempt as failed, with an ops event, when the freezing transaction itself fails", async () => {
    const t = setup();
    t.lifecycle.completeSubmit.mockRejectedValue(new Error("connection reset"));

    expect(await t.submitter.submit(ACTOR, REF, KEY)).toEqual({ state: "failed", key: KEY, outcome: "PREPARATION_FAILED" });
    expect(t.lifecycle.failSubmit).toHaveBeenCalledWith(ACTOR, REF, KEY, "PREPARATION_FAILED", false);
    expect(t.ops).toMatchObject([{ kind: "alert.submit_failed", detail: { reason: "commit_failed" } }]);
  });

  it("reports the refusal of the freezing transaction (the draft changed while it was prepared) and leaves ending the attempt to the lifecycle", async () => {
    const t = setup({ complete: { ok: false, error: "DRAFT_CHANGED" } });

    expect(await t.submitter.submit(ACTOR, REF, KEY)).toEqual({ state: "failed", key: KEY, outcome: "DRAFT_CHANGED" });
    expect(t.lifecycle.failSubmit).not.toHaveBeenCalled();
    expect(t.ops.filter((event) => event.kind === "alert.submit_failed")).toEqual([]);
  });

  it("is not made to fail by an ops log that fails", async () => {
    const t = setup({
      prepare: async () => {
        throw new AlertRoutesUnavailableError();
      },
      deps: {
        ops: {
          record: async () => {
            throw new Error("ops_event down");
          },
        },
      },
    });

    expect(await t.submitter.submit(ACTOR, REF, KEY)).toEqual({ state: "failed", key: KEY, outcome: "ROUTES_UNAVAILABLE" });
  });
});

describe("refusalOfPreparationError", () => {
  it("names the routes' two errors and calls anything else a failed preparation", () => {
    expect(refusalOfPreparationError(new AlertRoutesUnavailableError())).toBe("ROUTES_UNAVAILABLE");
    expect(refusalOfPreparationError(new RouteConfigError("ps", "x"))).toBe("ROUTES_INVALID");
    expect(refusalOfPreparationError(new Error("x"))).toBe("PREPARATION_FAILED");
    expect(refusalOfPreparationError("x")).toBe("PREPARATION_FAILED");
  });
});
