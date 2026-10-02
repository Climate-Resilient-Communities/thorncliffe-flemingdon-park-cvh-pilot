import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.join(__dirname, "..", "..", "..");
const wiring = readFileSync(path.join(__dirname, "places.ts"), "utf8");

describe("the places composition root and the removal guard", () => {
  it("stops using NO_ASSIGNMENTS once a migration creates ambassador_assignment (S01.14 wired the real reader)", () => {
    const migrations = path.join(ROOT, "db", "migrations");
    const creating = readdirSync(migrations)
      .filter((file) => file.endsWith(".sql"))
      .filter((file) => /create\s+table\s+(if\s+not\s+exists\s+)?(public\.)?"?ambassador_assignment"?/i.test(readFileSync(path.join(migrations, file), "utf8")));
    const stillNobody = /NO_ASSIGNMENTS\b/.test(wiring.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));

    expect(creating.length, "a migration creates ambassador_assignment").toBeGreaterThan(0);
    expect(stillNobody, `${creating.join(", ")} creates ambassador_assignment, but src/app/staff/places.ts still wires NO_ASSIGNMENTS: a floor with Ambassadors assigned could be removed`).toBe(false);
  });

  it("asks identity's reader of the assignments (the Ambassadors whose assignment lists the floor)", () => {
    expect(wiring).toMatch(/import \{ assignments \} from "\.\/assignments"/);
    expect(wiring).toMatch(/onFloor:\s*\(executor, floor\)\s*=>\s*assignments\(\)\.onFloor\(executor, floor\)/);
    expect(wiring).toMatch(/createBuildingService\(\{[^}]*assignments: assignedToFloors/);
  });
});
