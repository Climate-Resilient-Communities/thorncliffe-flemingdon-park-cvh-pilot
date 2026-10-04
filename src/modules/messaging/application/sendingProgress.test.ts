import { describe, expect, it, vi } from "vitest";
import type { DbExecutor } from "../../../platform/db";
import { PROBLEM_LIST_LIMIT, createSendingProgress, type ProblemRow, type ProgressStore } from "./sendingProgress";

const executor = {} as DbExecutor;
const lang = (code: string, over: Partial<{ waiting: number; inFlight: number; delivered: number; failed: number }> = {}) => ({
  lang: code,
  waiting: 0,
  inFlight: 0,
  delivered: 0,
  undelivered: 0,
  failed: 0,
  unknown: 0,
  cancelled: 0,
  skipped: 0,
  ...over,
});

const row = (n: number, over: Partial<ProblemRow> = {}): ProblemRow => ({ id: `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`, lang: "en", state: "failed", providerErrorCode: null, attempts: 1, at: new Date(2026, 9, 5, 12, 0, n), ...over });

function service(over: Partial<ProgressStore> = {}) {
  const store: ProgressStore = {
    languageCounts: vi.fn(async () => ({ languages: [lang("en", { waiting: 2, delivered: 5 }), lang("ur", { inFlight: 1, failed: 3 })], handedOff: 9 })),
    problemRows: vi.fn(async () => []),
    ...over,
  };
  return { store, progress: createSendingProgress({ store }) };
}

describe("the sending progress of an entry", () => {
  it("is the store's counts per language with their sum and the entry's hand-offs", async () => {
    const { progress, store } = service();
    const answer = await progress.forEntry(executor, "entry-1");
    expect(store.languageCounts).toHaveBeenCalledWith(executor, "entry-1");
    expect(answer.languages.map((language) => language.lang)).toEqual(["en", "ur"]);
    expect(answer.total).toMatchObject({ waiting: 2, inFlight: 1, delivered: 5, failed: 3 });
    expect(answer.texts).toBe(11);
    expect(answer.handedOff).toBe(9);
  });

  it("is empty for an entry with no text", async () => {
    const { progress } = service({ languageCounts: async () => ({ languages: [], handedOff: 0 }) });
    expect(await progress.forEntry(executor, "entry-1")).toMatchObject({ languages: [], texts: 0, handedOff: 0 });
  });
});

describe("the texts that did not arrive", () => {
  it("asks the store for the three states, or the one asked for, and one text more than it shows", async () => {
    const { progress, store } = service();
    await progress.problemTexts(executor, "entry-1");
    expect(store.problemRows).toHaveBeenLastCalledWith(executor, "entry-1", ["failed", "undelivered", "unknown"], PROBLEM_LIST_LIMIT + 1);
    await progress.problemTexts(executor, "entry-1", "unknown");
    expect(store.problemRows).toHaveBeenLastCalledWith(executor, "entry-1", ["unknown"], PROBLEM_LIST_LIMIT + 1);
  });

  it("puts each in plain meaning with a reference, and keeps the order the store gave", async () => {
    const rows = [row(1, { providerErrorCode: 30005 }), row(2, { state: "unknown" }), row(3, { state: "undelivered", providerErrorCode: 30006 }), row(4, { attempts: 3 })];
    const { progress } = service({ problemRows: async () => rows });
    const { texts, more } = await progress.problemTexts(executor, "entry-1");
    expect(more).toBe(false);
    expect(texts.map((text) => [text.meaning, text.reference])).toEqual([
      ["not_in_service", "000001"],
      ["unclear", "000002"],
      ["landline", "000003"],
      ["retries_exhausted", "000004"],
    ]);
    expect(texts.map((text) => text.id)).toEqual(rows.map((r) => r.id));
  });

  it("shows the most recent 200 and says there are more when the store had one over", async () => {
    const many = Array.from({ length: PROBLEM_LIST_LIMIT + 1 }, (_, index) => row(index + 1));
    const { progress } = service({ problemRows: async () => many });
    const { texts, more } = await progress.problemTexts(executor, "entry-1");
    expect(texts).toHaveLength(PROBLEM_LIST_LIMIT);
    expect(more).toBe(true);
    expect(PROBLEM_LIST_LIMIT).toBe(200);
    const exact = await service({ problemRows: async () => many.slice(0, PROBLEM_LIST_LIMIT) }).progress.problemTexts(executor, "entry-1");
    expect(exact.texts).toHaveLength(PROBLEM_LIST_LIMIT);
    expect(exact.more).toBe(false);
  });
});
