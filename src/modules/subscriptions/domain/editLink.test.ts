import { describe, expect, it } from "vitest";
import { editLinkUrl, groupsAfterChange, placeRows, placesOfRows, redactEditTokens, samePlaces } from "./editLink";

const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE";
const F1 = "0190f000-0000-7000-8000-000000000001";
const F2 = "0190f000-0000-7000-8000-000000000002";

describe("the edit link's address (S07.06)", () => {
  it("is the page in the subscriber's language on the public origin, with no doubled slash", () => {
    expect(editLinkUrl("https://cvh.example", "ur", TOKEN)).toBe(`https://cvh.example/ur/subscription/${TOKEN}`);
    expect(editLinkUrl("https://cvh.example//", "en", TOKEN)).toBe(`https://cvh.example/en/subscription/${TOKEN}`);
  });
});

describe("redactEditTokens", () => {
  it("takes the token out of a page path in any language, a full address and a bare token, and leaves the API's own paths", () => {
    expect(redactEditTokens(`GET /prs/subscription/${TOKEN}?a=1`)).toBe("GET /prs/subscription/[token]?a=1");
    expect(redactEditTokens(`https://cvh.example/en/subscription/${TOKEN}`)).toBe("https://cvh.example/en/subscription/[token]");
    expect(redactEditTokens(`/en/subscription/short`)).toBe("/en/subscription/[token]");
    expect(redactEditTokens(`token=${TOKEN};`)).toBe("token=[token];");
    expect(redactEditTokens("POST /api/subscription/change")).toBe("POST /api/subscription/change");
  });

  it("leaves ids, hashes and SIDs of other lengths as they are", () => {
    const text = `${F1} ${"f".repeat(64)} SM${"0".repeat(32)} ${"x".repeat(42)} ${"y".repeat(44)}`;
    expect(redactEditTokens(text)).toBe(text);
  });
});

describe("the page's places and the saved rows", () => {
  it("are one row per building and floor, and one row with no floor for a building without one", () => {
    expect(placeRows([{ rsn: "1", floors: [F1, F2] }, { rsn: "2", floors: [] }])).toEqual([
      { rsn: "1", floorId: F1 },
      { rsn: "1", floorId: F2 },
      { rsn: "2", floorId: null },
    ]);
  });

  it("read back by building number with floors sorted; a row with no floor beside floors adds the building only", () => {
    expect(placesOfRows([{ rsn: "2", floorId: null }, { rsn: "1", floorId: F2 }, { rsn: "1", floorId: null }, { rsn: "1", floorId: F1 }])).toEqual([
      { rsn: "1", floors: [F1, F2] },
      { rsn: "2", floors: [] },
    ]);
  });

  it("are the same places whatever their order or repeats", () => {
    expect(samePlaces([{ rsn: "1", floorId: F1 }, { rsn: "2", floorId: null }], [{ rsn: "2", floorId: null }, { rsn: "1", floorId: F1 }, { rsn: "1", floorId: F1 }])).toBe(true);
    expect(samePlaces([{ rsn: "1", floorId: F1 }], [{ rsn: "1", floorId: F2 }])).toBe(false);
    expect(samePlaces([{ rsn: "1", floorId: null }], [{ rsn: "1", floorId: F1 }])).toBe(false);
  });
});

describe("groupsAfterChange", () => {
  it("is the groups chosen on the page, with the check-in group (E08's, not on the page) kept as it was", () => {
    expect(groupsAfterChange(["seniors", "checkin"], ["families"])).toEqual(["families", "checkin"]);
    expect(groupsAfterChange(["seniors"], [])).toEqual([]);
    expect(groupsAfterChange([], ["newcomers"])).toEqual(["newcomers"]);
  });
});
