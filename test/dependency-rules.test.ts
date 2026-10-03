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

    expect(cruised).toBe(7);
    expect(smsAdapter).toHaveLength(2);
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
      ]),
    );
    // messaging's application code imports both adapters and breaks no rule.
    expect(violations.filter((v) => v.from.includes("modules/messaging/"))).toEqual([]);
  });

  it("covers every SMS adapter the module has: each file named *Sms.ts in messaging/adapters is under the rule", () => {
    const sending = readdirSync("src/modules/messaging/adapters").filter((name) => /Sms\.ts$/.test(name));

    // The adapters that exist today; a new sender joins the rule by being named the same way.
    expect(sending.sort()).toEqual(["fakeSms.ts", "twilioSms.ts"]);
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
