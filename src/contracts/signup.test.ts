import { describe, expect, it } from "vitest";
import { CANADIAN_AREA_CODES, CANADIAN_AREA_CODES_BY_REGION, isCanadianAreaCode } from "./canadianAreaCodes";
import {
  SIGNUP_ACCEPTED,
  SIGNUP_ERROR_CODES,
  SIGNUP_ERROR_STATUS,
  SignupAcceptedSchema,
  SignupErrorSchema,
  canadianNumber,
  checkSignupRequest,
  presetNeighbourhood,
  signupErrorBody,
  type SignupRequestBody,
} from "./signup";

// Every number here is fictional: the 555 exchange.
const FLOOR_A = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const FLOOR_B = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c";

const valid = (patch: Partial<SignupRequestBody> = {}): SignupRequestBody => ({
  v: 1,
  phone: "416 555 0123",
  lang: "ur",
  neighbourhood: "TP",
  places: [],
  groups: [],
  consent_version: "2026-10-02.1",
  terms_agreed: true,
  age_confirmed: true,
  ...patch,
});

describe("the Canadian area-code list (E07 definitions, config)", () => {
  it("holds the Toronto codes and the other provinces' codes, each once, all three digits", () => {
    for (const code of ["416", "647", "437", "942", "905", "289", "365", "604", "514", "403", "902", "867"]) expect(isCanadianAreaCode(code), code).toBe(true);
    const all = Object.values(CANADIAN_AREA_CODES_BY_REGION).flat();
    expect(all.length).toBe(CANADIAN_AREA_CODES.size);
    expect(all.every((code) => /^[2-9][0-9]{2}$/.test(code))).toBe(true);
  });

  it("leaves out American codes, toll-free codes and Canada's non-geographic codes", () => {
    for (const code of ["212", "202", "917", "800", "888", "877", "600", "622", "633"]) expect(isCanadianAreaCode(code), code).toBe(false);
  });
});

describe("canadianNumber", () => {
  it("reads a Canadian number however it is written, as E.164", () => {
    for (const typed of ["4165550123", "416 555 0123", "(416) 555-0123", "416.555.0123", "+1 416 555 0123", "1-416-555-0123", " +14165550123 "]) {
      expect(canadianNumber(typed), typed).toBe("+14165550123");
    }
  });

  it("reads a number typed with an Urdu, Arabic, Bengali, Devanagari, Gujarati, Gurmukhi, Tamil or full-width keyboard's digits", () => {
    for (const typed of [
      "۴۱۶ ۵۵۵ ۰۱۲۳", // Urdu, Pashto, Dari
      "\u200f۴۱۶-۵۵۵-۰۱۲۳\u200f", // with the right-to-left marks a keyboard can add
      "٤١٦ ٥٥٥ ٠١٢٣",
      "৪১৬ ৫৫৫ ০১২৩",
      "४१६ ५५५ ०१२३",
      "૪૧૬ ૫૫૫ ૦૧૨૩",
      "੪੧੬ ੫੫੫ ੦੧੨੩",
      "௪௧௬ ௫௫௫ ௦௧௨௩",
      "４１６ ５５５ ０１２３",
      "＋１（４１６）５５５－０１２３", // full-width signs too
      "416 ۵۵۵ ０１２３", // mixed
    ]) {
      expect(canadianNumber(typed), typed).toBe("+14165550123");
    }
    expect(canadianNumber("۲۱۲ ۵۵۵ ۰۱۲۳")).toBeNull(); // New York, in Urdu digits
  });

  it("refuses a number that is not Canadian, not ten digits, or has letters or other signs", () => {
    for (const typed of [
      "212 555 0123", // New York
      "800 555 0123", // toll-free
      "416 555 012",
      "416 555 01234",
      "2 416 555 0123",
      "+44 20 7946 0958",
      "+2 416 555 0123",
      "416 155 0123", // an exchange cannot start with 1
      "416-555-O123",
      "416 555 0123 ext 4",
      "416#555#0123",
      "",
      "1".repeat(41),
    ]) {
      expect(canadianNumber(typed), typed).toBeNull();
    }
    expect(canadianNumber(4165550123)).toBeNull();
    expect(canadianNumber(null)).toBeNull();
  });
});

describe("checkSignupRequest", () => {
  it("accepts a valid sign-up, with the number in E.164 and the places sorted and without repeats", () => {
    const checked = checkSignupRequest(
      valid({
        places: [
          { rsn: "200", floors: [FLOOR_B.toUpperCase(), FLOOR_A] },
          { rsn: "100", floors: [] },
          { rsn: "200", floors: [FLOOR_B] },
        ],
        groups: ["newcomers", "seniors", "seniors"],
      }),
    );

    expect(checked).toEqual({
      ok: true,
      value: {
        phone: "+14165550123",
        lang: "ur",
        neighbourhood: "TP",
        places: [
          { rsn: "100", floors: [] },
          { rsn: "200", floors: [FLOOR_A, FLOOR_B] },
        ],
        groups: ["seniors", "newcomers"],
        consentVersion: "2026-10-02.1",
      },
    });
  });

  it("refuses with the reason a resident can fix, in the order the form shows them", () => {
    expect(checkSignupRequest(valid({ phone: "212 555 0123" }))).toEqual({ ok: false, code: "phone_not_canadian" });
    expect(checkSignupRequest(valid({ neighbourhood: null }))).toEqual({ ok: false, code: "neighbourhood_missing" });
    expect(checkSignupRequest(valid({ neighbourhood: undefined }))).toEqual({ ok: false, code: "neighbourhood_missing" });
    expect(checkSignupRequest(valid({ terms_agreed: false }))).toEqual({ ok: false, code: "terms_not_agreed" });
    expect(checkSignupRequest(valid({ age_confirmed: false }))).toEqual({ ok: false, code: "age_not_confirmed" });
    expect(checkSignupRequest(valid({ phone: "212", neighbourhood: null, terms_agreed: false }))).toEqual({ ok: false, code: "phone_not_canadian" });
  });

  it("refuses what is not a sign-up as an unreadable request", () => {
    for (const raw of [
      null,
      "text",
      { ...valid(), v: 2 },
      { ...valid(), lang: "zh-Hant" },
      { ...valid(), lang: "xx" },
      { ...valid(), groups: ["checkin"] },
      { ...valid(), places: [{ rsn: "a1", floors: [] }] },
      { ...valid(), places: [{ rsn: "100", floors: ["floor 2"] }] },
      { ...valid(), extra: true },
      { ...valid(), name: "Amina" },
      { ...valid(), terms_agreed: "yes" },
    ]) {
      expect(checkSignupRequest(raw), JSON.stringify(raw)).toEqual({ ok: false, code: "invalid_request" });
    }
  });
});

describe("the answers", () => {
  it("is one accepted body, and a failure body per code with its status and its catalog key", () => {
    expect(SignupAcceptedSchema.parse(SIGNUP_ACCEPTED)).toEqual({ v: 1, status: "accepted" });
    for (const code of SIGNUP_ERROR_CODES) {
      expect(SignupErrorSchema.parse(signupErrorBody(code))).toEqual({ error: { code, message_key: `signup.error.${code}` } });
    }
    expect(SIGNUP_ERROR_STATUS.rate_limited).toBe(429);
    expect(SIGNUP_ERROR_STATUS.terms_changed).toBe(409);
    expect(SIGNUP_ERROR_STATUS.signup_unavailable).toBe(503);
    expect(SIGNUP_ERROR_STATUS.phone_not_canadian).toBe(400);
  });
});

describe("presetNeighbourhood", () => {
  const list = new Map([
    ["1", "TP"],
    ["2", "TP"],
    ["3", "FP"],
  ]);
  const of = (rsn: string) => list.get(rsn);

  it("is the neighbourhood every saved building is in", () => {
    expect(presetNeighbourhood(["1"], of)).toBe("TP");
    expect(presetNeighbourhood(["1", "2"], of)).toBe("TP");
    expect(presetNeighbourhood(["3"], of)).toBe("FP");
  });

  it("is none with no saved building, with buildings in both neighbourhoods, or with a building the list does not have", () => {
    expect(presetNeighbourhood([], of)).toBeNull();
    expect(presetNeighbourhood(["1", "3"], of)).toBeNull();
    expect(presetNeighbourhood(["1", "9"], of)).toBeNull();
  });
});
