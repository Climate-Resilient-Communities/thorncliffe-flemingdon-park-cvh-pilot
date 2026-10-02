import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

const STRINGS_DIR = path.join(__dirname, "..", "..", "design", "prototype", "cvh");
const FILES: Record<string, string[]> = {
  en: ["strings.en.js", "strings.en.screens.js"],
};

/** Every string of a language in the prototype's string tables (design/prototype/cvh/strings.*.js). */
export function prototypeStrings(lang: string): string[] {
  const window: { CVH_STRINGS?: Record<string, unknown> } = {};
  const context = vm.createContext({ window });
  for (const file of FILES[lang] ?? [`strings.${lang}.js`]) {
    vm.runInContext(readFileSync(path.join(STRINGS_DIR, file), "utf8"), context);
  }
  const found: string[] = [];
  const walk = (node: unknown) => {
    if (typeof node === "string") found.push(node);
    else if (node && typeof node === "object") Object.values(node).forEach(walk);
  };
  walk(window.CVH_STRINGS?.[lang]);
  if (found.length === 0) throw new Error(`No prototype strings for "${lang}"`);
  return found;
}

/** The longest translated labels of a language: its longest strings and its longest single words. */
export function longestLabels(lang: string, count = 3) {
  const strings = prototypeStrings(lang);
  const byLength = (a: string, b: string) => b.length - a.length;
  return {
    sentences: [...strings].sort(byLength).slice(0, count),
    words: [...new Set(strings.flatMap((text) => text.split(/\s+/)))].sort(byLength).slice(0, count),
  };
}
