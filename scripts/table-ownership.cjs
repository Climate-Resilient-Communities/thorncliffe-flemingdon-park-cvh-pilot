const fs = require("node:fs");
const path = require("node:path");
const { parseModuleGraph } = require("./module-graph.cjs");

const SPINE = path.join(__dirname, "..", "docs", "architecture", "ARCHITECTURE-SPINE.md");
const HEADER = /^\|\s*Module\s*\|\s*Owns\s*\|\s*$/;
const SEPARATOR = /^\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*$/;
const ROW = /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/;
const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * Parses the table ownership table ("| Module | Owns |") of the architecture
 * spine's Structural Seed (AD-2). Table names are the backticked names in the
 * Owns column; anything else there (such as "(pause)") is commentary.
 * Throws rather than return a partial map.
 *
 * @param {string} markdown
 * @returns {Record<string, string>} table name -> owning module
 */
function parseTableOwnership(markdown) {
  const lines = markdown.split(/\r?\n/);
  const headers = lines.flatMap((line, index) => (HEADER.test(line.trim()) ? [index] : []));
  if (headers.length !== 1) {
    throw new Error(`Expected one "| Module | Owns |" table in the architecture spine, found ${headers.length}`);
  }
  const start = headers[0];
  if (!SEPARATOR.test((lines[start + 1] ?? "").trim())) {
    throw new Error('The "| Module | Owns |" table has no separator row');
  }

  const { modules } = parseModuleGraph(markdown);
  const owners = {};
  for (let i = start + 2; i < lines.length && lines[i].trim().startsWith("|"); i += 1) {
    const row = ROW.exec(lines[i].trim());
    if (!row) throw new Error(`Unrecognised row in the table ownership table: "${lines[i].trim()}"`);
    const [, module, owns] = row;
    if (!modules.includes(module)) {
      throw new Error(`The table ownership table names "${module}", which is not a module of the dependency diagram`);
    }
    const tables = [...owns.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const table of tables) {
      if (!TABLE_NAME.test(table)) {
        throw new Error(`"${table}" (owned by ${module}) is not a lower_snake_case table name`);
      }
      if (owners[table]) {
        throw new Error(`Table "${table}" is owned by both ${owners[table]} and ${module}`);
      }
      owners[table] = module;
    }
  }
  if (Object.keys(owners).length === 0) {
    throw new Error("The table ownership table lists no tables");
  }
  return owners;
}

function readTableOwnership(file = SPINE) {
  return parseTableOwnership(fs.readFileSync(file, "utf8"));
}

module.exports = { parseTableOwnership, readTableOwnership };
