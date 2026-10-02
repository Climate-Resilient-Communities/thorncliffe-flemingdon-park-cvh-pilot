// Code that runs inside a transaction queries through that transaction, never the client (the
// pool). A transaction holds one pool connection until it ends; a query on a second one, taken
// while the other connections wait for a lock the transaction holds (the sign-in throttle's
// advisory lock, the Admin rows), finds none free and deadlocks the pool (src/platform/db/client.ts).
//
// The guard: in src/modules, the callback of every `.transaction(...)` and every function that
// takes a DbTransaction never names `db` (the captured client, `deps.db` included) nor calls
// getDb(). Readers a transaction calls through its deps take the executor as an argument instead
// (e.g. usability.ts's SignInLockReader), which the type checker enforces.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const MODULES = path.join(__dirname, "..", "src", "modules");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sources(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** True for a function that runs inside a transaction: a `.transaction(...)` callback, or one taking a DbTransaction. */
function runsInTransaction(node: ts.Node, source: ts.SourceFile): node is ts.FunctionLikeDeclaration {
  if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node) && !ts.isFunctionDeclaration(node) && !ts.isMethodDeclaration(node)) return false;
  const parent = node.parent;
  if (
    parent &&
    ts.isCallExpression(parent) &&
    parent.arguments.includes(node as ts.Expression) &&
    ts.isPropertyAccessExpression(parent.expression) &&
    parent.expression.name.text === "transaction"
  ) {
    return true;
  }
  // A parameter typed DbTransaction itself (not a callback type that mentions one).
  return node.parameters.some((parameter) => parameter.type !== undefined && ts.isTypeReferenceNode(parameter.type) && parameter.type.typeName.getText(source) === "DbTransaction");
}

/** Where code inside a transaction reaches for the client instead of the transaction: `file:line: text`. */
function poolUsesInTransactions(fileName: string, text: string): string[] {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const found = new Set<string>();
  const report = (node: ts.Node) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    found.add(`${fileName}:${line + 1}: ${node.getText(source)}`);
  };
  const inspect = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "db") {
      const parent = node.parent;
      // `db` as a name being declared (a parameter or variable of a nested function) or an object key is not a use.
      const declared =
        (ts.isParameter(parent) || ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isBindingElement(parent)) && parent.name === node;
      if (!declared) report(ts.isPropertyAccessExpression(parent) && parent.name === node ? parent : node);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "getDb") report(node);
    ts.forEachChild(node, inspect);
  };
  const visit = (node: ts.Node) => {
    if (runsInTransaction(node, source)) {
      if (node.body) inspect(node.body);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...found];
}

describe("code inside a transaction", () => {
  it("never queries through the client (a second pool connection) in src/modules", () => {
    const files = sources(MODULES);
    expect(files.length).toBeGreaterThan(0);
    const offences = files.flatMap((file) => poolUsesInTransactions(path.relative(MODULES, file), readFileSync(file, "utf8")));

    expect(offences).toEqual([]);
  });

  it("the guard finds the client named inside a transaction callback or a function taking a DbTransaction", () => {
    const offending = `
      async function a(deps: { db: Db }) {
        await deps.db.transaction(async (tx) => {
          await read(deps.db, "x");
        });
        return db.transaction((tx) => store.find(db, 1));
      }
      async function b(tx: DbTransaction, id: string) { return lockedUntil(db, id); }
      const c = { async begin(tx: DbTransaction) { return getDb(); } };
      async function fine(tx: DbTransaction, db = 1) { return store.find(tx, { db: 2 }); }
    `;

    expect(poolUsesInTransactions("example.ts", offending).map((offence) => offence.replace(/^example\.ts:\d+: /, ""))).toEqual([
      "deps.db",
      "db",
      "db",
      "getDb()",
    ]);
  });
});
