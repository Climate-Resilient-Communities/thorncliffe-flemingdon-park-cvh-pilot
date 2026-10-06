// `scripts/search-test-set import <file>` (S03.08): turns the ambassadors' question sheet
// (data/search-test-set/template.csv, filled in and saved as CSV UTF-8) into rows of questions.jsonl. Every row is checked
// against the S03.01 schema and the catalogue; a row that holds personal data (a phone number, an email address, a unit or
// apartment number, found by pattern, in any script's digits) is refused, and so is any row but a no_match one without an
// expected provider. The split is not the sheet's to choose: new rows get theirs from the committed seed (subsets.ts).
import { toAsciiDigits } from "@/contracts/digits";
import { TestQuestionSchema, type TestQuestion } from "@/contracts/searchTestSet";
import { PROVIDERS_FILE } from "./lib";

/** The sheet's columns, in the template's order. `id` may be left empty: the import numbers the row `{lang}-{nn}`. */
export const TEMPLATE_COLUMNS = ["id", "lang", "page_lang", "question", "form", "intent", "expected", "author", "added", "checked_by", "checked_on"] as const;
const REQUIRED_COLUMNS = ["lang", "question", "form", "intent", "expected", "author", "added"] as const;

// --- reading CSV ---------------------------------------------------------------------------------

/** RFC 4180 CSV: quoted cells may hold commas, quotes ("") and line breaks; a byte-order mark and CRLF line ends are accepted. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && input[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// --- personal data -------------------------------------------------------------------------------

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/u;
/** Seven or more digits in a run that only spaces, dots, hyphens, slashes and brackets break: a phone number, local or not. */
const PHONE = /\+?\(?\d(?:[\s()./-]{0,3}\d){6,}/u;
/** A unit, apartment, suite, flat or room followed by its number, in the launch languages that write such words in Latin or their own script. */
const UNIT_WORD =
  /(?:^|[^\p{L}])(?:unit|apt|apartment|appt|appartement|apartamento|departamento|depto|suite|ste|flat|room|rm|byt|bytu|फ्लैट|फ़्लैट|अपार्टमेंट|فلیٹ|اپارٹمنٹ|آپارتمان|ফ্ল্যাট|ਫਲੈਟ|ફ્લેટ)\.?\s*(?:no\.?|number|#|nº|n°)?\s*\d+/iu;
/** `#1205` or `# 12`: a number written as a unit. */
const HASH_NUMBER = /#\s*\d{1,5}\b/u;
/** `1205-20 Overlea`: the Canadian way to write a unit before a street number and name. */
const UNIT_STREET = /\b\d{2,5}\s*-\s*\d{1,5}\s+\p{Lu}/u;

/** What kind of personal data a text holds, by pattern; empty when none was found. Digits of any script are read as ASCII digits. */
export function personalDataIn(text: string): string[] {
  const plain = toAsciiDigits(text.normalize("NFKC"));
  const found: string[] = [];
  if (EMAIL.test(plain)) found.push("an email address");
  if (PHONE.test(plain)) found.push("a phone number");
  if (UNIT_WORD.test(plain) || HASH_NUMBER.test(plain) || UNIT_STREET.test(plain)) found.push("a unit or apartment number");
  return found;
}

// --- rows to questions ---------------------------------------------------------------------------

export type ImportedQuestion = Omit<TestQuestion, "split">;
export type RefusedRow = { row: number; reasons: string[] };
export type ImportResult = {
  accepted: (ImportedQuestion & { row: number })[];
  refused: RefusedRow[];
  /** Sheet rows (1-based, the header is row 1) refused because they have no expected provider and are not no_match. */
  missingExpected: number[];
  /** Problems with the sheet as a whole (a missing column); when there are any, no row is read. */
  sheetErrors: string[];
};

/** The provider ids of a cell: separated by spaces, commas or semicolons, upper-cased (`m008` is `M008`). */
export function splitProviderIds(cell: string): string[] {
  return cell
    .split(/[\s,;]+/u)
    .map((id) => id.trim().toUpperCase())
    .filter((id) => id !== "");
}

/** The next free `{lang}-{nn}` id, given the ids already taken. */
function nextId(lang: string, taken: Set<string>): string {
  for (let n = 1; ; n += 1) {
    const id = `${lang.toLowerCase()}-${String(n).padStart(2, "0")}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * Reads the sheet's rows. `existing` is the set as committed: an id or a question text that it already holds is refused, as is one
 * repeated in the sheet. A refused row is never half imported; the caller decides whether the accepted ones are written.
 */
export function importRows(rows: readonly string[][], existing: readonly TestQuestion[], providerIds: ReadonlySet<string>): ImportResult {
  const result: ImportResult = { accepted: [], refused: [], missingExpected: [], sheetErrors: [] };
  const header = (rows[0] ?? []).map((cell) => cell.trim().toLowerCase());
  for (const column of REQUIRED_COLUMNS) {
    if (!header.includes(column)) result.sheetErrors.push(`the sheet has no "${column}" column (the header row must name: ${TEMPLATE_COLUMNS.join(", ")})`);
  }
  const unknown = header.filter((column) => column !== "" && !(TEMPLATE_COLUMNS as readonly string[]).includes(column));
  if (unknown.length > 0) result.sheetErrors.push(`the sheet has columns the template does not: ${unknown.join(", ")} (notes stay out of the sheet: they could hold personal data)`);
  if (result.sheetErrors.length > 0) return result;

  const takenIds = new Set(existing.map((q) => q.id));
  const takenTexts = new Map(existing.map((q) => [q.q, `${q.id} in the set`]));
  rows.slice(1).forEach((cells, index) => {
    const row = index + 2;
    const cell = (name: (typeof TEMPLATE_COLUMNS)[number]) => {
      const at = header.indexOf(name);
      return at < 0 ? "" : (cells[at] ?? "").trim();
    };
    if (cells.every((value) => value.trim() === "")) return;
    if (cells[0]?.trim().startsWith("#")) return; // the template's example row, or a note line

    const reasons: string[] = [];
    const text = cell("question");
    for (const kind of personalDataIn(text)) reasons.push(`holds ${kind}: write the question without it`);

    const lang = cell("lang");
    const intent = cell("intent");
    const expected = splitProviderIds(cell("expected"));
    if (intent !== "no_match" && expected.length === 0) {
      reasons.push(`has no expected provider: every ${intent === "" ? "question" : `${intent} question`} but no_match needs one or more provider ids`);
      result.missingExpected.push(row);
    }
    for (const id of expected) if (!providerIds.has(id)) reasons.push(`expected: provider id ${id} is not in ${PROVIDERS_FILE}`);

    const given = cell("id");
    const id = given === "" ? nextId(lang || "x", takenIds) : given;
    if (given !== "" && takenIds.has(given)) reasons.push(`id: ${given} is already used`);
    const earlier = takenTexts.get(text);
    if (text !== "" && earlier) reasons.push(`question: the same text is already ${earlier}`);

    const candidate = {
      id,
      lang,
      ...(cell("page_lang") === "" ? {} : { page_lang: cell("page_lang") }),
      q: text,
      form: cell("form"),
      intent,
      expected,
      split: "tuning",
      author: cell("author"),
      added: cell("added"),
      checked_by: cell("checked_by") === "" ? null : cell("checked_by"),
      checked_on: cell("checked_on") === "" ? null : cell("checked_on"),
    };
    const parsed = TestQuestionSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        // The missing provider is already said in plain words above.
        if (field === "expected" && expected.length === 0 && intent !== "no_match") continue;
        reasons.push(`${field === "q" ? "question" : field || "row"}: ${issue.message}`);
      }
    }
    if (reasons.length > 0 || !parsed.success) {
      result.refused.push({ row, reasons });
      return;
    }
    const question: ImportedQuestion = { ...parsed.data };
    delete (question as Partial<TestQuestion>).split;
    takenIds.add(question.id);
    takenTexts.set(question.q, `row ${row} of the sheet`);
    result.accepted.push({ ...question, row });
  });
  return result;
}

/** A question as one line of questions.jsonl, in the file's own style (`"key": value`, `, ` between, text as written). */
export function questionLine(question: TestQuestion): string {
  const ordered: [string, unknown][] = [
    ["id", question.id],
    ["lang", question.lang],
    ...(question.page_lang === undefined ? [] : ([["page_lang", question.page_lang]] as [string, unknown][])),
    ["q", question.q],
    ["form", question.form],
    ["intent", question.intent],
    ["expected", question.expected],
    ["split", question.split],
    ["author", question.author],
    ["added", question.added],
    ["checked_by", question.checked_by],
    ["checked_on", question.checked_on],
  ];
  const value = (v: unknown) => (Array.isArray(v) ? `[${v.map((item) => JSON.stringify(item)).join(", ")}]` : JSON.stringify(v));
  return `{${ordered.map(([key, v]) => `${JSON.stringify(key)}: ${value(v)}`).join(", ")}}`;
}
