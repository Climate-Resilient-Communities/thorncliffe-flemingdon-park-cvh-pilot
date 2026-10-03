import { describe, expect, it } from "vitest";
import { fieldsOfInstant, fieldsOfStoredInstant, foldQuestionValues, parseTimeFields, timeFieldsOf } from "./timeField";

const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(entries)) data.set(name, value);
  return data;
};

describe("timeFieldsOf", () => {
  it("reads the date, the time and the answer to the clock-change question, with the prefix", () => {
    expect(timeFieldsOf(form({ "valid-date": "2026-10-04", "valid-time": "09:30", "valid-fold": "after" }), "valid")).toEqual({ date: "2026-10-04", time: "09:30", fold: "after" });
  });

  it("reads nothing sent as empty, and an answer that is neither before nor after as not answered", () => {
    expect(timeFieldsOf(form({}), "reported")).toEqual({ date: "", time: "", fold: "" });
    expect(timeFieldsOf(form({ "reported-fold": "sideways" }), "reported").fold).toBe("");
    // A file is not text.
    const data = new FormData();
    data.set("reported-date", new Blob(["x"]), "x.txt");
    expect(timeFieldsOf(data, "reported").date).toBe("");
  });
});

describe("parseTimeFields (Toronto wall-clock time)", () => {
  it("is the instant of an ordinary time, in summer (UTC-4) and in winter (UTC-5)", () => {
    expect(parseTimeFields({ date: "2026-10-04", time: "09:30", fold: "" })).toEqual({ ok: true, instant: new Date("2026-10-04T13:30:00.000Z") });
    expect(parseTimeFields({ date: "2026-12-04", time: "09:30", fold: "" })).toEqual({ ok: true, instant: new Date("2026-12-04T14:30:00.000Z") });
  });

  it("refuses what is not a date and a time", () => {
    for (const fields of [
      { date: "", time: "", fold: "" as const },
      { date: "2026-10-04", time: "", fold: "" as const },
      { date: "", time: "09:30", fold: "" as const },
      { date: "2026-02-30", time: "09:30", fold: "" as const },
      { date: "2026-10-04", time: "25:00", fold: "" as const },
      { date: "yesterday", time: "noon", fold: "" as const },
    ]) {
      expect(parseTimeFields(fields), JSON.stringify(fields)).toEqual({ ok: false, problem: "invalid" });
    }
  });

  it("refuses a time the clocks skip going forward (2:30 on 8 March 2026), whatever the answer", () => {
    for (const fold of ["", "before", "after"] as const) {
      expect(parseTimeFields({ date: "2026-03-08", time: "02:30", fold }), fold).toEqual({ ok: false, problem: "nonexistent" });
    }
    // The minute after the skipped hour exists.
    expect(parseTimeFields({ date: "2026-03-08", time: "03:00", fold: "" })).toEqual({ ok: true, instant: new Date("2026-03-08T07:00:00.000Z") });
  });

  it("asks which one is meant for a time the clocks repeat going back (1:30 on 1 November 2026), and reads the answer", () => {
    expect(parseTimeFields({ date: "2026-11-01", time: "01:30", fold: "" })).toEqual({
      ok: false,
      problem: "ambiguous",
      before: new Date("2026-11-01T05:30:00.000Z"),
      after: new Date("2026-11-01T06:30:00.000Z"),
    });
    expect(parseTimeFields({ date: "2026-11-01", time: "01:30", fold: "before" })).toEqual({ ok: true, instant: new Date("2026-11-01T05:30:00.000Z") });
    expect(parseTimeFields({ date: "2026-11-01", time: "01:30", fold: "after" })).toEqual({ ok: true, instant: new Date("2026-11-01T06:30:00.000Z") });
    // An hour either side is not repeated: the answer is ignored.
    expect(parseTimeFields({ date: "2026-11-01", time: "00:30", fold: "after" })).toEqual({ ok: true, instant: new Date("2026-11-01T04:30:00.000Z") });
    expect(parseTimeFields({ date: "2026-11-01", time: "02:30", fold: "before" })).toEqual({ ok: true, instant: new Date("2026-11-01T07:30:00.000Z") });
  });
});

describe("fieldsOfInstant", () => {
  it("is the Toronto date and time of an instant, with no answer to the question", () => {
    expect(fieldsOfInstant(new Date("2026-10-04T13:30:00.000Z"))).toEqual({ date: "2026-10-04", time: "09:30", fold: "" });
    expect(fieldsOfInstant(new Date("2026-12-04T02:15:00.000Z"))).toEqual({ date: "2026-12-03", time: "21:15", fold: "" });
  });

  it("round-trips an instant through the form fields", () => {
    for (const iso of ["2026-10-04T13:30:00.000Z", "2026-12-31T04:59:00.000Z", "2026-07-01T00:00:00.000Z"]) {
      expect(parseTimeFields(fieldsOfInstant(new Date(iso)))).toEqual({ ok: true, instant: new Date(iso) });
    }
  });
});

describe("fieldsOfStoredInstant", () => {
  const EDT = new Date("2026-11-01T05:30:00.000Z");
  const EST = new Date("2026-11-01T06:30:00.000Z");

  it("is the same fields as fieldsOfInstant for a time that is not repeated", () => {
    for (const iso of ["2026-10-04T13:30:00.000Z", "2026-12-04T02:15:00.000Z", "2026-11-01T04:30:00.000Z", "2026-11-01T07:30:00.000Z", "2026-03-08T06:59:00.000Z"]) {
      expect(fieldsOfStoredInstant(new Date(iso)), iso).toEqual(fieldsOfInstant(new Date(iso)));
    }
  });

  it("carries the answer to the clock-change question for a time in the repeated autumn hour, EDT as before and EST as after", () => {
    expect(fieldsOfStoredInstant(EDT)).toEqual({ date: "2026-11-01", time: "01:30", fold: "before" });
    expect(fieldsOfStoredInstant(EST)).toEqual({ date: "2026-11-01", time: "01:30", fold: "after" });
    // Seconds (an "until resolved" time has them) do not change which of the two it is.
    expect(fieldsOfStoredInstant(new Date("2026-11-01T05:30:42.000Z")).fold).toBe("before");
    expect(fieldsOfStoredInstant(new Date("2026-11-01T06:30:42.000Z")).fold).toBe("after");
  });

  it("reads back, with no question asked, as the instant that was stored; the bare fields of that instant would ask again", () => {
    expect(parseTimeFields(fieldsOfStoredInstant(EDT))).toEqual({ ok: true, instant: EDT });
    expect(parseTimeFields(fieldsOfStoredInstant(EST))).toEqual({ ok: true, instant: EST });
    expect(parseTimeFields(fieldsOfInstant(EST))).toMatchObject({ ok: false, problem: "ambiguous" });
  });
});

describe("foldQuestionValues", () => {
  it("names the repeated time without a zone and the two readings with their zones", () => {
    const parse = parseTimeFields({ date: "2026-11-01", time: "01:30", fold: "" });
    if (parse.ok || parse.problem !== "ambiguous") throw new Error("expected the repeated time to be ambiguous");
    const values = foldQuestionValues(parse);
    expect(values.time).toBe("1:30 a.m.");
    expect(values.date).toContain("November");
    expect(values.before).toMatch(/1:30 a\.m\. EDT/);
    expect(values.after).toMatch(/1:30 a\.m\. EST/);
  });
});
