import { describe, expect, it } from "vitest";
import { readModuleGraph } from "../scripts/module-graph.cjs";
import { parseTableOwnership, readTableOwnership } from "../scripts/table-ownership.cjs";

const GRAPH = "```mermaid\nflowchart TD\n  app --> audit\n  app --> ops\n```\n";
const table = (rows: string) => `${GRAPH}\n| Module | Owns |\n| --- | --- |\n${rows}\n\nAfter the table.\n`;

describe("table ownership table (AD-2)", () => {
  it("reads the spine's table, one owner per table", () => {
    const owners = readTableOwnership();

    expect(owners.audit_event).toBe("audit");
    expect(owners.messaging_control).toBe("messaging");
    expect(owners.oncall_roster).toBe("ops");
    expect(new Set(Object.values(owners))).toEqual(new Set(readModuleGraph().modules));
  });

  it("keeps only backticked names from the Owns column", () => {
    expect(parseTableOwnership(table("| audit | `audit_event` (append-only), `audit_note` |\n| ops | `ops_event` |"))).toEqual({
      audit_event: "audit",
      audit_note: "audit",
      ops_event: "ops",
    });
  });

  it("refuses a table owned twice, an unknown module or a missing table", () => {
    expect(() => parseTableOwnership(table("| audit | `x` |\n| ops | `x` |"))).toThrow(/owned by both audit and ops/);
    expect(() => parseTableOwnership(table("| billing | `invoice` |"))).toThrow(/"billing", which is not a module/);
    expect(() => parseTableOwnership(table("| audit | `Audit Event` |"))).toThrow(/not a lower_snake_case table name/);
    expect(() => parseTableOwnership(GRAPH)).toThrow(/found 0/);
    expect(() => parseTableOwnership(table("| audit | none |"))).toThrow(/lists no tables/);
  });
});
