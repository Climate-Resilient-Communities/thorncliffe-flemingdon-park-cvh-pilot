import { describe, expect, it } from "vitest";
import { PILOT_MACHINE_TRANSLATIONS_VAR, parsePilotMachineTranslations, pilotMachineTranslations } from "./pilotTranslations";

describe("CATALOGUE_PILOT_MACHINE_TRANSLATIONS (product owner's pilot decision, 2026-10-09)", () => {
  it("is on when unset or blank, and reads on and off in any case", () => {
    expect(pilotMachineTranslations({})).toBe(true);
    expect(pilotMachineTranslations({ [PILOT_MACHINE_TRANSLATIONS_VAR]: "  " })).toBe(true);
    expect(pilotMachineTranslations({ [PILOT_MACHINE_TRANSLATIONS_VAR]: "Off" })).toBe(false);
    expect(pilotMachineTranslations({ [PILOT_MACHINE_TRANSLATIONS_VAR]: "ON" })).toBe(true);
  });

  it("refuses anything else, naming the variable, so a typo never switches it", () => {
    expect(parsePilotMachineTranslations("false")).toEqual({ problem: "CATALOGUE_PILOT_MACHINE_TRANSLATIONS: must be `on` or `off`" });
    expect(() => pilotMachineTranslations({ [PILOT_MACHINE_TRANSLATIONS_VAR]: "0" })).toThrow(/must be `on` or `off`/);
  });
});
