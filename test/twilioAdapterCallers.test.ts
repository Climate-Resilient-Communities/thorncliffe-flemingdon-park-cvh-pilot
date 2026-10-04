// S06.09 (AR-12): the Twilio adapters are called only by the dispatcher and the reconciliation job. dependency-cruiser enforces that no file
// imports an adapter's file except messaging's index.ts (rule twilio-adapter-only-for-the-sender); the index is how the two composition roots reach
// them, and the graph cannot see which names a file takes from it. This test reads the sources: any file of src that names one of the Twilio
// adapters' exports is listed here, and a new caller (a route, a Hub page, a module) fails it until the story that adds it changes this list.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const ADAPTERS = join(ROOT, "src/modules/messaging/adapters");

const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourcesUnder(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

const twilioAdapterFiles = readdirSync(ADAPTERS).filter((name) => /^twilio.*\.ts$/.test(name) && !name.endsWith(".test.ts"));

/** Every function, class and constant the Twilio adapter files export: the names a caller would take. */
const FUNCTIONS = twilioAdapterFiles.flatMap((name) =>
  [...readFileSync(join(ADAPTERS, name), "utf8").matchAll(/^export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_]+)/gm)].map((match) => match[1]),
);

const callersOf = (names: readonly string[]): string[] => {
  const pattern = new RegExp(`\\b(?:${names.join("|")})\\b`);
  return sourcesUnder(join(ROOT, "src"))
    .filter((file) => !file.startsWith(ADAPTERS) && pattern.test(readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")))
    .map((file) => relative(ROOT, file))
    .sort();
};

describe("who calls the Twilio adapters (S06.09)", () => {
  it("has Twilio adapters to guard, with names to look for", () => {
    expect(twilioAdapterFiles.sort()).toEqual(["twilioMessageList.ts", "twilioMessagingService.ts"]);
    expect(FUNCTIONS).toEqual(expect.arrayContaining(["twilioMessageSubmitter", "twilioMessagingServiceReader", "twilioMessageLister"]));
  });

  it("is called by the dispatcher's composition root and the reconciliation job's, re-exported by messaging's index, and by nothing else in src", () => {
    expect(callersOf(FUNCTIONS)).toEqual(["src/app/dispatch.ts", "src/app/reconcile.ts", "src/modules/messaging/index.ts"]);
  });

  it("takes the sender's client only in the dispatcher and the Messages listing only in the reconciliation", () => {
    expect(callersOf(["twilioMessageSubmitter", "twilioMessagingServiceReader"])).toEqual(["src/app/dispatch.ts", "src/modules/messaging/index.ts"]);
    expect(callersOf(["twilioMessageLister"])).toEqual(["src/app/reconcile.ts", "src/modules/messaging/index.ts"]);
  });

  it("has no route, Hub page or action that sends a text of its own: nothing in src outside messaging names the adapters' file paths", () => {
    const direct = sourcesUnder(join(ROOT, "src"))
      .filter((file) => !file.startsWith(join(ROOT, "src/modules/messaging")))
      .filter((file) => /adapters\/twilio/.test(readFileSync(file, "utf8")))
      .map((file) => relative(ROOT, file));
    expect(direct).toEqual([]);
  });
});
