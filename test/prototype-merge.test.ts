import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

// Each strings.*.screens.js file (and each prototype page at the repo root that inlines
// them) merges its screen strings into the language table with a small `m(t, s)` helper.
// The helper must not let a "__proto__", "constructor" or "prototype" key reach
// Object.prototype (CodeQL js/prototype-pollution-utility).

const ROOT = path.join(__dirname, "..");
const PROTOTYPE = path.join(ROOT, "design", "prototype", "cvh");
const HELPER = /^\s*function m\(t, s\) \{.*\}\s*$/gm;

const screenFiles = readdirSync(PROTOTYPE)
  .filter((file) => /^strings\..+\.screens\.js$/.test(file))
  .map((file) => path.join(PROTOTYPE, file));
const pages = readdirSync(ROOT)
  .filter((file) => /^CVH-(Resident-app|Hub-and-partner-space|Walkthrough-Scenario-).*\.html$/.test(file))
  .map((file) => path.join(ROOT, file));

// Every distinct copy of the helper, with the files it appears in.
function helpers(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of [...screenFiles, ...pages]) {
    for (const match of readFileSync(file, "utf8").match(HELPER) ?? []) {
      const source = match.trim();
      found.set(source, [...(found.get(source) ?? []), path.relative(ROOT, file)]);
    }
  }
  return found;
}

// Loads one copy of the helper into a fresh context so a polluted Object.prototype stays there.
function load(source: string) {
  const context = vm.createContext({});
  vm.runInContext(source, context);
  const merge = (target: string, input: string) =>
    vm.runInContext(`(function () { var t = ${target}; m(t, JSON.parse(${JSON.stringify(input)})); return JSON.stringify(t); })()`, context) as string;
  const polluted = () => vm.runInContext("({}).polluted", context) as unknown;
  return { merge, polluted };
}

describe("the prototype's string merge helper", () => {
  const copies = helpers();

  it("is found in every screens file and prototype page", () => {
    expect(screenFiles).toHaveLength(15);
    expect(pages.length).toBeGreaterThan(0);
    const files = new Set([...copies.values()].flat());
    for (const file of [...screenFiles, ...pages]) expect(files).toContain(path.relative(ROOT, file));
  });

  for (const [source, files] of copies) {
    describe(`as written in ${files[0]} and ${files.length - 1} other place(s)`, () => {
      it("ignores a __proto__ key", () => {
        const { merge, polluted } = load(source);
        expect(merge("{}", '{"__proto__": {"polluted": true}, "a": 1}')).toBe('{"a":1}');
        expect(polluted()).toBeUndefined();
      });

      it("ignores constructor and prototype keys", () => {
        const { merge, polluted } = load(source);
        expect(merge("{}", '{"constructor": {"prototype": {"polluted": true}}, "prototype": {"polluted": true}}')).toBe("{}");
        expect(polluted()).toBeUndefined();
      });

      it("still merges nested strings and replaces the rest", () => {
        const { merge } = load(source);
        const target = "{ A01: { role: 'old', keep: 'k' }, list: ['x'] }";
        expect(merge(target, '{"A01": {"role": "new", "add": "a"}, "list": ["y", "z"]}')).toBe(
          '{"A01":{"role":"new","keep":"k","add":"a"},"list":["y","z"]}',
        );
      });
    });
  }
});
