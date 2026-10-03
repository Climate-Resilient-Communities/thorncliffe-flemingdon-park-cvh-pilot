import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import { PLANS, floorId } from "../../../../../test/helpers/approvalReview";
import { changeView } from "./change";

const buildings = (list: { rsn: string; floors: string[] | null }[]): Audience => ({ scope: "buildings", buildings: list, groups: [], types: ["elevator"] }) as unknown as Audience;

describe("the words of an audience change", () => {
  it("names a place of the plans by its address", () => {
    const view = changeView(
      buildings([{ rsn: "4154146", floors: [floorId("4154146", 2)] }]),
      buildings([{ rsn: "4154146", floors: [floorId("4154146", 2)] }, { rsn: "4154159", floors: null }]),
      PLANS,
    );
    expect(view.alsoFor).toContain(PLANS[1].address);
    expect(view.noLongerFor).toBeNull();
  });

  it("never shows the number of a building that is not in the plans: it says a building is not in the list", () => {
    const view = changeView(buildings([{ rsn: "7777777", floors: null }, { rsn: "4154146", floors: null }]), buildings([{ rsn: "4154146", floors: null }]), PLANS);
    expect(view.noLongerFor).not.toContain("7777777");
    expect(view.noLongerFor).toMatch(/not in the list/);
    const floors = changeView(buildings([{ rsn: "7777777", floors: ["f1"] }]), buildings([{ rsn: "4154146", floors: null }]), PLANS);
    expect(floors.noLongerFor).not.toContain("7777777");
  });
});
