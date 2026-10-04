import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cruise, type ICruiseResult } from "dependency-cruiser";
import extractDepcruiseOptions from "dependency-cruiser/config-utl/extract-depcruise-options";
import extractTSConfig from "dependency-cruiser/config-utl/extract-ts-config";
import { describe, expect, it } from "vitest";
import { APP_NODE, parseModuleGraph, readModuleGraph } from "../scripts/module-graph.cjs";

const options = await extractDepcruiseOptions("./.dependency-cruiser.cjs");
const tsConfig = extractTSConfig("tsconfig.json");

async function check(fixture: string) {
  const { output } = await cruise([`test/fixtures/${fixture}/src`], options, {}, { tsConfig });
  const { summary } = output as ICruiseResult;
  return {
    cruised: summary.totalCruised,
    violations: summary.violations.map(({ rule, from, to }) => ({ rule: rule.name, from, to })),
  };
}

const at = (fixture: string, file: string) => `test/fixtures/${fixture}/src/${file}`;

describe("dependency rules", () => {
  it("accept imports that follow the diagram", async () => {
    const { cruised, violations } = await check("deps-valid");

    expect(cruised).toBe(8);
    expect(violations).toEqual([]);
  });

  it("reject a cycle", async () => {
    const { violations } = await check("deps-cycle");

    expect(violations.map((v) => v.rule)).toEqual(["no-circular"]);
  });

  it("reject a module-to-module edge missing from the diagram", async () => {
    const { violations } = await check("deps-undeclared-edge");

    expect(violations).toEqual([
      {
        rule: "undeclared-module-edge",
        from: at("deps-undeclared-edge", "modules/audit/application/recordEvent.ts"),
        to: at("deps-undeclared-edge", "modules/spend/index.ts"),
      },
    ]);
  });

  it("reject imports of another module's files other than index.ts", async () => {
    const { violations } = await check("deps-deep-import");

    expect(violations).toEqual(
      expect.arrayContaining([
        {
          rule: "deep-module-import",
          from: at("deps-deep-import", "modules/alerting/application/notify.ts"),
          to: at("deps-deep-import", "modules/messaging/domain/smsBody.ts"),
        },
        {
          rule: "deep-module-import",
          from: at("deps-deep-import", "app/page.ts"),
          to: at("deps-deep-import", "modules/alerting/domain/lifecycle.ts"),
        },
      ]),
    );
    expect(violations).toHaveLength(2);
  });

  it("reject platform, contracts and i18n code importing a module", async () => {
    const { violations } = await check("deps-layer-imports-module");

    expect(violations.map((v) => v.from).sort()).toEqual([
      at("deps-layer-imports-module", "contracts/alertWire.ts"),
      at("deps-layer-imports-module", "i18n/catalog.ts"),
      at("deps-layer-imports-module", "platform/logger.ts"),
    ]);
    expect(new Set(violations.map((v) => v.rule))).toEqual(new Set(["layer-imports-module"]));
  });

  it("reject a module importing src/app or src/ui", async () => {
    const { violations } = await check("deps-module-imports-outside-layers");

    expect(violations).toEqual(
      expect.arrayContaining([
        {
          rule: "module-imports-outside-layers",
          from: at("deps-module-imports-outside-layers", "modules/messaging/application/send.ts"),
          to: at("deps-module-imports-outside-layers", "app/wiring.ts"),
        },
        {
          rule: "module-imports-outside-layers",
          from: at("deps-module-imports-outside-layers", "modules/identity/application/signInButton.ts"),
          to: at("deps-module-imports-outside-layers", "ui/button.ts"),
        },
      ]),
    );
    expect(violations).toHaveLength(2);
  });

  it("reject domain code importing another module or platform", async () => {
    const { violations } = await check("deps-domain-imports");

    expect(violations).toEqual(
      expect.arrayContaining([
        {
          rule: "domain-imports-outside-domain",
          from: at("deps-domain-imports", "modules/alerting/domain/notifyRule.ts"),
          to: at("deps-domain-imports", "modules/messaging/index.ts"),
        },
        {
          rule: "domain-imports-outside-domain",
          from: at("deps-domain-imports", "modules/alerting/domain/expiry.ts"),
          to: at("deps-domain-imports", "platform/clock.ts"),
        },
      ]),
    );
    expect(violations).toHaveLength(2);
  });

  it("reject importing an SMS adapter outside messaging, and allow messaging's own code to", async () => {
    const { cruised, violations } = await check("deps-sms-adapter");
    const smsAdapter = violations.filter((v) => v.rule === "sms-adapter-outside-messaging");

    expect(cruised).toBe(9);
    expect(smsAdapter).toHaveLength(3);
    expect(smsAdapter).toEqual(
      expect.arrayContaining([
        {
          rule: "sms-adapter-outside-messaging",
          from: at("deps-sms-adapter", "modules/alerting/application/notify.ts"),
          to: at("deps-sms-adapter", "modules/messaging/adapters/twilioSms.ts"),
        },
        {
          rule: "sms-adapter-outside-messaging",
          from: at("deps-sms-adapter", "app/page.ts"),
          to: at("deps-sms-adapter", "modules/messaging/adapters/fakeSms.ts"),
        },
        // An adapter that is not named like a sender is covered too: the rule is the folder, not a file name.
        {
          rule: "sms-adapter-outside-messaging",
          from: at("deps-sms-adapter", "modules/alerting/application/checkSettings.ts"),
          to: at("deps-sms-adapter", "modules/messaging/adapters/serviceSettings.ts"),
        },
      ]),
    );
    // messaging's application code imports adapters (not Twilio's, which have their own rule below) and breaks no rule.
    expect(violations.filter((v) => v.from.includes("modules/messaging/"))).toEqual([]);
  });

  it("reject any import of a Twilio adapter other than messaging's own index.ts re-exporting it (S06.09)", async () => {
    const { cruised, violations } = await check("deps-twilio-adapter");
    const twilio = violations.filter((v) => v.rule === "twilio-adapter-only-for-the-sender");

    expect(cruised).toBe(9);
    expect(twilio).toHaveLength(2);
    expect(twilio).toEqual(
      expect.arrayContaining([
        // messaging's own application code may not take it by file: only the index re-exports it
        {
          rule: "twilio-adapter-only-for-the-sender",
          from: at("deps-twilio-adapter", "modules/messaging/application/rogue.ts"),
          to: at("deps-twilio-adapter", "modules/messaging/adapters/twilioMessagingService.ts"),
        },
        // and no other module may
        {
          rule: "twilio-adapter-only-for-the-sender",
          from: at("deps-twilio-adapter", "modules/alerting/application/notify.ts"),
          to: at("deps-twilio-adapter", "modules/messaging/adapters/twilioMessageList.ts"),
        },
      ]),
    );
    // The index re-exporting them, an adapter using the other one and a non-Twilio adapter used by application code break nothing.
    expect(twilio.filter((v) => v.from.endsWith("messaging/index.ts") || v.from.includes("/adapters/") || v.from.endsWith("dispatcher.ts"))).toEqual([]);
  });

  it("covers every Twilio adapter file of messaging, whatever else is named after it, and no file that is not one", () => {
    const rule = options.ruleSet?.forbidden?.find((candidate) => candidate.name === "twilio-adapter-only-for-the-sender") as { to: { path: string } } | undefined;
    expect(rule).toBeDefined();
    const covers = (file: string) => new RegExp(rule?.to.path ?? "$^").test(file);
    const twilioFiles = readdirSync("src/modules/messaging/adapters").filter((name) => /^twilio.*\.ts$/.test(name) && !name.endsWith(".test.ts"));
    expect(twilioFiles.length).toBeGreaterThan(0);
    for (const name of twilioFiles) expect(covers(`src/modules/messaging/adapters/${name}`), name).toBe(true);
    for (const file of ["src/modules/messaging/adapters/dispatchStore.ts", "src/modules/messaging/adapters/schema.ts", "src/modules/messaging/application/dispatcher.ts", "src/modules/messaging/index.ts"]) {
      expect(covers(file), file).toBe(false);
    }
  });

  it("covers every file in messaging/adapters, whatever it is named, and nothing outside that folder", () => {
    // The rule's own `to.path`, read from the config the checks run with (a forbidden rule may also be of the
    // "dependents" kind, which has no `to`, so the type is narrowed here).
    const rule = options.ruleSet?.forbidden?.find((candidate) => candidate.name === "sms-adapter-outside-messaging") as { to: { path: string } } | undefined;
    const covers = (file: string) => new RegExp(rule?.to.path ?? "$^").test(file);

    expect(rule).toBeDefined();
    const adapters = readdirSync("src/modules/messaging/adapters");
    expect(adapters.length).toBeGreaterThan(0);
    for (const name of adapters) expect(covers(`src/modules/messaging/adapters/${name}`), name).toBe(true);
    expect(covers("src/modules/messaging/adapters/anything/deeper/file.ts")).toBe(true);
    for (const file of ["src/modules/messaging/domain/smsBody.ts", "src/modules/messaging/index.ts", "src/modules/alerting/adapters/schema.ts", "src/platform/db/index.ts"]) {
      expect(covers(file), file).toBe(false);
    }
  });

  it("reject reading a text message's words outside the renderer, and allow the renderer to", async () => {
    const { cruised, violations } = await check("deps-sms-strings");
    const strings = violations.filter((v) => v.rule === "sms-strings-only-from-the-renderer");

    expect(cruised).toBe(5);
    expect(strings).toHaveLength(2);
    expect(strings).toEqual(
      expect.arrayContaining([
        {
          rule: "sms-strings-only-from-the-renderer",
          from: at("deps-sms-strings", "modules/alerting/application/notify.ts"),
          to: at("deps-sms-strings", "i18n/smsStrings.ts"),
        },
        {
          rule: "sms-strings-only-from-the-renderer",
          from: at("deps-sms-strings", "app/page.ts"),
          to: at("deps-sms-strings", "i18n/smsStrings.ts"),
        },
      ]),
    );
    // The renderer (messaging/domain/smsBody.ts) imports them and breaks no rule.
    expect(violations.filter((v) => v.from.includes("modules/messaging/"))).toEqual([]);
  });

  it("reject a resident query importing the alert tables, and allow it the nondrill views, its tests and the lifecycle's own code the tables (AD-6)", async () => {
    const { cruised, violations } = await check("deps-resident-queries");

    expect(cruised).toBe(7);
    expect(violations).toEqual([
      {
        rule: "resident-queries-read-nondrill-only",
        from: at("deps-resident-queries", "modules/alerting/adapters/resident/readEverything.ts"),
        to: at("deps-resident-queries", "modules/alerting/adapters/schema.ts"),
      },
    ]);
  });

  it("covers every file of resident/ whatever it is named, and nothing outside that folder", () => {
    const rule = options.ruleSet?.forbidden?.find((candidate) => candidate.name === "resident-queries-read-nondrill-only") as { from: { path: string; pathNot: string }; to: { path: string } } | undefined;
    const from = (file: string) => new RegExp(rule?.from.path ?? "$^").test(file) && !new RegExp(rule?.from.pathNot ?? "$^").test(file);

    expect(rule).toBeDefined();
    const files = readdirSync("src/modules/alerting/adapters/resident");
    expect(files.length).toBeGreaterThan(0);
    for (const name of files.filter((file) => !/\.test\.tsx?$/.test(file))) expect(from(`src/modules/alerting/adapters/resident/${name}`), name).toBe(true);
    expect(from("src/modules/alerting/adapters/resident/deeper/query.ts")).toBe(true);
    for (const file of ["src/modules/alerting/adapters/schema.ts", "src/modules/alerting/application/lifecycle.ts", "src/modules/alerting/adapters/resident/readThreads.test.ts"]) {
      expect(from(file), file).toBe(false);
    }
    expect(new RegExp(rule?.to.path ?? "$^").test("src/modules/alerting/adapters/schema.ts")).toBe(true);
    expect(new RegExp(rule?.to.path ?? "$^").test("src/modules/alerting/adapters/resident/views.ts")).toBe(false);
  });

  it("reject the audience matcher importing anything but zod and the contract files beside it", async () => {
    const { violations } = await check("deps-matcher-contract");

    expect(violations).toEqual([
      {
        rule: "matcher-contract-is-pure",
        from: at("deps-matcher-contract", "contracts/audience.ts"),
        to: at("deps-matcher-contract", "platform/clock.ts"),
      },
    ]);
  });

  it("allow exactly the module edges in the diagram", async () => {
    const { modules, dependencies } = readModuleGraph();
    const pairs = [APP_NODE, ...modules].flatMap((from) =>
      modules.filter((to) => to !== from).map((to) => ({ from, to })),
    );
    const importer = ({ from, to }: { from: string; to: string }) =>
      from === APP_NODE ? `src/app/${to}.ts` : `src/modules/${from}/application/${to}.ts`;

    // One file per ordered pair, each importing the target module's index.ts.
    const dir = mkdtempSync(join(tmpdir(), "deps-all-pairs-"));
    const write = (file: string, text: string) => {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    };
    for (const name of modules) write(`src/modules/${name}/index.ts`, "export {};\n");
    for (const pair of pairs) {
      write(importer(pair), `import "${pair.from === APP_NODE ? "../modules" : "../.."}/${pair.to}";\n`);
    }

    try {
      const { output } = await cruise(["src"], { ...options, baseDir: dir }, {}, {});
      const rejected = new Set((output as ICruiseResult).summary.violations.map((v) => v.from));
      const allowed = pairs.filter((pair) => !rejected.has(importer(pair)));
      const declared = Object.entries(dependencies).flatMap(([from, targets]) =>
        targets.map((to) => `${from} --> ${to}`),
      );

      expect(allowed.map(({ from, to }) => `${from} --> ${to}`).sort()).toEqual(declared.sort());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("module dependency diagram", () => {
  it("names exactly the module folders under src/modules", () => {
    const folders = readdirSync("src/modules", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(folders).toHaveLength(11);
    expect(folders).toEqual(readModuleGraph().modules);
  });

  it("gives every module domain, application, adapters and an index.ts", () => {
    for (const name of readModuleGraph().modules) {
      expect(readdirSync(`src/modules/${name}`)).toEqual(
        expect.arrayContaining(["adapters", "application", "domain", "index.ts"]),
      );
    }
  });

  it("fails loudly when the diagram is missing or empty", () => {
    expect(() => parseModuleGraph("# Spine\n")).toThrow(/flowchart TD/);
    expect(() => parseModuleGraph("```mermaid\nflowchart TD\n```\n")).toThrow(/no edges/);
    expect(() => parseModuleGraph("```mermaid\nflowchart TD\n  a --- b\n```\n")).toThrow(
      /Unrecognised line/,
    );
  });
});
