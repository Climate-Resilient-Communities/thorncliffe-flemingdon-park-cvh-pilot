import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_DIR = path.join(ROOT, "db", "migrations");

/** Supabase CLI naming (`supabase migration new <name>`): a 14-digit UTC timestamp, then a name. */
export const MIGRATION_FILE = /^(\d{14})_([a-z0-9_]+)\.sql$/;

/**
 * @typedef {{ version: string, name: string, file: string, path: string, sql: string, checksum: string }} Migration
 */

/** SHA-256 of the file with line endings normalised, so a checkout's line endings never count as an edit. */
export function checksum(sql) {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/**
 * Reads the migration files of a directory in version order.
 * Throws on a file that does not follow the naming rule or a repeated version.
 *
 * @param {string} [dir]
 * @returns {Migration[]}
 */
export function readMigrations(dir = MIGRATIONS_DIR) {
  const problems = [];
  const migrations = [];
  const seen = new Map();
  for (const file of readdirSync(dir).sort()) {
    if (file === ".gitkeep") continue;
    const match = MIGRATION_FILE.exec(file);
    if (!match) {
      problems.push(`${file}: migration files are named <14-digit UTC timestamp>_<lower_snake_name>.sql`);
      continue;
    }
    const [, version, name] = match;
    if (seen.has(version)) {
      problems.push(`${file}: version ${version} is also used by ${seen.get(version)}`);
      continue;
    }
    seen.set(version, file);
    const filePath = path.join(dir, file);
    const sql = readFileSync(filePath, "utf8");
    migrations.push({ version, name, file, path: filePath, sql, checksum: checksum(sql) });
  }
  if (problems.length > 0) {
    throw new Error(`Invalid migration files in ${dir}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
  return migrations;
}
