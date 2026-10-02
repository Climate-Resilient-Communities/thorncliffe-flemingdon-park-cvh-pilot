// Rules are generated from the module dependency diagram in
// docs/architecture/ARCHITECTURE-SPINE.md (AD-2), so they cannot drift from it.
const { APP_NODE, readModuleGraph } = require("./scripts/module-graph.cjs");

const { dependencies } = readModuleGraph();

// test/fixtures/<case>/src mirrors src/ so the rule tests run against this exact config.
const SRC = "^(?:src|test/fixtures/[^/]+/src)/";
const MODULES = `${SRC}modules/`;
const MODULE_INDEX = `${MODULES}[^/]+/index\\.ts$`;

function declaredEdgesRule(node) {
  const allowed = dependencies[node];
  const reachable = node === APP_NODE ? allowed : [node, ...allowed];
  return {
    name: "undeclared-module-edge",
    comment: `${node} may import only: ${allowed.join(", ") || "no other module"} (spine dependency diagram)`,
    severity: "error",
    from: { path: node === APP_NODE ? `${SRC}app/` : `${MODULES}${node}/` },
    to: { path: MODULES, pathNot: `${MODULES}(?:${reachable.join("|")})/` },
  };
}

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      comment: "Dependencies point one way (AD-2)",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    ...Object.keys(dependencies).map(declaredEdgesRule),
    {
      name: "deep-module-import",
      comment: "Another module is imported only through its index.ts (AD-2)",
      severity: "error",
      from: { path: `${MODULES}([^/]+)/` },
      to: { path: MODULES, pathNot: [`${MODULES}$1/`, MODULE_INDEX] },
    },
    {
      name: "deep-module-import",
      comment: "Modules are imported only through their index.ts (AD-2)",
      severity: "error",
      from: { pathNot: MODULES },
      to: { path: MODULES, pathNot: MODULE_INDEX },
    },
    {
      name: "module-imports-outside-layers",
      comment: "Modules import only src/modules (per the diagram), src/platform, src/contracts and src/i18n (spine layer table)",
      severity: "error",
      from: { path: MODULES },
      to: { path: SRC, pathNot: `${SRC}(?:modules|platform|contracts|i18n)/` },
    },
    {
      name: "domain-imports-outside-domain",
      comment: "domain/ imports only its own domain/, src/contracts and src/i18n: no I/O, no clock (spine layer table)",
      severity: "error",
      from: { path: `${MODULES}([^/]+)/domain/` },
      to: { path: SRC, pathNot: [`${MODULES}$1/domain/`, `${SRC}(?:contracts|i18n)/`] },
    },
    {
      name: "layer-imports-module",
      comment: "src/platform, src/contracts and src/i18n import nothing in src/modules (spine layer table)",
      severity: "error",
      from: { path: `${SRC}(?:platform|contracts|i18n)/` },
      to: { path: MODULES },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      mainFields: ["module", "main", "types", "typings"],
    },
    skipAnalysisNotInRules: true,
  },
};
