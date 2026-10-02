const fs = require("node:fs");
const path = require("node:path");

const SPINE = path.join(__dirname, "..", "docs", "architecture", "ARCHITECTURE-SPINE.md");
const APP_NODE = "app";
const EDGE = /^(\w+)(?:\[[^\]]*\])?\s*-->\s*(\w+)(?:\[[^\]]*\])?$/;

/**
 * Parses the module dependency diagram: the one mermaid "flowchart TD" block
 * in the architecture spine. Throws rather than return a partial graph.
 *
 * @param {string} markdown
 * @returns {{ modules: string[], dependencies: Record<string, string[]> }}
 *   `modules` excludes the `app` node; `dependencies` maps every node,
 *   `app` included, to the nodes it may import.
 */
function parseModuleGraph(markdown) {
  const blocks = [...markdown.matchAll(/^```mermaid\r?\nflowchart TD[ \t]*\r?\n([\s\S]*?)^```/gm)];
  if (blocks.length !== 1) {
    throw new Error(
      `Expected one mermaid "flowchart TD" block in the architecture spine, found ${blocks.length}`,
    );
  }

  const dependencies = new Map();
  const node = (name) => {
    if (!dependencies.has(name)) dependencies.set(name, new Set());
    return dependencies.get(name);
  };

  for (const line of blocks[0][1].split(/\r?\n/)) {
    const text = line.trim();
    if (text === "" || text.startsWith("%%")) continue;
    const edge = EDGE.exec(text);
    if (!edge) {
      throw new Error(`Unrecognised line in the module dependency diagram: "${text}"`);
    }
    node(edge[2]);
    node(edge[1]).add(edge[2]);
  }

  if (dependencies.size === 0) {
    throw new Error("The module dependency diagram has no edges");
  }
  if (!dependencies.has(APP_NODE)) {
    throw new Error(`The module dependency diagram has no "${APP_NODE}" node`);
  }

  return {
    modules: [...dependencies.keys()].filter((name) => name !== APP_NODE).sort(),
    dependencies: Object.fromEntries(
      [...dependencies].map(([name, targets]) => [name, [...targets].sort()]),
    ),
  };
}

function readModuleGraph(file = SPINE) {
  return parseModuleGraph(fs.readFileSync(file, "utf8"));
}

module.exports = { APP_NODE, parseModuleGraph, readModuleGraph };
