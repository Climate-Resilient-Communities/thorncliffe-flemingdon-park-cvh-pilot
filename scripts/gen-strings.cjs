const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "design", "prototype", "cvh");
const OUT = path.join(ROOT, "src", "i18n", "messages");
const SOURCE_LANGUAGE = "en";
const MARKER = "[EN] ";

// Keys whose absence in any language fails CI (AD-16): the 911 block that sits on every
// alert, guide, essential-numbers page and check-in screen, the machine-translation label
// and "Not known". x01.partner is the partner space's own wording and is not part of it.
const REQUIRED_KEYS = [
  "x01.text",
  "x01.call",
  "x01.short",
  "x01.sms",
  "x01.print",
  "x04.label",
  "x09.unknown",
  "status.unknown",
];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Runs the prototype's data and string files the way its pages do: each file adds to
 * window.CVH_DATA or window.CVH_STRINGS. English loads first so that
 * strings.en.screens.js can merge into it.
 *
 * @param {string} source directory holding data.js and strings.*.js
 * @returns {{ languages: { code: string, dir: string }[], tables: Record<string, object> }}
 */
function loadPrototype(source) {
  const window = {};
  const context = vm.createContext({ window });
  const run = (file) => {
    const full = path.join(source, file);
    vm.runInContext(fs.readFileSync(full, "utf8"), context, { filename: full });
  };

  const files = fs.readdirSync(source).filter((file) => /^strings\..+\.js$/.test(file)).sort();
  const first = ["strings.en.js", "strings.en.screens.js"].filter((file) => files.includes(file));
  run("data.js");
  for (const file of [...first, ...files.filter((file) => !first.includes(file))]) run(file);

  const languages = (window.CVH_DATA?.languages ?? []).map(({ code, dir }) => ({ code, dir }));
  if (languages.length === 0) throw new Error("data.js lists no languages");
  const tables = window.CVH_STRINGS ?? {};
  const wanted = [SOURCE_LANGUAGE, ...languages.map(({ code }) => code)];
  for (const code of new Set(wanted)) {
    if (!isObject(tables[code])) throw new Error(`No string table for language "${code}"`);
  }
  const unlisted = Object.keys(tables).filter((code) => !wanted.includes(code));
  if (unlisted.length > 0) {
    throw new Error(`String tables for languages not listed in data.js: ${unlisted.join(", ")}`);
  }
  return { languages, tables };
}

/** Marks the words of an English list: text gets the marker, numbers and blanks do not. */
function markList(list) {
  return list.map((item) => {
    if (Array.isArray(item)) return markList(item);
    return typeof item === "string" && /\p{L}/u.test(item) ? MARKER + item : item;
  });
}

const present = (value) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && value.length === 0);

/**
 * Lays one language over English. A key the language lacks takes the English text behind
 * the visible "[EN]" marker, never an empty string. Lists count as one key.
 *
 * @returns {{ messages: object, missing: string[] }} `missing` holds dotted key paths
 */
function mergeLanguage(english, table, code) {
  const missing = [];
  const walk = (en, tr, prefix) => {
    const out = {};
    for (const key of Object.keys(en)) {
      if (key.includes(".")) throw new Error(`Key "${prefix}${key}" contains a dot`);
      const keyPath = prefix + key;
      const value = en[key];
      const own = isObject(tr) ? tr[key] : undefined;
      if (isObject(value)) {
        out[key] = walk(value, own, `${keyPath}.`);
      } else if (present(own)) {
        out[key] = own;
      } else if (code === SOURCE_LANGUAGE) {
        out[key] = value;
      } else {
        missing.push(keyPath);
        out[key] = Array.isArray(value) ? markList(value) : MARKER + value;
      }
    }
    if (isObject(tr)) {
      const extra = Object.keys(tr).filter((key) => !(key in en));
      if (extra.length > 0) {
        throw new Error(`"${code}" has keys English lacks: ${extra.map((key) => prefix + key).join(", ")}`);
      }
    }
    return out;
  };
  return { messages: walk(english, table, ""), missing };
}

/**
 * Builds every catalog and the missing-key report. Writes nothing.
 *
 * @param {string} [source]
 * @returns {{ files: Record<string, string>, report: { code: string, missing: number, requiredMissing: string[] }[] }}
 *   `files` maps catalog file name to content
 */
function generateCatalogs(source = SOURCE) {
  const { languages, tables } = loadPrototype(source);
  const files = {};
  const report = [];
  for (const code of [...new Set([SOURCE_LANGUAGE, ...languages.map((language) => language.code)])]) {
    const { messages, missing } = mergeLanguage(tables[SOURCE_LANGUAGE], tables[code], code);
    files[`${code}.json`] = `${JSON.stringify(messages, null, 2)}\n`;
    report.push({
      code,
      missing: missing.length,
      requiredMissing: REQUIRED_KEYS.filter((key) => missing.includes(key)),
    });
  }
  return { files, report };
}

/** Names the catalogs in `dir` that are missing, extra or different from `files`. */
function staleCatalogs(files, dir) {
  const onDisk = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
  const stale = [];
  for (const name of Object.keys(files)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) stale.push(`${name} (missing)`);
    else if (fs.readFileSync(file, "utf8") !== files[name]) stale.push(`${name} (differs)`);
  }
  for (const name of onDisk) if (!(name in files)) stale.push(`${name} (not generated)`);
  return stale.sort();
}

function formatReport(report) {
  const rows = report.map(
    ({ code, missing, requiredMissing }) => `| ${code} | ${missing} | ${requiredMissing.join(", ") || "none"} |`,
  );
  return [
    "## Missing interface strings per language",
    "",
    "| Language | Keys missing (shown in English with [EN]) | Required keys missing |",
    "| --- | ---: | --- |",
    ...rows,
    "",
  ].join("\n");
}

/** Writes the catalogs, or with --check compares them. Returns the exit code. */
function main(argv) {
  const check = argv.includes("--check");
  const option = (name, fallback) => {
    const at = argv.indexOf(name);
    return at === -1 ? fallback : path.resolve(argv[at + 1]);
  };
  const out = option("--out", OUT);
  const { files, report } = generateCatalogs(option("--source", SOURCE));
  let failed = false;

  if (check) {
    const stale = staleCatalogs(files, out);
    if (stale.length > 0) {
      failed = true;
      console.error(`Generated catalogs are stale; run "npm run gen:strings" and commit the result:\n${stale.join("\n")}`);
    }
  } else {
    fs.mkdirSync(out, { recursive: true });
    for (const name of fs.readdirSync(out)) {
      if (name.endsWith(".json") && !(name in files)) fs.rmSync(path.join(out, name));
    }
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(out, name), content);
    console.log(`Wrote ${Object.keys(files).length} catalogs to ${path.relative(process.cwd(), out) || "."}`);
  }

  const text = formatReport(report);
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);

  for (const { code, requiredMissing } of report) {
    if (requiredMissing.length > 0) {
      failed = true;
      console.error(`"${code}" is missing required keys: ${requiredMissing.join(", ")}`);
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { MARKER, REQUIRED_KEYS, generateCatalogs, staleCatalogs, formatReport };
