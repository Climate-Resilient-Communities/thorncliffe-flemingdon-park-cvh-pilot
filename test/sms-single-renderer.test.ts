import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SMS_STRING_KEYS } from "../src/i18n/smsStrings";

// AD-21: messaging's renderer is the only builder of a text message. The dependency rule
// `sms-adapter-outside-messaging` keeps the senders inside messaging; this keeps the words of a text message in one
// place: no other code names the catalog keys a body is made of, so no other code can assemble one.

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

  it("builds no body outside the renderer: nothing but smsBody.ts joins a text message's lines", () => {
    const files = sourceFiles(join("src", "modules"));
    const builders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      return /smsStrings\(/.test(text) || /from "[./]*i18n\/smsStrings"/.test(text);
    });

    expect(builders.map((file) => file.split(/[\\/]/).join("/"))).toEqual(["src/modules/messaging/domain/smsBody.ts"]);
  });
});
