// A small SQL lexer for the migration checks. It does not parse SQL; it only
// separates code from comments and literals so that the checks never match
// text inside a comment, a string or a function body.

/**
 * @typedef {{ code: string, text: string }} Statement
 *   `code` has comments removed and every string or dollar-quoted body replaced
 *   by '' (so a function body never counts as a statement); whitespace is
 *   collapsed. `text` is the original statement text, trimmed.
 */

const ROUTINE_WITH_ATOMIC_BODY = /^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure)\b[\s\S]*?\bbegin\s+atomic\b([\s\S]*)$/i;

/**
 * Whether code (comments and literals already removed) ends inside the body of
 * a SQL-standard routine, `BEGIN ATOMIC ... END`, whose statements end in
 * semicolons that do not end the CREATE statement. CASE ... END nests inside it.
 */
function insideAtomicBody(code) {
  const match = ROUTINE_WITH_ATOMIC_BODY.exec(code);
  if (!match) return false;
  const words = match[1].replace(/"(?:[^"]|"")*"/g, " ").toLowerCase().match(/\b(?:case|end)\b/g) ?? [];
  let depth = 1;
  for (const word of words) depth += word === "case" ? 1 : -1;
  return depth > 0;
}

/**
 * Splits SQL into statements and collects its line comments.
 *
 * @param {string} source
 * @returns {{ statements: Statement[], comments: string[] }}
 */
export function lexSql(source) {
  const statements = [];
  const comments = [];
  let code = "";
  let start = 0;
  let i = 0;

  const finish = (end) => {
    const collapsed = code.replace(/\s+/g, " ").trim();
    if (collapsed !== "") {
      statements.push({ code: collapsed, text: source.slice(start, end).trim() });
    }
    code = "";
    start = end + 1;
  };

  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "-" && next === "-") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      comments.push(source.slice(i, stop));
      code += " ";
      i = stop;
      continue;
    }

    if (c === "/" && next === "*") {
      // Block comments nest in PostgreSQL.
      let depth = 1;
      let j = i + 2;
      while (j < source.length && depth > 0) {
        if (source[j] === "/" && source[j + 1] === "*") {
          depth += 1;
          j += 2;
        } else if (source[j] === "*" && source[j + 1] === "/") {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      if (depth > 0) throw new Error("Unterminated block comment");
      code += " ";
      i = j;
      continue;
    }

    if (c === "'") {
      // E'...' strings allow backslash escapes; '' is an escaped quote in both.
      const escapes = /[eE]$/.test(code) && !/[\w$]$/.test(code.slice(0, -1));
      let j = i + 1;
      for (;;) {
        if (j >= source.length) throw new Error("Unterminated string literal");
        if (escapes && source[j] === "\\") {
          j += 2;
        } else if (source[j] === "'" && source[j + 1] === "'") {
          j += 2;
        } else if (source[j] === "'") {
          break;
        } else {
          j += 1;
        }
      }
      code += "''";
      i = j + 1;
      continue;
    }

    if (c === '"') {
      const end = source.indexOf('"', i + 1);
      if (end === -1) throw new Error("Unterminated quoted identifier");
      // Keep quoted identifiers ("" inside one is two adjacent quoted parts).
      code += source.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    if (c === "$" && !/[\w$]$/.test(code)) {
      const tag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(source.slice(i));
      if (tag) {
        const end = source.indexOf(tag[0], i + tag[0].length);
        if (end === -1) throw new Error(`Unterminated dollar-quoted string ${tag[0]}`);
        code += "''";
        i = end + tag[0].length;
        continue;
      }
    }

    if (c === ";") {
      if (insideAtomicBody(code)) {
        code += c;
        i += 1;
        continue;
      }
      finish(i);
      i += 1;
      continue;
    }

    code += c;
    i += 1;
  }
  finish(source.length);
  return { statements, comments };
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const NAME = String.raw`${IDENT}(?:\s*\.\s*${IDENT})*`;
const re = (pattern) => new RegExp(pattern, "i");

const DROP_TABLE = re(String.raw`^drop\s+(?:foreign\s+)?table\s+(?:if\s+exists\s+)?(.+?)(?:\s+(?:cascade|restrict))?$`);
const DROP_SCHEMA = re(String.raw`^drop\s+schema\s+(?:if\s+exists\s+)?(.+?)(?:\s+(?:cascade|restrict))?$`);
const ALTER_TABLE = re(String.raw`^alter\s+(?:foreign\s+)?table\s+(?:if\s+exists\s+)?(?:only\s+)?(${NAME})\s*\*?\s+(.+)$`);
const RENAME_TABLE = re(String.raw`^rename\s+to\s+(${IDENT})$`);
const RENAME_COLUMN = re(String.raw`^rename\s+(?:column\s+)?(${IDENT})\s+to\s+(${IDENT})$`);
const RENAME_CONSTRAINT = re(String.raw`^rename\s+constraint\b`);
const SET_SCHEMA = re(String.raw`^set\s+schema\s+(${IDENT})$`);
const DROP_COLUMN = re(String.raw`^drop\s+(?:column\s+)?(?:if\s+exists\s+)?(${IDENT})`);
const DROP_CONSTRAINT = re(String.raw`^drop\s+constraint\b`);
const ALTER_TYPE = re(String.raw`^alter\s+(?:column\s+)?(${IDENT})\s+(?:set\s+data\s+)?type\s+(.+?)(?:\s+(?:collate|using)\b.*)?$`);

/** Splits "a, b(c, d), e" at commas outside parentheses. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const c of text) {
    if (c === "(") depth += 1;
    if (c === ")") depth -= 1;
    if (c === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }
  if (current.trim() !== "") parts.push(current.trim());
  return parts;
}

/**
 * Finds changes that break the previous app release: dropping or renaming a
 * table or column, moving a table to another schema, or changing a column's
 * type. A type change is always reported, because the old type is not known
 * from the migration text, so a widening cannot be told from a narrowing.
 *
 * @param {string} source
 * @returns {string[]} one description per change, in file order
 */
export function findDestructiveChanges(source) {
  const changes = [];
  for (const { code } of lexSql(source).statements) {
    let match;
    if ((match = DROP_TABLE.exec(code))) {
      changes.push(`drops table ${match[1]}`);
    } else if ((match = DROP_SCHEMA.exec(code))) {
      changes.push(`drops schema ${match[1]} (and every table in it)`);
    } else if ((match = ALTER_TABLE.exec(code))) {
      const table = match[1];
      for (const action of splitTopLevel(match[2])) {
        let m;
        if ((m = RENAME_TABLE.exec(action))) {
          changes.push(`renames table ${table} to ${m[1]}`);
        } else if (RENAME_CONSTRAINT.test(action)) {
          continue;
        } else if ((m = RENAME_COLUMN.exec(action))) {
          changes.push(`renames column ${table}.${m[1]} to ${m[2]}`);
        } else if ((m = SET_SCHEMA.exec(action))) {
          changes.push(`moves table ${table} to schema ${m[1]}`);
        } else if (DROP_CONSTRAINT.test(action)) {
          continue;
        } else if ((m = DROP_COLUMN.exec(action))) {
          changes.push(`drops column ${table}.${m[1]}`);
        } else if ((m = ALTER_TYPE.exec(action))) {
          changes.push(`changes the type of column ${table}.${m[1]} to ${m[2]} (may narrow it)`);
        }
      }
    }
  }
  return changes;
}

const CONTRACT = /^--\s*contract:\s*(.*)$/i;
const RELEASE = /^[0-9a-f]{7,40}$/i;

/**
 * Reads the `-- contract: <release>` notes of a migration. A release is the
 * commit SHA that the app reports as its version (GET /api/health).
 *
 * @param {string} source
 * @returns {{ releases: string[], problems: string[] }}
 */
export function readContractNotes(source) {
  const releases = [];
  const problems = [];
  for (const comment of lexSql(source).comments) {
    const match = CONTRACT.exec(comment.trim());
    if (!match) continue;
    const release = match[1].trim().split(/\s+/)[0] ?? "";
    if (RELEASE.test(release)) {
      releases.push(release.toLowerCase());
    } else {
      problems.push(
        `"${comment.trim()}" does not name a release: write "-- contract: <commit SHA of the release that stopped using it>"`,
      );
    }
  }
  return { releases, problems };
}

const TRANSACTION_CONTROL = re(
  String.raw`^(?:begin|commit|rollback|abort|end|start\s+transaction|savepoint|release|prepare\s+transaction)\b`,
);
const NON_TRANSACTIONAL = re(
  String.raw`^(?:create\s+(?:unique\s+)?index\s+concurrently|drop\s+index\s+concurrently|reindex\b.*\bconcurrently|vacuum|create\s+database|drop\s+database|alter\s+system)\b`,
);

/**
 * Statements that cannot run inside the runner's per-migration transaction.
 *
 * @param {string} source
 * @returns {string[]}
 */
export function findTransactionProblems(source) {
  const problems = [];
  for (const { code } of lexSql(source).statements) {
    if (TRANSACTION_CONTROL.test(code)) {
      problems.push(
        `"${code.slice(0, 60)}" controls the transaction; the runner wraps each migration in its own transaction`,
      );
    } else if (NON_TRANSACTIONAL.test(code)) {
      problems.push(`"${code.slice(0, 60)}" cannot run inside a transaction`);
    }
  }
  return problems;
}
