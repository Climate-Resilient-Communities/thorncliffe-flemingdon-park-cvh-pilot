import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChosenContacts, chosenRsns } from "./chosen-contacts";

describe("chosenRsns", () => {
  it("reads the buildings the resident chose, in the order they chose them, once each", () => {
    expect(chosenRsns(JSON.stringify({ v: 1, buildings: ["4154159", "4154146", "4154159"] }))).toEqual(["4154159", "4154146"]);
  });

  it("is empty for no choices, unreadable text, another version, or no buildings", () => {
    for (const raw of [null, "", "not json", JSON.stringify({ v: 2, buildings: ["1"] }), JSON.stringify({ v: 1 }), JSON.stringify({ v: 1, buildings: "1" })]) {
      expect(chosenRsns(raw), String(raw)).toEqual([]);
    }
  });

  it("ignores anything that is not a register number", () => {
    expect(chosenRsns(JSON.stringify({ v: 1, buildings: ["4154146", "abc", 4154159, "1; drop table building", "", "1234567890"] }))).toEqual(["4154146"]);
  });

  it("keeps the other choices out of it: the page needs only the buildings", () => {
    expect(chosenRsns(JSON.stringify({ v: 1, lang: "ur", groups: ["seniors"], floors: ["x"], buildings: ["4154146"] }))).toEqual(["4154146"]);
  });
});

describe("ChosenContacts on the server", () => {
  it("draws nothing before the phone has been read, so the server never shows a building that is not the resident's", () => {
    const html = renderToStaticMarkup(
      <ChosenContacts
        title="Your building"
        noneChosen="Choose"
        chooseLabel="Choose your building"
        chooseHref="/en/choices/place"
        noContact="none"
        call="Call"
        callIsEnglish={false}
        buildings={[{ rsn: "4154146", address: "4 Milepost Pl", role: "Superintendent", phone: "(416) 555-0123", tel: "tel:+14165550123", provided: "p", callAria: "a" }]}
      />,
    );

    expect(html).toBe("");
  });
});
