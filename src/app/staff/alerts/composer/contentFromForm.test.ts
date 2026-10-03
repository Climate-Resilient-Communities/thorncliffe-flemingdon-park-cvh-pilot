import { describe, expect, it } from "vitest";
import { UNTIL_RESOLVED_MS, type EntryContent } from "@/modules/alerting";
import { contentFromForm, normaliseText } from "./contentFromForm";

const NOW = new Date("2026-10-04T14:00:00.000Z");

const draft: EntryContent = {
  text: "The elevator at 45 Thorncliffe Park Drive is out.",
  types: ["elevator", "power"],
  audience: { scope: "buildings", buildings: [{ rsn: "7001", floors: null }], groups: [], types: ["elevator", "power"] },
  phase: "problem",
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
};

const form = (entries: Array<[string, string]>) => {
  const data = new FormData();
  for (const [name, value] of entries) data.append(name, value);
  return data;
};

function content(result: ReturnType<typeof contentFromForm>): EntryContent {
  if (!result.ok) throw new Error(`expected content, got ${JSON.stringify(result.problem)}`);
  return result.content;
}

describe("normaliseText", () => {
  it("makes line ends \\n and trims what is around the text", () => {
    expect(normaliseText("  one\r\ntwo\rthree  \n")).toBe("one\ntwo\nthree");
  });
});

describe("contentFromForm", () => {
  it("keeps what the form does not carry: the acknowledgement composer sends no types and no phase", () => {
    const result = content(contentFromForm(form([["text", "We know about it."], ["valid-mode", "resolved"]]), draft, NOW));
    expect(result.types).toEqual(["elevator", "power"]);
    expect(result.phase).toBe("problem");
    expect(result.audience).toEqual(draft.audience);
    expect(result.text).toBe("We know about it.");
  });

  it("keeps the draft's text when none is sent", () => {
    expect(content(contentFromForm(form([["valid-mode", "resolved"]]), draft, NOW)).text).toBe(draft.text);
  });

  it("reads until resolved as 24 elapsed hours from now", () => {
    expect(content(contentFromForm(form([["valid-mode", "resolved"]]), draft, NOW)).validUntil).toEqual(new Date(NOW.getTime() + UNTIL_RESOLVED_MS));
    // An absent mode is the same as "until resolved".
    expect(content(contentFromForm(form([]), draft, NOW)).validUntil).toEqual(new Date(NOW.getTime() + UNTIL_RESOLVED_MS));
  });

  it("records how the valid-until was chosen, so the composer opens on that choice and a later save means the same thing", () => {
    expect(content(contentFromForm(form([["valid-mode", "resolved"]]), draft, NOW)).validUntilMode).toBe("resolved");
    expect(content(contentFromForm(form([["valid-mode", "at"], ["valid-date", "2026-10-06"], ["valid-time", "17:45"]]), draft, NOW)).validUntilMode).toBe("at");
  });

  it("reads a date and a time as Toronto time", () => {
    const result = content(contentFromForm(form([["valid-mode", "at"], ["valid-date", "2026-10-06"], ["valid-time", "17:45"]]), draft, NOW));
    expect(result.validUntil).toEqual(new Date("2026-10-06T21:45:00.000Z"));
  });

  it("reads the types ticked, each once and in order, and follows them with the audience's own topics", () => {
    const result = content(contentFromForm(form([["types-sent", "1"], ["type", "water"], ["type", "elevator"], ["type", "water"], ["phase", "in_progress"]]), draft, NOW));
    expect(result.types).toEqual(["elevator", "water"]);
    expect(result.audience.types).toEqual(["elevator", "water"]);
    expect(result.audience.scope).toBe("buildings");
    expect(result.phase).toBe("in_progress");
  });

  it("reads no type ticked on the alert composer as none (the use case refuses it), not as the draft's own", () => {
    expect(content(contentFromForm(form([["types-sent", "1"]]), draft, NOW)).types).toEqual([]);
  });

  it("ignores a phase that is not one of the two", () => {
    expect(content(contentFromForm(form([["phase", "resolved"]]), draft, NOW)).phase).toBe("problem");
  });

  it("says what is wrong with a time that is not a date and a time", () => {
    const result = contentFromForm(form([["valid-mode", "at"], ["valid-date", ""], ["valid-time", ""]]), draft, NOW);
    expect(result).toEqual({ ok: false, problem: { kind: "message", message: "Enter a date and a time." } });
  });

  it("says a time the clocks skip does not exist", () => {
    const result = contentFromForm(form([["valid-mode", "at"], ["valid-date", "2026-03-08"], ["valid-time", "02:30"]]), draft, new Date("2026-03-01T12:00:00.000Z"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problem).toMatchObject({ kind: "message", message: expect.stringContaining("does not exist in Toronto") });
  });

  it("asks before or after for a time the clocks repeat, and reads the answer", () => {
    const base: Array<[string, string]> = [["valid-mode", "at"], ["valid-date", "2026-11-01"], ["valid-time", "01:30"]];
    const asked = contentFromForm(form(base), draft, new Date("2026-10-30T12:00:00.000Z"));
    expect(asked.ok).toBe(false);
    if (!asked.ok) {
      expect(asked.problem).toMatchObject({ kind: "ask", question: expect.stringContaining("happens twice on") });
      if (asked.problem.kind === "ask") {
        expect(asked.problem.before).toMatch(/^Before the clock change \(1:30 a\.m\. EDT\)$/);
        expect(asked.problem.after).toMatch(/^After the clock change \(1:30 a\.m\. EST\)$/);
      }
    }
    expect(content(contentFromForm(form([...base, ["valid-fold", "before"]]), draft, new Date("2026-10-30T12:00:00.000Z"))).validUntil).toEqual(new Date("2026-11-01T05:30:00.000Z"));
    expect(content(contentFromForm(form([...base, ["valid-fold", "after"]]), draft, new Date("2026-10-30T12:00:00.000Z"))).validUntil).toEqual(new Date("2026-11-01T06:30:00.000Z"));
  });
});
