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
      name: "sms-adapter-outside-messaging",
      comment:
        "Every file in src/modules/messaging/adapters (the Twilio adapter, the fake, and whatever E06 adds: a Messaging Service settings check, a webhook client) is imported only inside src/modules/messaging: every outbound text is built by messaging's one renderer and handed to the provider by messaging's own code, so no other module or route can build or send a body of its own (AD-21, S04.06). The rule covers the folder, not a file name, so a new adapter is under it without anyone remembering a naming convention",
      severity: "error",
      from: { pathNot: `${MODULES}messaging/` },
      to: { path: `${MODULES}messaging/adapters/` },
    },
    {
      name: "sms-strings-only-from-the-renderer",
      comment:
        "The words of a text message (src/i18n/smsStrings.ts) are read by messaging's one renderer (messaging/domain/smsBody.ts) and by tests, and by nothing else, however the import is spelled (relative or the @/ alias): no other code can put a text message's lines together (AD-21, S04.06)",
      severity: "error",
      from: { pathNot: [`${MODULES}messaging/domain/smsBody\\.ts$`, "\\.test\\.tsx?$"] },
      to: { path: `${SRC}i18n/smsStrings\\.ts$` },
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
      name: "matcher-contract-is-pure",
      comment:
        "src/contracts/audience.ts is the one audience matcher (AD-7): the server, the phone and SMS selection import it, so at run time it imports only zod and the contract files beside it (groups, places) and stays loadable unchanged in the browser. Type-only imports (profileFromDevice is typed with S02.03's DeviceChoices and BuildingList) are erased and allowed. Nothing here can stop another file defining a second matcher; the no-other-matcher test in src/contracts/audience.test.ts does that, and this rule keeps the one definition importable by everyone",
      severity: "error",
      from: { path: `${SRC}contracts/audience\\.ts$` },
      to: { pathNot: [`${SRC}contracts/(?:groups|places)\\.ts$`, "node_modules/zod/"], dependencyTypesNot: ["type-only"] },
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
