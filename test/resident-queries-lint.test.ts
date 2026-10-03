// The lint rule of AD-6 (S04.08): in the files of src/modules/alerting/adapters/resident/ no string may name an alert
// relation other than the three nondrill_ views, so a resident query cannot be written against `alert`, `alert_entry`
// or any `alert_`-table (a drill's thread, a draft, an unpublished entry) without `npm run lint` failing. The rule is
// eslint.config.mjs's `no-restricted-syntax` for that folder; this runs the repository's own configuration on text.
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });
const RESIDENT = "src/modules/alerting/adapters/resident/query.ts";

async function messagesFor(code: string, filePath = RESIDENT) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === "no-restricted-syntax");
}

describe("the resident query rule (resident-queries-read-nondrill-only)", () => {
  it.each([
    ["a quoted table", 'export const q = "select id from alert";'],
    ["a quoted entry table", "export const q = 'select * from alert_entry where status = 1';"],
    ["the translation table", 'export const q = "alert_entry_translation";'],
    ["the attempt table", 'export const q = "alert_submit_attempt";'],
    ["a schema-qualified table", 'export const q = "public.alert";'],
    ["a table in a template", "export const q = `select id from alert where id = ${1}`;"],
    ["a table in a template, after an expression", "export const q = `${1} join alert_entry on true`;"],
    ["a table that only starts like the column", 'export const q = "alert_identity";'],
    ["a table in a quoted identifier", 'export const q = \'select id from "alert"\';'],
  ])("fails %s", async (_name, code) => {
    const messages = await messagesFor(code);

    expect(messages, code).toHaveLength(1);
    expect(messages[0].message).toContain("resident-queries-read-nondrill-only");
  });

  it.each([
    ["the thread view", 'export const q = "select id from nondrill_alert";'],
    ["the entry view", 'export const q = "select id from nondrill_alert_entry";'],
    ["the translation view", "export const q = `select body from nondrill_alert_entry_translation where lang = ${1}`;"],
    ["a word that only contains the name", 'export const q = "alerting alerts alerted";'],
    ["an identifier", "export const alertCount = 1;"],
    ["the column that joins an entry to its thread", 'export const q = "alert_id";'],
    ["that column in SQL", "export const q = `select alert_id from nondrill_alert_entry where alert_id = ${1}`;"],
  ])("allows %s", async (_name, code) => {
    expect(await messagesFor(code), code).toEqual([]);
  });

  it("does not apply to the rest of the module, to the app, or to a test beside the resident queries", async () => {
    const code = 'export const q = "select id from alert";';

    expect(await messagesFor(code, "src/modules/alerting/application/lifecycle.ts")).toEqual([]);
    expect(await messagesFor(code, "src/modules/alerting/adapters/schema.ts")).toEqual([]);
    expect(await messagesFor(code, "src/app/api/feed/source.ts")).toEqual([]);
    expect(await messagesFor(code, "src/modules/alerting/adapters/resident/query.test.ts")).toEqual([]);
  });

  it("is clean for the resident query files that exist", async () => {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync("src/modules/alerting/adapters/resident").filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    const results = await eslint.lintFiles(files.map((name) => `src/modules/alerting/adapters/resident/${name}`));
    for (const result of results) expect(result.messages.filter((m) => m.ruleId === "no-restricted-syntax"), result.filePath).toEqual([]);
  });
});
