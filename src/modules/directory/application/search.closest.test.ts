// Session 2, #3: the closest matches, with fakes for the snapshot, the model and the month's count: what is sent, what is kept of
// the answer, and the cases that answer none (no model, a question that describes an emergency, the monthly limit, a failure,
// a timeout), each failure told to ops. The search's own answer is never touched.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpendEventInput } from "@/modules/spend";
import { ClosestError, type ClosestPicker, type QueryEmbedder } from "./ports";
import { CLOSEST_TIMEOUT_MS, createSearch, type SearchFailureNote, type SearchSnapshot } from "./search";

const SNAPSHOT: SearchSnapshot = {
  releaseV: 13,
  data: {
    releaseV: 13,
    model: "embed-v4.0",
    dims: 2,
    threshold: 0.3,
    ids: ["M007", "M022"],
    vectors: [
      [1, 0],
      [0, 1],
    ],
    known: new Set(["M007", "M022"]),
    emergency: new Set(),
    closestCatalogue: "M007 | TNO | Non-Profits | can't pay my rent\nM022 | Legal Clinic | Legal | my landlord wants me out",
  },
};

const embedder: QueryEmbedder = { embedQuery: async () => ({ vector: [0, 0], tokens: 1 }) };

function picker(answer: string | (() => Promise<{ text: string; tokens: number | null }>), ms = 100) {
  const prompts: string[] = [];
  const closest: ClosestPicker = {
    model: "command-a-03-2025",
    pick({ prompt, signal }) {
      prompts.push(prompt);
      if (typeof answer === "function") return answer();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ text: answer, tokens: 1500 }), ms);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new ClosestError("aborted"));
        });
      });
    },
  };
  return { closest, prompts };
}

describe("closest matches (session 2, #3)", () => {
  let spends: SpendEventInput[];
  let notes: SearchFailureNote[];
  beforeEach(() => {
    vi.useFakeTimers();
    spends = [];
    notes = [];
  });
  afterEach(() => vi.useRealTimers());

  function service(parts: { closest?: ClosestPicker | null; used?: number; monthly?: number }) {
    return createSearch({
      db: () => {
        throw new Error("no database in this test");
      },
      storage: () => {
        throw new Error("no store in this test");
      },
      embedder,
      translator: null,
      snapshot: async () => SNAPSHOT,
      closest: parts.closest ?? null,
      closestMonthlyCalls: parts.monthly,
      closestCalls: async () => parts.used ?? 0,
      writer: { log: async () => undefined, spend: async (event) => void spends.push(event) },
      onFailure: async (note) => void notes.push(note),
      defer: (work) => void work,
      clock: () => Date.now(),
    });
  }

  async function closest(search: ReturnType<typeof service>, q: string) {
    const pending = search.closest!({ q, lang: "es" });
    pending.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(CLOSEST_TIMEOUT_MS + 1000);
    return pending;
  }

  it("sends the question with the release's provider lines and answers the release's providers it names, counting one call", async () => {
    const fake = picker('{"ids": ["M007", "M999", "M022"]}');
    const answer = await closest(service({ closest: fake.closest }), "no puedo pagar el alquiler");

    expect(answer).toEqual({ v: 1, release_v: 13, results: [{ provider_id: "M007" }, { provider_id: "M022" }] });
    expect(fake.prompts[0]).toContain("no puedo pagar el alquiler");
    expect(fake.prompts[0]).toContain("M007 | TNO");
    expect(spends).toEqual([expect.objectContaining({ kind: "closest", model: "command-a-03-2025", releaseV: 13, calls: 1, tokens: 1500 })]);
  });

  it("answers none without a model, and never sends a question that describes an emergency", async () => {
    expect(await closest(service({}), "no puedo pagar el alquiler")).toEqual({ v: 1, release_v: 13, results: [] });
    const fake = picker('{"ids": ["M007"]}');
    expect((await closest(service({ closest: fake.closest }), "my house is on fire")).results).toEqual([]);
    expect(fake.prompts).toEqual([]);
  });

  it("answers none once the month's calls reach the limit, and tells ops", async () => {
    const fake = picker('{"ids": ["M007"]}');
    expect((await closest(service({ closest: fake.closest, used: 900 }), "necesito ayuda")).results).toEqual([]);
    expect(fake.prompts).toEqual([]);
    expect(notes).toEqual([expect.objectContaining({ reason: "closest_quota", answered: true, model: "command-a-03-2025" })]);
  });

  it("answers none on a failure or a timeout, tells ops how, and never the question", async () => {
    const failing = picker(() => Promise.reject(new ClosestError("closest_failed", "unavailable")));
    expect((await closest(service({ closest: failing.closest }), "necesito ayuda")).results).toEqual([]);
    const slow = picker('{"ids": ["M007"]}', CLOSEST_TIMEOUT_MS + 500);
    expect((await closest(service({ closest: slow.closest }), "necesito ayuda")).results).toEqual([]);
    expect(notes.map((n) => [n.reason, n.error])).toEqual([
      ["closest_failed", "closest_failed:unavailable"],
      ["closest_failed", "timed_out"],
    ]);
    expect(JSON.stringify(notes)).not.toContain("ayuda");
  });
});
