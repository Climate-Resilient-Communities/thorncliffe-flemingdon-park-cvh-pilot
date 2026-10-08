import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HUB_PHONE_E164 } from "@/contracts/hubNumber.generated";
import { displayPhone } from "@/contracts/phone";
import { OUTPUT, SOURCE, generate, toE164 } from "../scripts/gen-hub-number.mjs";

const ROOT = path.join(__dirname, "..");
const numbers = JSON.parse(readFileSync(path.join(ROOT, SOURCE), "utf8")) as { numbers: { id: string; number: string }[] };

describe("the Hub's number (src/contracts/hubNumber.generated.ts)", () => {
  it("is what data/catalogue/numbers.json gives for the number with id hub (run npm run gen:hub-number)", () => {
    expect(readFileSync(path.join(ROOT, OUTPUT), "utf8")).toBe(generate(ROOT));
  });

  it("is stored as E.164 and reads back, through displayPhone, as numbers.json writes it", () => {
    const hub = numbers.numbers.find((entry) => entry.id === "hub")!;

    expect(HUB_PHONE_E164).toMatch(/^\+1[2-9]\d{9}$/);
    expect(displayPhone(HUB_PHONE_E164)).toBe(hub.number);
  });

  it.each([
    ["(416) 421-8997", "+14164218997"],
    ["416-421-8997", "+14164218997"],
    ["+1 416 421 8997", "+14164218997"],
    ["1 (416) 421-8997", "+14164218997"],
    ["+14164218997", "+14164218997"],
  ])("converts %s to E.164", (written, expected) => {
    expect(toE164(written)).toBe(expected);
  });

  it.each(["911", "421-8997", "", null, "+44 20 7946 0958"])("refuses %j: it is not a ten-digit North American number", (written) => {
    expect(() => toE164(written)).toThrow("not a ten-digit North American number");
  });

  it("is checked by --check: a stale file fails it, and the number being removed from numbers.json is refused", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "hub-number-check-"));
    try {
      mkdirSync(path.join(dir, "scripts"));
      mkdirSync(path.join(dir, "data", "catalogue"), { recursive: true });
      mkdirSync(path.join(dir, path.dirname(OUTPUT)), { recursive: true });
      copyFileSync(path.join(ROOT, "scripts", "gen-hub-number.mjs"), path.join(dir, "scripts", "gen-hub-number.mjs"));
      copyFileSync(path.join(ROOT, SOURCE), path.join(dir, SOURCE));
      copyFileSync(path.join(ROOT, OUTPUT), path.join(dir, OUTPUT));
      const run = (root = dir) => spawnSync(process.execPath, [path.join(root, "scripts", "gen-hub-number.mjs"), "--check"], { encoding: "utf8" });

      expect(run().status).toBe(0);
      // Run through a symlink too (a linked checkout; macOS's temporary folder is one): the script still runs, and still finds a stale file.
      const link = `${dir}-link`;
      symlinkSync(dir, link);
      expect(run(link).stdout).toContain(`${OUTPUT} is up to date.`);

      writeFileSync(path.join(dir, SOURCE), JSON.stringify({ numbers: numbers.numbers.map((entry) => (entry.id === "hub" ? { ...entry, number: "(416) 555-0100" } : entry)) }));
      const stale = run();
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain(`${OUTPUT} is stale`);
      expect(run(link).status).toBe(1);

      writeFileSync(path.join(dir, SOURCE), JSON.stringify({ numbers: numbers.numbers.filter((entry) => entry.id !== "hub") }));
      const missing = run();
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('no number with id "hub"');
    } finally {
      rmSync(`${dir}-link`, { force: true });
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
