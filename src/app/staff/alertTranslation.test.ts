// What a submit's translation is made of in each environment (S04.05): the sample fake (local development and the end-to-end tests) is cached
// under a prompt version of its own and records no spend, so what it makes (sample sentences, not translations of the alert) is never served
// under the key of a real model; Cohere's is cached under the real prompt version and counted in spend; with no model every language falls back.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SubmitTranslatorDeps } from "@/modules/translation";

const mocks = vi.hoisted(() => ({
  env: { fakeTranslator: undefined as string | undefined, cohereApiKey: undefined as string | undefined },
  createSubmitTranslator: vi.fn(),
  recordSpendEvent: vi.fn(async () => undefined),
}));

vi.mock("@/modules/translation", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/modules/translation")>()), createSubmitTranslator: mocks.createSubmitTranslator }));
vi.mock("@/modules/spend", () => ({ recordSpendEvent: mocks.recordSpendEvent }));
vi.mock("@/modules/directory", () => ({ openccZhHant: vi.fn() }));
vi.mock("@/platform/config/env", () => ({ getEnv: () => mocks.env }));
vi.mock("@/platform/db", () => ({ getDb: () => ({ marker: "db" }) }));

import { PROMPT_VERSION } from "@/modules/translation";
import { alertTranslation, promptVersionOf } from "./alertTranslation";

const built = () => mocks.createSubmitTranslator.mock.calls.at(-1)![0] as SubmitTranslatorDeps;

beforeEach(() => {
  mocks.env.fakeTranslator = undefined;
  mocks.env.cohereApiKey = undefined;
  mocks.createSubmitTranslator.mockReset();
  mocks.createSubmitTranslator.mockReturnValue({ translate: vi.fn() });
  mocks.recordSpendEvent.mockClear();
});

describe("the prompt version a translation is cached under", () => {
  it("is the real one, and the sample fake's own, which no real key can equal", () => {
    expect(promptVersionOf(false)).toBe(PROMPT_VERSION);
    expect(promptVersionOf(true)).toBe(`${PROMPT_VERSION}+sample`);
    expect(promptVersionOf(true)).not.toBe(promptVersionOf(false));
  });
});

describe("the translation of an environment", () => {
  it("with the sample fake is cached under its own prompt version and records no spend", async () => {
    mocks.env.fakeTranslator = "sample";

    expect(alertTranslation().configured).toBe(true);

    const deps = built();
    expect(deps.promptVersion).toBe(`${PROMPT_VERSION}+sample`);
    await deps.recordSpend({} as never);
    expect(mocks.recordSpendEvent).not.toHaveBeenCalled();
  });

  it("with a Cohere key is cached under the real prompt version and counted in spend", async () => {
    mocks.env.cohereApiKey = "test-key";

    expect(alertTranslation().configured).toBe(true);

    const deps = built();
    expect(deps.promptVersion).toBe(PROMPT_VERSION);
    const event = { kind: "translate" } as never;
    await deps.recordSpend(event);
    expect(mocks.recordSpendEvent).toHaveBeenCalledWith({ marker: "db" }, event);
  });

  it("with no model is not configured and builds no translator: every language is the English fallback", () => {
    const result = alertTranslation();

    expect(result.configured).toBe(false);
    expect(mocks.createSubmitTranslator).not.toHaveBeenCalled();
  });
});
