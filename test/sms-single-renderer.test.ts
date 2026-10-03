import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SMS_STRING_KEYS } from "../src/i18n/smsStrings";

// AD-21: messaging's renderer is the only builder of a text message. The dependency rules
// `sms-adapter-outside-messaging` (the senders stay inside messaging) and `sms-strings-only-from-the-renderer` (only
// the renderer reads the words of a text message) are the guards; this keeps the words of a text message in one
// place a second way, by reading the source: no other code names the catalog keys a body is made of, or imports the
// file that holds them, so no other code can assemble one.

// A read of the words of a text message: a call to smsStrings(), or an import of i18n/smsStrings however the path is
// spelled (relative, or the "@/" alias), static or dynamic.
const reads = (text: string) =>
  /smsStrings\(/.test(text) || /from\s+["'`][^"'`]*i18n\/smsStrings["'`]/.test(text) || /import\(\s*["'`][^"'`]*i18n\/smsStrings["'`]\s*\)/.test(text);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "messages" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("one renderer for every text message (AD-21)", () => {
  it("is the only code that names the catalog keys that belong to text messages alone", () => {
    // Screens read x01.sms and x02.* for themselves (the resident pages show the same words), so only the keys that
    // exist for text messages are guarded: the exercise line, the stop line and the link line.
    const own = [SMS_STRING_KEYS.exercise, SMS_STRING_KEYS.stop, SMS_STRING_KEYS.link];
    const offenders = sourceFiles("src").flatMap((file) => {
      if (file === join("src", "i18n", "smsStrings.ts")) return [];
      const text = readFileSync(file, "utf8");
      return own.filter((key) => text.includes(`"${key}"`) || text.includes(`'${key}'`) || text.includes(`\`${key}\``)).map((key) => `${file}: ${key}`);
    });

    expect(own).toEqual(["x10.sms", "R04.stop", "R04.link"]);
    expect(offenders).toEqual([]);
  });

  it("builds no body outside the renderer: nothing but smsBody.ts, anywhere in src, reads the words of a text message", () => {
    // The dependency rule `sms-strings-only-from-the-renderer` is the guard; this reads the source as a second one
    // that does not depend on how a path resolves: a relative import, the "@/" alias and a bare call are all caught,
    // and every folder of src is scanned (a route or a component is as able to build a body as a module is).
    const builders = sourceFiles("src").filter((file) => file !== join("src", "i18n", "smsStrings.ts") && reads(readFileSync(file, "utf8")));

    expect(builders.map((file) => file.split(/[\\/]/).join("/"))).toEqual(["src/modules/messaging/domain/smsBody.ts"]);
  });

  it("sees an import however it is spelled (the check above is not fooled by the path alias)", () => {
    for (const spelling of [
      'import { fillSms } from "../../../i18n/smsStrings";',
      'import { fillSms } from "@/i18n/smsStrings";',
      "import { fillSms } from '@/i18n/smsStrings';",
      'const m = await import("@/i18n/smsStrings");',
      "const lines = smsStrings(lang);",
    ]) {
      expect(reads(spelling), spelling).toBe(true);
    }
    expect(reads('import { LAUNCH_CODES } from "@/i18n/languages";')).toBe(false);
  });
});
