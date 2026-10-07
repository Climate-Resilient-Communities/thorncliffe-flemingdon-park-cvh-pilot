// What the search use case hands to the test-set runner (S03.07): `observe`, the similarities its ranking was made from, and
// the two small readers the runner uses before it asks anything: `questionLegSource` (which questions need the translated-question
// leg, so the call plan counts what the run will do) and `currentSearchFacts` (the release, model and threshold a run measures).
// With fakes only: nothing here waits for real or reaches a vendor.
import { describe, expect, it } from "vitest";
import { TRANSLATE_FIRST_OFF, createQuestionTranslator, type QuestionRoute, type Translator } from "@/modules/translation";
import { RELEASE_V, releaseDb, releaseRow } from "../../../../test/helpers/searchRelease";
import { detect } from "../domain/questionLanguage";
import type { QueryEmbedder } from "./ports";
import { SearchFailure, createSearch, currentSearchFacts, questionLegSource, questionSourceOf, type SearchObservation, type SearchSnapshot } from "./search";

const MODEL = "embed-v4.0";
const ROUTE: QuestionRoute = { ps: "north-small", prs: "north-small", ur: "north-small", romanized_or_mixed: "command-a", ambiguous_arabic: "command-a", ...TRANSLATE_FIRST_OFF };

// P1, P2 (an emergency provider) and P3, one axis each; the fourth axis is "nothing in particular".
const SNAPSHOT: SearchSnapshot = {
  releaseV: 3,
  data: {
    releaseV: 3,
    model: MODEL,
    dims: 4,
    threshold: 0.3,
    ids: ["P1", "P2", "P3"],
    vectors: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
    ],
    known: new Set(["P1", "P2", "P3"]),
    emergency: new Set(["P2"]),
  },
};

/** A unit vector whose similarity with P1, P2, P3 is the given numbers (the fourth axis is "nothing in particular"). */
const unit = (a: number, b: number, c: number) => [a, b, c, Math.sqrt(1 - a * a - b * b - c * c)];

const PASHTO = "زه وړیا حقوقي مشوره غواړم";
const MARKER = "zq9-the-question-text-must-not-be-observed";

const embedderOf = (vectors: Record<string, number[]>, fail: (text: string) => boolean = () => false): QueryEmbedder => ({
  async embedQuery({ text }) {
    if (fail(text)) throw new Error("embed failed");
    return { vector: vectors[text] ?? [0, 0, 0, 1], tokens: 3 };
  },
});

function service(parts: { embedder: QueryEmbedder; translator?: Translator; observe?: (seen: SearchObservation) => void; emergencyThreshold?: number }) {
  return createSearch({
    db: () => {
      throw new Error("no database in this test");
    },
    storage: () => {
      throw new Error("no store in this test");
    },
    embedder: parts.embedder,
    translator: parts.translator ? createQuestionTranslator({ translator: parts.translator, route: ROUTE }) : null,
    snapshot: async () => SNAPSHOT,
    writer: { log: async () => undefined, spend: async () => undefined },
    emergencyThreshold: parts.emergencyThreshold,
    observe: parts.observe,
  });
}

const translatorOf = (english: string): Translator => ({ translate: async () => ({ text: english, inputTokens: 5, outputTokens: 5 }) });

describe("observe", () => {
  it("is handed the similarity of every provider in the direct leg, the release's threshold and its emergency providers, and the answer is unchanged", async () => {
    const seen: SearchObservation[] = [];
    const answered = await service({ embedder: embedderOf({ "free legal help": [0.8, 0.6, 0, 0] }), observe: (o) => void seen.push(o) }).search({ q: "free legal help", lang: "en" });

    expect(answered).toMatchObject({ release_v: 3, status: "ok", results: [{ provider_id: "P1", score: 0.8 }, { provider_id: "P2", score: 0.6 }] });
    expect(seen).toHaveLength(1);
    const [o] = seen;
    expect(o).toMatchObject({ releaseV: 3, threshold: 0.3, emergencyThreshold: 0.25, translatedLeg: "not_needed" });
    expect(o!.emergencyProviders).toEqual(new Set(["P2"]));
    expect(o!.legs.map((l) => l.leg)).toEqual(["direct"]);
    expect(Object.fromEntries(o!.legs[0]!.similarities)).toEqual({ P1: 0.8, P2: 0.6, P3: 0 });
  });

  it("is handed the scores below the threshold, which the answer never holds (no_clear_match has no results)", async () => {
    const seen: SearchObservation[] = [];
    const answered = await service({ embedder: embedderOf({ "something odd": unit(0.2, 0.1, 0.05) }), observe: (o) => void seen.push(o) }).search({ q: "something odd", lang: "en" });

    expect(answered).toMatchObject({ status: "no_clear_match", results: [] });
    const scores = Object.fromEntries(seen[0]!.legs[0]!.similarities);
    expect(scores.P1).toBeCloseTo(0.2, 10);
    expect(scores.P2).toBeCloseTo(0.1, 10);
    expect(scores.P3).toBeCloseTo(0.05, 10);
  });

  it("is told the emergency-only threshold as configured, not cut to the release's, so a replay at another threshold can apply the same rule", async () => {
    const seen: SearchObservation[] = [];
    await service({ embedder: embedderOf({}), emergencyThreshold: 0.2, observe: (o) => void seen.push(o) }).search({ q: "anything", lang: "en" });
    expect(seen[0]!.emergencyThreshold).toBe(0.2);
  });

  it("is handed both legs when the translated-question leg completed, the direct one first, and says it was used", async () => {
    const seen: SearchObservation[] = [];
    const embedder = embedderOf({ [PASHTO]: [0, 0, 0, 1], "I want legal help": unit(0.9, 0, 0) });

    const answered = await service({ embedder, translator: translatorOf("I want legal help"), observe: (o) => void seen.push(o) }).search({ q: PASHTO, lang: "en" });

    expect(answered).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });
    expect(seen[0]).toMatchObject({ translatedLeg: "used" });
    expect(seen[0]!.legs.map((l) => l.leg)).toEqual(["direct", "translated"]);
    expect(seen[0]!.legs[1]!.similarities.get("P1")).toBeCloseTo(0.9, 10);
  });

  it("holds only the direct leg, and says the translated one failed, when the translation did not come", async () => {
    const seen: SearchObservation[] = [];
    const failing: Translator = {
      translate: async () => {
        throw new Error("vendor down");
      },
    };

    await service({ embedder: embedderOf({ [PASHTO]: [0.5, 0, 0, 0.8] }), translator: failing, observe: (o) => void seen.push(o) }).search({ q: PASHTO, lang: "en" });

    expect(seen[0]).toMatchObject({ translatedLeg: "failed" });
    expect(seen[0]!.legs.map((l) => l.leg)).toEqual(["direct"]);
  });

  it("holds nothing of the question or its translation: provider ids, similarities and codes only", async () => {
    const seen: SearchObservation[] = [];
    const english = `${MARKER} in english`;
    await service({ embedder: embedderOf({}), translator: translatorOf(english), observe: (o) => void seen.push(o) }).search({ q: `${PASHTO} ${MARKER}`, lang: "en" });

    expect(seen).toHaveLength(1);
    const text = JSON.stringify(seen[0], (_key, value: unknown) => (value instanceof Map ? Object.fromEntries(value) : value instanceof Set ? [...value] : value));
    expect(text).not.toContain(MARKER);
    expect(text).not.toContain("english");
  });

  it("is not called when the search could not answer, and a throwing observer changes nothing", async () => {
    let calls = 0;
    const unanswered = service({ embedder: embedderOf({}, () => true), observe: () => void (calls += 1) });
    await expect(unanswered.search({ q: "free legal help", lang: "en" })).rejects.toBeInstanceOf(SearchFailure);
    expect(calls).toBe(0);

    const answered = await service({
      embedder: embedderOf({ lawyer: [1, 0, 0, 0] }),
      observe: () => {
        throw new Error("a measurement bug");
      },
    }).search({ q: "lawyer", lang: "en" });
    expect(answered).toMatchObject({ status: "ok", results: [{ provider_id: "P1" }] });
  });
});

describe("questionLegSource", () => {
  it("is the rule search applies: the kind of question that needs the leg, or null", () => {
    for (const [q, lang] of [
      [PASHTO, "en"],
      ["mujhe madad chahiye", "en"],
      ["مجھے وکیل چاہیے", "en"],
      ["I need a lawyer", "en"],
      ["lawyer", "en"],
      ["Necesito un abogado", "en"],
    ] as const) {
      expect(questionLegSource({ q, lang }), q).toBe(questionSourceOf(detect(q, lang), q));
    }
    expect(questionLegSource({ q: PASHTO, lang: "en" })).toBe("ps");
    expect(questionLegSource({ q: "I need a lawyer", lang: "en" })).toBeNull();
  });

  it("reads the question as search reads it (trimmed), and is null for a request search would refuse", () => {
    expect(questionLegSource({ q: `  ${PASHTO}  `, lang: "en" })).toBe("ps");
    expect(questionLegSource({ q: "   ", lang: "en" })).toBeNull();
    expect(questionLegSource({ q: "x".repeat(201), lang: "en" })).toBeNull();
  });
});

describe("currentSearchFacts", () => {
  it("is the current release's number and the model and threshold its search data recorded, read in a transaction with a statement timeout", async () => {
    const { db, statements } = releaseDb();

    expect(await currentSearchFacts(db)).toEqual({ release: RELEASE_V, model: MODEL, threshold: 0.3 });
    expect(statements[0]).toMatch(/set local statement_timeout = 5000/);
  });

  it("is null when the current release has no search data", async () => {
    const row = { ...releaseRow(), search: null } as unknown as ReturnType<typeof releaseRow>;
    expect(await currentSearchFacts(releaseDb({ row }).db)).toBeNull();
  });
});
