// Drizzle drift test (S01.03): the hand-written Drizzle schema must describe
// exactly what the SQL migrations create. Module schemas live in
// src/modules/<module>/adapters/schema.ts (AD-2: only that module's tables).
import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { is } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findSchemaDrift } from "../../scripts/db/drift.mjs";
import { migrate } from "../../scripts/db/migrate.mjs";
import * as drifted from "../fixtures/db/drift/schema-drifted";
import * as matching from "../fixtures/db/drift/schema-matching";
import { FIXTURES, ROOT, connect, createFreshDatabase, serverUrl, type FreshDatabase } from "./helpers";

const require = createRequire(import.meta.url);
const { readTableOwnership } = require("../../scripts/table-ownership.cjs");

const MODULES = path.join(ROOT, "src", "modules");

async function loadModuleSchemas() {
  const imports: Record<string, unknown> = {};
  const tables: { module: string; table: string }[] = [];
  for (const owner of readdirSync(MODULES).sort()) {
    const file = path.join(MODULES, owner, "adapters", "schema.ts");
    if (!existsSync(file)) continue;
    const exported: Record<string, unknown> = await import(file);
    for (const [name, value] of Object.entries(exported)) {
      imports[`${owner}_${name}`] = value;
      if (is(value, PgTable)) tables.push({ module: owner, table: getTableConfig(value).name });
    }
  }
  return { imports, tables };
}

describe("Drizzle schema of the modules", () => {
  it("matches a freshly migrated database", async () => {
    const sql = connect(serverUrl());
    try {
      await migrate({ sql });
    } finally {
      await sql.end({ timeout: 5 });
    }
    const { imports } = await loadModuleSchemas();

    expect(await findSchemaDrift(serverUrl(), imports)).toEqual([]);
  });

  it("declares each table in the module that owns it (AD-2)", async () => {
    const owners: Record<string, string> = readTableOwnership();
    const { tables } = await loadModuleSchemas();

    for (const { module, table } of tables) {
      expect(owners[table], `${table} in src/modules/${module}/adapters/schema.ts`).toBe(module);
    }
  });
});

describe("drift detection (fixture)", () => {
  let db: FreshDatabase;

  beforeAll(async () => {
    db = await createFreshDatabase();
    await migrate({ sql: db.sql, dir: path.join(FIXTURES, "drift", "migrations") });
  });

  afterAll(async () => {
    await db.drop();
  });

  const withAuditEvent = (auditEvent: unknown) => ({ ...matching, auditEvent });

  it("finds no drift when the Drizzle schema matches the migrations", async () => {
    expect(await findSchemaDrift(db.url, matching)).toEqual([]);
  });

  it.each([
    ["a nullability difference", withAuditEvent(drifted.actionNullable), 'public.audit_event.action: notNull is true in the migrations but false in the Drizzle schema'],
    ["a column missing from the migrations", withAuditEvent(drifted.extraColumn), "public.audit_event.note is in the Drizzle schema but not in the migrations"],
    ["a type difference", withAuditEvent(drifted.wrongType), 'public.audit_event.occurred_at: type is "timestamp with time zone" in the migrations but "timestamp without time zone" in the Drizzle schema'],
    ["a missing index", withAuditEvent(drifted.missingIndex), "public.audit_event: index CREATE INDEX ON public.audit_event USING btree (occurred_at) is in the migrations but not in the Drizzle schema"],
    ["RLS not declared", withAuditEvent(drifted.rlsOff), "public.audit_event: row level security is enabled in the migrations but disabled in the Drizzle schema"],
    ["a different foreign key action", withAuditEvent(drifted.wrongForeignKey), "public.audit_event: constraint FOREIGN KEY (actor_id) REFERENCES staff_account(id) ON DELETE SET NULL is in the migrations but not in the Drizzle schema"],
    ["a different enum", { ...matching, auditOutcome: drifted.auditOutcomeExtraLabel }, 'enum public.audit_outcome is ["ok","refused"] in the migrations but ["ok","refused","error"] in the Drizzle schema'],
    ["a table the migrations never created", { ...matching, ghost: drifted.ghost }, "table public.ghost is in the Drizzle schema but not in the migrations"],
    ["a table missing from the Drizzle schema", { auditOutcome: matching.auditOutcome, staffAccount: matching.staffAccount }, "table public.audit_event is in the migrations but not in the Drizzle schema"],
  ])("detects %s", async (_, imports, difference) => {
    expect(await findSchemaDrift(db.url, imports)).toContain(difference);
  });
});
