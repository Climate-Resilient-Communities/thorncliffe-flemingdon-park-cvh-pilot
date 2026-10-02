// The City register as committed (data/seed/apartment_building_reg.geojson, S01.13): the plan the import
// makes of the real extract, read through the places module's public interface.
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatImportReport, planBuildingImport, readMergeFile, readRegisterFile } from "../src/modules/places";

const ROOT = path.join(__dirname, "..");

describe("the City register: the real extract", () => {
  const features = readRegisterFile(path.join(ROOT, "data", "seed", "apartment_building_reg.geojson"));
  const merges = readMergeFile(path.join(ROOT, "data", "seed", "building-merge.csv"));
  const plan = planBuildingImport(features, merges.entries);

  it("has 103 rows and exactly 43 pilot buildings: 32 in M4H and 11 in M3C", () => {
    expect(features).toHaveLength(103);
    expect(plan.counts).toMatchObject({ features: 103, pilotRows: 43, outsidePilot: 60, merged: 0, pilotRowsByFsa: { M4H: 32, M3C: 11 } });
    expect(plan.buildings).toHaveLength(43);
    expect(plan.buildings.filter((b) => b.fsa === "M4H")).toHaveLength(32);
    expect(plan.buildings.filter((b) => b.fsa === "M3C")).toHaveLength(11);
    expect(plan.buildings.filter((b) => b.neighbourhoodId === "TP")).toHaveLength(32);
    expect(plan.buildings.filter((b) => b.neighbourhoodId === "FP")).toHaveLength(11);
    expect(new Set(plan.buildings.map((b) => b.rsn)).size).toBe(43);
  });

  it("is valid: no failing row, and the merge file is empty", () => {
    expect(merges).toEqual({ entries: [], failures: [] });
    expect(plan.failures).toEqual([]);
  });

  it("warns once about 85-95 Thorncliffe Park Dr, registered twice, and keeps both", () => {
    const duplicates = plan.warnings.filter((w) => w.message.includes("share this address"));
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].address).toBe("85-95 Thorncliffe Park Dr");
    expect(duplicates[0].message).toContain("rsn 4154159, 4237447");
    expect(duplicates[0].message).toContain("data/seed/building-merge.csv");
    expect(plan.buildings.filter((b) => b.address === "85-95 Thorncliffe Park Dr").map((b) => b.rsn).sort()).toEqual(["4154159", "4237447"]);
    expect(plan.warnings).toHaveLength(1);
  });

  it("takes the address, coordinates and the six facts of a building from the register's fields", () => {
    expect(plan.buildings.find((b) => b.rsn === "4154146")).toEqual({
      rsn: "4154146",
      fsa: "M4H",
      neighbourhoodId: "TP",
      address: "4 Milepost Pl",
      latitude: 43.702327237,
      longitude: -79.348434827,
      storeys: 6,
      elevators: 2,
      emergencyPower: true,
      coolingRoom: true,
      airConditioning: "None",
      barrierFreeEntrance: true,
      mergedRsns: [],
    });
    expect(plan.buildings.find((b) => b.rsn === "4154144")?.airConditioning).toBe("Individual units");
  });

  it("leaves out the rows of other postal areas, and the one with no postal code", () => {
    const rsns = new Set(plan.buildings.map((b) => b.rsn));
    for (const feature of features as { properties: { PCODE: string | null; RSN: number } }[]) {
      const inPilot = feature.properties.PCODE === "M4H" || feature.properties.PCODE === "M3C";
      expect(rsns.has(String(feature.properties.RSN)), `${feature.properties.PCODE} ${feature.properties.RSN}`).toBe(inPilot);
    }
  });

  it("reports the plan in words", () => {
    const lines = formatImportReport(plan);
    expect(lines[0]).toBe("Register: 103 rows; 43 in the pilot's postal areas (M4H 32, M3C 11); 60 elsewhere, not loaded.");
    expect(lines).toContain("Would load: 43 buildings.");
  });
});

