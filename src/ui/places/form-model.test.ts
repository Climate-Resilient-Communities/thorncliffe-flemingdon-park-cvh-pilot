import { describe, expect, it, vi } from "vitest";
import type { ListingProvider } from "@/contracts/directory";
import { checkPlaceSubmission } from "@/contracts/placeSubmission";
import {
  CATEGORY_NOT_SURE,
  EMPTY_DRAFT,
  RESUBMIT_KEY,
  SUBMISSIONS_URL,
  addBody,
  correctionBody,
  kmBetween,
  missingFields,
  nearestBuilding,
  nearestProviders,
  sendSuggestion,
  takeResubmit,
  writeResubmit,
  type AddDraft,
} from "./form-model";

const COMPLETE: AddDraft = { ...EMPTY_DRAFT, type: "offer", name: "Thursday food bank", what: "Free groceries.", where: { kind: "address", text: "45 Overlea Blvd" } };

describe("R-19's draft", () => {
  it("lists what is still missing, in the form's order", () => {
    expect(missingFields(EMPTY_DRAFT)).toEqual(["type", "name", "what", "where"]);
    expect(missingFields({ ...COMPLETE, name: "   " })).toEqual(["name"]);
    expect(missingFields(COMPLETE)).toEqual([]);
  });

  it("becomes a body the contract accepts, with only what was answered, and never the device's choices", () => {
    const body = addBody({ ...COMPLETE, cost: "free", languages: ["ur"], phone: " ", category: CATEGORY_NOT_SURE }, "ur");
    expect(body).toEqual({
      v: 1,
      lang: "ur",
      kind: "add",
      type: "offer",
      name: "Thursday food bank",
      what: "Free groceries.",
      where: { kind: "address", text: "45 Overlea Blvd" },
      cost: "free",
      languages: ["ur"],
    });
    expect(checkPlaceSubmission(body)).toMatchObject({ ok: true, honeypot: false });
    expect(Object.keys(body)).not.toContain("buildings");
  });

  it("sends a building without an empty description, and the honeypot only when filled", () => {
    const body = addBody({ ...COMPLETE, where: { kind: "building", rsn: "4154159", text: null }, category: "Food Banks", nickname: "bot" }, "en");
    expect(body).toMatchObject({ where: { kind: "building", rsn: "4154159" }, category: "Food Banks", nickname: "bot" });
    expect(checkPlaceSubmission(body)).toMatchObject({ ok: true, honeypot: true });
  });

  it("refuses to build an incomplete body", () => {
    expect(() => addBody(EMPTY_DRAFT, "en")).toThrow();
  });
});

describe("R-22's correction", () => {
  it("sends the provider and only the changed fields", () => {
    const body = correctionBody({ id: "M014", name: "Overlea Clinic" }, { where: "Second floor", cost: "free" }, "fr");
    expect(body).toEqual({ v: 1, lang: "fr", kind: "correct", providerId: "M014", providerName: "Overlea Clinic", changes: { where: "Second floor", cost: "free" } });
    expect(checkPlaceSubmission(body).ok).toBe(true);
  });
});

describe("sendSuggestion", () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("posts the body as JSON and reads the reference code", async () => {
    const fetcher = reply(202, { v: 1, status: "received", ref: "SEED-2A2A" });
    expect(await sendSuggestion(addBody(COMPLETE, "en"), fetcher)).toEqual({ kind: "sent", ref: "SEED-2A2A" });
    expect(fetcher).toHaveBeenCalledWith(SUBMISSIONS_URL, expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } }));
  });

  it("reads the server's refusal, and anything else (no signal, an odd answer) as not sent", async () => {
    expect(await sendSuggestion(addBody(COMPLETE, "en"), reply(429, { error: { code: "rate_limited" } }))).toEqual({ kind: "refused", code: "rate_limited" });
    expect(await sendSuggestion(addBody(COMPLETE, "en"), reply(500, { error: { code: "boom" } }))).toEqual({ kind: "refused", code: "submissions_unavailable" });
    const offline = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch;
    expect(await sendSuggestion(addBody(COMPLETE, "en"), offline)).toEqual({ kind: "refused", code: "submissions_unavailable" });
  });
});

describe("nearest first (R-17) and the pin's neighbour (R-20)", () => {
  const provider = (id: string, lat: number, lng: number): ListingProvider => ({ id, name: id, locations: [{ street: "", city: "", postal: null, lat, lng }] }) as unknown as ListingProvider;

  it("measures in kilometres", () => {
    expect(kmBetween({ lat: 43.7, lng: -79.34 }, { lat: 43.71, lng: -79.34 })).toBeCloseTo(1.11, 2);
  });

  it("orders providers nearest first and leaves out one with no location", () => {
    const far = provider("M003", 43.75, -79.3);
    const near = provider("M001", 43.701, -79.34);
    const none = { ...provider("M002", 0, 0), locations: [] } as ListingProvider;
    expect(nearestProviders([far, none, near], { lat: 43.7, lng: -79.34 }).map((p) => p.provider.id)).toEqual(["M001", "M003"]);
    expect(nearestProviders([far, near], { lat: 43.7, lng: -79.34 }, 1)).toHaveLength(1);
  });

  it("names the building nearest a pin, skipping one without a point", () => {
    const buildings = [{ address: "Far" , lat: 43.8, lng: -79.3 }, { address: "No point" }, { address: "Near", lat: 43.7001, lng: -79.34 }];
    expect(nearestBuilding(buildings, { lat: 43.7, lng: -79.34 })?.address).toBe("Near");
    expect(nearestBuilding([{ address: "No point" }], { lat: 43.7, lng: -79.34 })).toBeNull();
  });
});

describe("R-23's draft handed back to R-19", () => {
  it("is read once, from this phone's session storage only", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    writeResubmit(storage, { reason: "noLocation", draft: { type: "", name: "Food bank", what: "Free food.", where: null } });
    expect(store.has(RESUBMIT_KEY)).toBe(true);
    expect(takeResubmit(storage)).toEqual({ reason: "noLocation", draft: { type: "", name: "Food bank", what: "Free food.", where: null } });
    expect(takeResubmit(storage)).toBeNull();
  });

  it("is nothing when the phone keeps nothing or kept something else", () => {
    expect(takeResubmit(null)).toBeNull();
    const broken = { getItem: () => "{not json", setItem: () => undefined, removeItem: () => undefined };
    expect(takeResubmit(broken)).toBeNull();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => undefined };
    expect(() => writeResubmit(throwing, { reason: "advert", draft: { type: "", name: "x", what: "", where: null } })).not.toThrow();
    expect(takeResubmit(throwing)).toBeNull();
  });
});
