import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// AD-6 (S04.08): a resident query reads the alert views that leave drills out and no other alert relation. In the files of
// src/modules/alerting/adapters/resident/ no string (SQL text, a table name for `sql`, a raw query) may name `alert` or a
// table that starts with `alert_` (the column `alert_id` is the one exception); `nondrill_alert` and its two sibling views are not
// matched (the name is part of a longer word). The same files may not import the Drizzle tables either: that is the dependency rule of the same name. Keep the
// bare word out of messages in those files; the rule cannot tell a sentence from a table. test/resident-queries-lint.test.ts
// runs this rule on a file in that folder.
const RESIDENT_QUERY_RELATION = String.raw`(?<![A-Za-z0-9_])alert(?!_id(?![A-Za-z0-9_]))(?:_[a-z0-9_]+)?(?![A-Za-z0-9_])`;
const RESIDENT_QUERY_MESSAGE =
  "resident-queries-read-nondrill-only (AD-6): a resident query reads nondrill_alert, nondrill_alert_entry and nondrill_alert_entry_translation and no other alert relation, so a drill or an unpublished entry can never reach a resident.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    files: ["src/modules/alerting/adapters/resident/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=/${RESIDENT_QUERY_RELATION}/]`, message: RESIDENT_QUERY_MESSAGE },
        { selector: `TemplateElement[value.raw=/${RESIDENT_QUERY_RELATION}/]`, message: RESIDENT_QUERY_MESSAGE },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Planning, data and prototype material:
    "docs/**",
    "data/**",
    "design/**",
    // Generated output:
    ".vercel/**",
    "playwright-report/**",
    "test-results/**",
  ]),
]);

export default eslintConfig;
