import { describe, expect, it } from "vitest";
import {
  PLACE_SUBMISSION_CONTRACT_VERSION,
  PlaceSubmissionStatusSchema,
  checkPlaceSubmission,
  normaliseRef,
  placeSubmissionErrorBody,
  type PlaceSubmissionRequestBody,
} from "./placeSubmission";

const ADD: PlaceSubmissionRequestBody = {
  v: PLACE_SUBMISSION_CONTRACT_VERSION,
  lang: "ur",
  kind: "add",
  type: "offer",
  name: "  Thursday   food bank ",
  what: "Free groceries on Thursday evenings.",
  where: { kind: "address", text: "45 Overlea Blvd" },
};

const CORRECT: PlaceSubmissionRequestBody = {
  v: PLACE_SUBMISSION_CONTRACT_VERSION,
  lang: "en",
  kind: "correct",
  providerId: "M001",
  providerName: "Thorncliffe Neighbourhood Office",
  changes: { where: "Second floor, room 204" },
};

describe("the place suggestion contract (PRD §6.3, R-19, R-22)", () => {
  it("accepts a new place with only what R-19 needs, its text trimmed to one line", () => {
    const checked = checkPlaceSubmission(ADD);
    expect(checked).toMatchObject({ ok: true, honeypot: false });
    if (!checked.ok) return;
    expect(checked.value).toMatchObject({ kind: "add", name: "Thursday food bank", where: { kind: "address", text: "45 Overlea Blvd" } });
  });

  it("reads an empty optional answer as none", () => {
    const checked = checkPlaceSubmission({ ...ADD, phone: "   ", web: "", category: " " });
    expect(checked.ok && checked.value.kind === "add" && [checked.value.phone, checked.value.web, checked.value.category]).toEqual([null, null, null]);
  });

  it.each([
    ["no type", { type: undefined }],
    ["a blank name", { name: "   " }],
    ["a name longer than 80 characters", { name: "x".repeat(81) }],
    ["a sentence longer than 140 characters", { what: "x".repeat(141) }],
    ["no location", { where: undefined }],
    ["a pin outside Toronto", { where: { kind: "pin", lat: 45.5, lng: -73.6 } }],
    ["a building that is not a register number", { where: { kind: "building", rsn: "12a" } }],
    ["an unknown cost", { cost: "cheap" }],
    ["a field the form does not send", { email: "someone@example.com" }],
    ["the resident's saved choices", { buildings: ["4154159"] }],
    ["another contract version", { v: 2 }],
  ])("refuses %s", (_case, change) => {
    expect(checkPlaceSubmission({ ...ADD, ...change })).toEqual({ ok: false, code: "invalid_request" });
  });

  it("accepts a pin inside Toronto and a building with where in it", () => {
    expect(checkPlaceSubmission({ ...ADD, where: { kind: "pin", lat: 43.71, lng: -79.34 } }).ok).toBe(true);
    const building = checkPlaceSubmission({ ...ADD, where: { kind: "building", rsn: "4154159", text: "the community room" } });
    expect(building.ok && building.value.kind === "add" && building.value.where).toEqual({ kind: "building", rsn: "4154159", text: "the community room" });
  });

  it("accepts a correction with at least one change, and refuses one that changes nothing", () => {
    expect(checkPlaceSubmission(CORRECT).ok).toBe(true);
    expect(checkPlaceSubmission({ ...CORRECT, changes: {} })).toEqual({ ok: false, code: "invalid_request" });
    expect(checkPlaceSubmission({ ...CORRECT, providerId: "m001" })).toEqual({ ok: false, code: "invalid_request" });
    expect(checkPlaceSubmission({ ...CORRECT, changes: { cost: "free", hours: "9 to 5" } })).toEqual({ ok: false, code: "invalid_request" });
  });

  it("marks a body whose honeypot is filled in", () => {
    expect(checkPlaceSubmission({ ...ADD, nickname: "" })).toMatchObject({ ok: true, honeypot: false });
    expect(checkPlaceSubmission({ ...ADD, nickname: "Bot" })).toMatchObject({ ok: true, honeypot: true });
  });

  it("names the catalog key of each failure", () => {
    expect(placeSubmissionErrorBody("rate_limited")).toEqual({ error: { code: "rate_limited", message_key: "places.errors.rate_limited" } });
  });
});

describe("normaliseRef", () => {
  it("reads a code as a person types it", () => {
    expect(normaliseRef("seed-2a2a")).toBe("SEED-2A2A");
    expect(normaliseRef(" seed 2a2a ")).toBe("SEED-2A2A");
    expect(normaliseRef("SEED2A2A")).toBe("SEED-2A2A");
  });

  it("refuses what cannot be a code: letters people mix up, the wrong length, anything else", () => {
    for (const input of ["SEED-2A2O", "SEED-2A21", "SEED-2A2", "SEED-2A2A2", "", 42, null, "x".repeat(50)]) expect(normaliseRef(input), String(input)).toBeNull();
  });
});

describe("the status body (R-23)", () => {
  it("carries the suggestion's words and the Hub's reason, and no field about who sent it or who decided", () => {
    const shape = Object.keys(PlaceSubmissionStatusSchema.shape).sort();
    expect(shape).toEqual(["decided_at", "kind", "name", "reason", "ref", "sent_at", "status", "v", "what", "where", "where_text"]);
  });
});
