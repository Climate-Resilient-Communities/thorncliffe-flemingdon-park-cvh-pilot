import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GROUPS, GroupSchema } from "./groups";

const MESSAGES = path.join(__dirname, "..", "i18n", "messages");
type Catalog = { groups?: Record<string, { label?: unknown; line?: unknown }>; staff?: { audience?: { groupNames?: Record<string, unknown>; groupLines?: Record<string, unknown> } } };
const catalog = (file: string): Catalog => JSON.parse(readFileSync(path.join(MESSAGES, file), "utf8"));
const files = readdirSync(MESSAGES).filter((name) => name.endsWith(".json"));

describe("the groups: one list, named wherever it is shown", () => {
  it("is the list R-26 and the audience picker (O-04) offer, and the schema accepts exactly those", () => {
    expect([...GROUPS]).toEqual(["seniors", "newcomers", "families", "checkin"]);
    for (const group of GROUPS) expect(GroupSchema.safeParse(group).success).toBe(true);
    expect(GroupSchema.safeParse("pensioners").success).toBe(false);
  });

  it("every group id has a resident string (`groups.<id>`) in every language, and a staff label in English", () => {
    expect(files.length).toBeGreaterThan(1);
    for (const file of files) {
      const { groups } = catalog(file);
      for (const id of GROUPS) {
        expect(typeof groups?.[id]?.label, `${file}: groups.${id}.label`).toBe("string");
        expect((groups?.[id]?.label as string).trim(), `${file}: groups.${id}.label is empty`).not.toBe("");
        expect(typeof groups?.[id]?.line, `${file}: groups.${id}.line`).toBe("string");
      }
    }
    const names = catalog("en.json").staff?.audience?.groupNames;
    const lines = catalog("en.json").staff?.audience?.groupLines;
    for (const id of GROUPS) {
      expect(typeof names?.[id], `staff.audience.groupNames.${id}`).toBe("string");
      expect(typeof lines?.[id], `staff.audience.groupLines.${id}`).toBe("string");
    }
  });

  it("the catalogs name no group the list does not have", () => {
    const en = catalog("en.json");
    expect(Object.keys(en.groups ?? {}).sort()).toEqual([...GROUPS].sort());
    expect(Object.keys(en.staff?.audience?.groupNames ?? {}).sort()).toEqual([...GROUPS].sort());
  });
});
