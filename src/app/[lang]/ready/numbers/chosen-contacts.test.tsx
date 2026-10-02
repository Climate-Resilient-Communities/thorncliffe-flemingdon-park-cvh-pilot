import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChosenContacts } from "./chosen-contacts";

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
