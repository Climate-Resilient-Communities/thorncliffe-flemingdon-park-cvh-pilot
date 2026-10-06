// scripts/access-request (S09.03, E09 "Access request", PIPEDA): IT handles a resident's request to see, correct or delete what the CVH holds about their number,
// on an Admin's behalf, after the Admin has established verified control by calling the number back. The pilot has no screen for it (S09.06 is the MVP's).
// Run it through the launcher scripts/access-request, which bundles it with esbuild:
//
//   node --env-file=.env.production.local scripts/access-request receive --admin jdoe --request access [--rehearsal]
//   node --env-file=.env.production.local scripts/access-request list
//   node --env-file=.env.production.local scripts/access-request show --id <request id> --verified-control
//   node --env-file=.env.production.local scripts/access-request delete --id <request id> --admin jdoe --verified-control
//   node --env-file=.env.production.local scripts/access-request close --id <request id> --admin jdoe --outcome answered
//
// It needs production's environment (VERCEL_ENV=production and the rest of what src/platform/config/env.ts requires there, for example from
// `vercel env pull --environment=production .env.production.local`): the app's own database connection (DATABASE_URL, as cvh_app_login, which is the only role
// that can read the residents' tables: Supabase's service_role has no grant on them) and the Supabase secret key (SUPABASE_SECRET_KEY), from which the keyed
// hashes of the number in `rate_limit` are found. The procedure is docs/procedures/access-request.md.
//
// What it guarantees: `show` reads in one read-only transaction (Postgres refuses any write in it), prints to the terminal only (it refuses to print into a
// file or a pipe) and saves nothing; the number is typed at a prompt, never given as an argument, so it is not kept in the shell's history; nothing it records
// holds the number. `delete` runs the one E07 deletion (the steps STOP runs) and closes the request in the same transaction. Every request is in the audit trail
// as `access_request.received` and `access_request.closed`, with the Admin as the actor, and the weekly review flags one open longer than 25 days.
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import {
  ACCESS_REQUEST_FLAG_DAYS,
  ACCESS_REQUEST_LIMIT_DAYS,
  CLOSING_OUTCOMES,
  createAccessRequests,
  heldRecordLines,
  rateLimitKeyFromSecret,
  torontoTime,
  type AccessRequestKind,
  type AccessRequests,
  type AdminRefusal,
  type ClosingOutcome,
  type NumberRefusal,
  type RequestRefusal,
} from "../../src/modules/subscriptions";
import type { Env } from "../../src/platform/config/env";
import { createDb } from "../../src/platform/db";
import { productionEnvironment } from "../identity/create-first-admin";

export interface Connection {
  requests: AccessRequests;
  close: () => Promise<void>;
}

export interface CliDeps {
  env: Record<string, string | undefined>;
  out: (line: string) => void;
  error: (line: string) => void;
  /** Asks one question on the terminal and returns the answer (the number, the deletion's confirmation). */
  prompt: (question: string) => Promise<string>;
  /** Whether what is printed goes to a terminal (not a file or a pipe). */
  isTerminal: () => boolean;
  /** Test seam: the use cases on a production environment (a test database in tests). */
  connect?: (env: Env) => Connection;
}

const REQUESTS: readonly AccessRequestKind[] = ["access", "correction", "deletion"];
const COMMANDS = ["receive", "list", "show", "delete", "close"] as const;
type Command = (typeof COMMANDS)[number];

const USAGE =
  "Usage: node --env-file=<production env file> scripts/access-request <command> [options]\n\n" +
  "A resident's request to see, correct or delete what the CVH holds about their number (PIPEDA: answered within 30 days). The procedure,\n" +
  "with what to say on the call, is docs/procedures/access-request.md. Every command needs production's environment.\n\n" +
  "  receive --admin <username> --request <access|correction|deletion> [--rehearsal]\n" +
  "      Records a new request on the day it reaches the Hub, with the Admin who handles it, and prints its id. Nothing about the resident is\n" +
  "      asked or recorded. --rehearsal marks a rehearsal's request, which the weekly review reports apart.\n" +
  "  list\n" +
  `      The requests still open, oldest first, with the days each has been open. One open more than ${ACCESS_REQUEST_FLAG_DAYS} days is flagged.\n` +
  "  show --id <request id> --verified-control\n" +
  "      Only after the Admin has verified control of the number (a call back to it, or the one-time phrase texted from it). Asks for the number\n" +
  "      at a prompt and shows what the CVH holds for it, on this screen only: it reads in a read-only transaction, saves nothing and refuses to\n" +
  "      print into a file or a pipe. Message words are never shown.\n" +
  "  delete --id <request id> --admin <username> --verified-control\n" +
  "      Only after verified control. Asks for the number, then for DELETE, and deletes everything held for it: the deletion a STOP from the\n" +
  "      number runs (subscriber, places, muted topics, prompts, pending sign-up, waiting replies; waiting texts are stopped). It cannot be\n" +
  "      undone (the pilot keeps no backups). The request is closed as deleted in the same transaction.\n" +
  `  close --id <request id> --admin <username> --outcome <${CLOSING_OUTCOMES.join("|")}>\n` +
  "      answered: what is held was read back (and a correction explained); not_verified: control of the number could not be shown, so nothing\n" +
  "      was revealed or deleted; withdrawn: the resident withdrew the request.\n\n" +
  "The number is typed at a prompt, never given as an argument, so it is not kept in the shell's history. The audit trail records each request\n" +
  "(`access_request.received`, `access_request.closed`) with its dates, its outcome and the Admin, never the number.";

const ADMIN_REFUSALS: Record<AdminRefusal, string> = {
  no_such_admin: "no account has that username",
  not_admin: "that account is not an Admin: an access request is handled by an Admin",
  admin_not_active: "that Admin's account is suspended or removed",
};
const REQUEST_REFUSALS: Record<RequestRefusal, string> = {
  not_found: "no access request has that id (run `list` to see the open ones)",
  closed: "that access request is already closed",
};
const NUMBER_REFUSALS: Record<NumberRefusal, string> = {
  not_canadian: "that is not a Canadian number, and the CVH holds nothing for any other (sign-up accepts only Canadian numbers)",
};
const REFUSALS: Record<AdminRefusal | RequestRefusal | NumberRefusal, string> = { ...ADMIN_REFUSALS, ...REQUEST_REFUSALS, ...NUMBER_REFUSALS };

function connectToProduction(env: Env): Connection {
  // parseEnv requires both in production.
  const db = createDb(env.databaseUrl as string, { max: 1 });
  const key = rateLimitKeyFromSecret(env.supabaseSecretKey as string);
  return { requests: createAccessRequests({ db, numberKey: () => key }), close: () => db.$client.end({ timeout: 5 }) };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isRequest = (value: string): value is AccessRequestKind => (REQUESTS as readonly string[]).includes(value);
const isOutcome = (value: string): value is ClosingOutcome => (CLOSING_OUTCOMES as readonly string[]).includes(value);
const isCommand = (value: string): value is Command => (COMMANDS as readonly string[]).includes(value);
const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

/** The options each command needs and takes (anything else is refused before connecting). */
const OPTIONS: Record<Command, { needs: string[]; takes: string[] }> = {
  receive: { needs: ["admin", "request"], takes: ["rehearsal"] },
  list: { needs: [], takes: [] },
  show: { needs: ["id", "verified-control"], takes: [] },
  delete: { needs: ["id", "admin", "verified-control"], takes: [] },
  close: { needs: ["id", "admin", "outcome"], takes: [] },
};

export async function runAccessRequest(argv: string[], deps: CliDeps): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      options: {
        admin: { type: "string" },
        request: { type: "string" },
        rehearsal: { type: "boolean" },
        id: { type: "string" },
        outcome: { type: "string" },
        "verified-control": { type: "boolean" },
      },
      strict: true,
      allowPositionals: true,
    }));
  } catch (error) {
    deps.error(`${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const [command, ...extra] = positionals;
  if (command === undefined || !isCommand(command) || extra.length > 0) {
    // A number given as an argument is not echoed back: it would only be printed again.
    deps.error(`${command === undefined ? "Missing the command" : `Not a command: give one of ${COMMANDS.join(", ")}`}\n${USAGE}`);
    return 2;
  }
  const { needs, takes } = OPTIONS[command];
  const missing = needs.filter((name) => values[name] === undefined);
  if (missing.length > 0) {
    const verify = missing.includes("verified-control") ? "\n--verified-control confirms that the Admin has verified control of the number (a call back to it, or the one-time phrase texted from it). Without it nothing is shown or deleted: close the request as not_verified instead." : "";
    deps.error(`${command}: missing ${missing.map((name) => `--${name}`).join(", ")}${verify}\n${USAGE}`);
    return 2;
  }
  const unexpected = Object.keys(values).filter((name) => values[name] !== undefined && !needs.includes(name) && !takes.includes(name));
  if (unexpected.length > 0) {
    deps.error(`${command} does not take ${unexpected.map((name) => `--${name}`).join(", ")}\n${USAGE}`);
    return 2;
  }
  const request = typeof values.request === "string" ? values.request : "";
  if (command === "receive" && !isRequest(request)) {
    deps.error(`--request must be one of ${REQUESTS.join(", ")}\n${USAGE}`);
    return 2;
  }
  const outcome = typeof values.outcome === "string" ? values.outcome : "";
  if (command === "close" && !isOutcome(outcome)) {
    deps.error(`--outcome must be one of ${CLOSING_OUTCOMES.join(", ")} (a deletion closes its request itself)\n${USAGE}`);
    return 2;
  }
  const id = typeof values.id === "string" ? values.id.trim().toLowerCase() : "";
  if (needs.includes("id") && !UUID.test(id)) {
    deps.error(`--id must be a request id as receive printed it (run \`list\` to see the open ones)\n${USAGE}`);
    return 2;
  }
  if (command === "show" && !deps.isTerminal()) {
    deps.error("Refusing to run: show prints what is held for a number, and its output must be read on screen, not saved. Run it in a terminal, without redirecting or piping it.");
    return 1;
  }

  const environment = productionEnvironment(deps.env, "access-request");
  if (!environment.ok) {
    deps.error(`Refusing to run: unsafe or incomplete environment settings:\n${environment.problems.map((p) => `  - ${p}`).join("\n")}`);
    return 1;
  }

  const connection = (deps.connect ?? connectToProduction)(environment.env);
  try {
    const admin = String(values.admin ?? "");
    switch (command) {
      case "receive": {
        const result = await connection.requests.receive({ admin, request: request as AccessRequestKind, rehearsal: values.rehearsal === true });
        if (!result.ok) return refused(deps, result.error, "Nothing was recorded.");
        deps.out(
          [
            `Recorded access request ${result.value.id} (${request}${values.rehearsal === true ? ", a rehearsal" : ""}), handled by ${admin}.`,
            `Answer it within ${ACCESS_REQUEST_LIMIT_DAYS} days; the weekly review flags it after ${ACCESS_REQUEST_FLAG_DAYS}.`,
            "Keep this id with the resident's contact where the request came in (never in the repository or the weekly notes): it is the only link between them and the audit trail, which holds no number.",
            "Next: the Admin calls the number back to verify control (docs/procedures/access-request.md).",
          ].join("\n"),
        );
        return 0;
      }
      case "list": {
        const open = await connection.requests.open();
        if (open.length === 0) {
          deps.out("No access request is open.");
          return 0;
        }
        const lines = [`Open access requests (${open.length}), oldest first:`];
        for (const r of open) {
          const flag = r.flagged ? `  FLAGGED: open more than ${ACCESS_REQUEST_FLAG_DAYS} days, answer by ${torontoTime(r.dueBy)}` : `  answer by ${torontoTime(r.dueBy)}`;
          lines.push(`  ${r.id}  ${r.request ?? "?"}${r.rehearsal ? " (rehearsal)" : ""}  received ${torontoTime(r.receivedAt)} by ${r.receivedByName ?? "an Admin"}, open ${days(r.daysOpen)}${flag}`);
        }
        deps.out(lines.join("\n"));
        return 0;
      }
      case "show": {
        const number = await deps.prompt("The resident's number (it is not saved): ");
        const result = await connection.requests.lookUp({ id, number });
        if (!result.ok) return refused(deps, result.error, "Nothing was shown.");
        deps.out(
          [
            ...heldRecordLines(result.value),
            "",
            "Shown on this screen only; nothing was saved or changed. Read it to the resident on the call, then clear the screen. Do not copy it anywhere.",
            `Then close the request: scripts/access-request close --id ${id} --admin <username> --outcome answered (or delete, if they ask).`,
          ].join("\n"),
        );
        return 0;
      }
      case "delete": {
        const number = await deps.prompt("The resident's number (it is not saved): ");
        const confirm = await deps.prompt("This deletes everything held for that number and cannot be undone. Type DELETE to go on: ");
        if (confirm.trim() !== "DELETE") {
          deps.error("Not confirmed: nothing was deleted and the request is still open.");
          return 1;
        }
        const result = await connection.requests.deleteForResident({ id, number, admin });
        if (!result.ok) return refused(deps, result.error, "Nothing was deleted and nothing was recorded.");
        const d = result.value;
        deps.out(
          [
            `Deleted everything held for the number: subscriber ${d.subscriber ? "deleted" : "none"}, pending sign-up ${d.pendingSignup ? "deleted" : "none"}, waiting replies ${d.inboundReplies}, waiting texts stopped ${d.skippedTexts}.`,
            "Texts already sent keep no link to the number. The keyed hashes of the number in rate_limit are deleted within 24 hours.",
            `The request is closed as deleted, ${days(d.daysOpen)} after it was received, with ${admin} as the Admin. Nothing more is sent to the number.`,
          ].join("\n"),
        );
        return 0;
      }
      case "close": {
        const result = await connection.requests.close({ id, admin, outcome: outcome as ClosingOutcome });
        if (!result.ok) return refused(deps, result.error, "Nothing was recorded.");
        deps.out(`Request ${id} closed as ${outcome}, ${days(result.value.daysOpen)} after it was received, with ${admin} as the Admin.`);
        return 0;
      }
    }
  } finally {
    await connection.close();
  }
}

function refused(deps: CliDeps, error: AdminRefusal | RequestRefusal | NumberRefusal, nothing: string): number {
  deps.error(`Refused: ${REFUSALS[error]} (${error}). ${nothing}`);
  return 1;
}

/** One line typed on the terminal. */
async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** Entry point used by the launcher, scripts/access-request. */
export function main(argv: string[]): Promise<number> {
  return runAccessRequest(argv, {
    env: process.env,
    out: (line) => console.log(line),
    error: (line) => console.error(line),
    prompt: ask,
    isTerminal: () => process.stdout.isTTY === true,
  });
}
