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

  it("has 103 rows and 43 pilot rows (32 in M4H and 11 in M3C), which are 42 buildings: the merge file folds one into another", () => {
    expect(features).toHaveLength(103);
    expect(plan.counts).toMatchObject({ features: 103, pilotRows: 43, outsidePilot: 60, merged: 1, pilotRowsByFsa: { M4H: 32, M3C: 11 } });
    expect(plan.buildings).toHaveLength(42);
    expect(plan.buildings.filter((b) => b.fsa === "M4H")).toHaveLength(31);
    expect(plan.buildings.filter((b) => b.fsa === "M3C")).toHaveLength(11);
    expect(plan.buildings.filter((b) => b.neighbourhoodId === "TP")).toHaveLength(31);
    expect(plan.buildings.filter((b) => b.neighbourhoodId === "FP")).toHaveLength(11);
    expect(new Set(plan.buildings.map((b) => b.rsn)).size).toBe(42);
  });

  it("is valid: no failing row, and the merge file maps the register's second 85-95 Thorncliffe Park Dr to the first", () => {
    expect(merges).toEqual({ entries: [{ line: 5, rsn: "4237447", primaryRsn: "4154159" }], failures: [] });
    expect(plan.failures).toEqual([]);
  });

  it("loads 85-95 Thorncliffe Park Dr once, as rsn 4154159, with no warning left (UAT F-5)", () => {
    expect(plan.buildings.filter((b) => b.address === "85-95 Thorncliffe Park Dr")).toEqual([expect.objectContaining({ rsn: "4154159", storeys: 43, mergedRsns: ["4237447"] })]);
    expect(plan.warnings).toEqual([]);
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

  it("leaves out the rows of other postal areas, the one with no postal code, and the one the merge file folds into another", () => {
    const rsns = new Set(plan.buildings.map((b) => b.rsn));
    for (const feature of features as { properties: { PCODE: string | null; RSN: number } }[]) {
      const inPilot = (feature.properties.PCODE === "M4H" || feature.properties.PCODE === "M3C") && feature.properties.RSN !== 4237447;
      expect(rsns.has(String(feature.properties.RSN)), `${feature.properties.PCODE} ${feature.properties.RSN}`).toBe(inPilot);
    }
  });

  it("reports the plan in words", () => {
    const lines = formatImportReport(plan);
    expect(lines[0]).toBe("Register: 103 rows; 43 in the pilot's postal areas (M4H 32, M3C 11); 60 elsewhere, not loaded.");
    expect(lines).toContain("Merge file: 1 registration folded into another building.");
    expect(lines).toContain("Would load: 42 buildings.");
  });
});

