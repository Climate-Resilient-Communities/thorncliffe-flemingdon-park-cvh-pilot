// scripts/access-request without a database: its commands and arguments, its production-only guard, that the number is asked at a prompt and never taken as an
// argument, that `show` and `delete` refuse to run unless all three streams are a terminal, the deletion's check of the number and its confirmation, that an
// error is printed without its text (which can quote the number), and what it prints. The runs against the tables, the audit trail and the weekly review are
// in test/db/accessRequest.db.test.ts.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { onTerminal, runAccessRequest, type Connection } from "../scripts/subscriptions/access-request";
import type { AccessRequests, HeldRecord } from "../src/modules/subscriptions";

const ROOT = path.join(__dirname, "..");
const ID = "01928c3e-0000-7000-8000-00000000a001";

const PRODUCTION = {
  VERCEL_ENV: "production",
  SMS_MODE: "live",
  PUBLIC_BASE_URL: "https://project-6qcs4.vercel.app",
  DATABASE_URL: "postgres://cvh_app_login.ref:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres",
  SUPABASE_SECRET_KEY: "sb_secret_test_only",
  NEXT_PUBLIC_SUPABASE_URL: "https://example-project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
};

const HELD: HeldRecord = {
  maskedNumber: "+1 ••• ••• 0123",
  subscriber: {
    since: new Date("2026-10-01T14:00:00Z"),
    lang: "ur",
    neighbourhood: "Thorncliffe Park (TP)",
    groups: ["seniors"],
    consentVersion: "2026-10-02.1",
    startedBy: "web",
    retentionState: "active",
    places: [{ rsn: "9100011", address: "11 Sample Road", floor: "2" }],
    mutedTopics: ["heat"],
    prompt: null,
  },
  pending: null,
  replies: [],
  texts: [{ createdAt: new Date("2026-10-01T14:01:00Z"), kind: "transactional", purpose: "welcome", lang: "ur", state: "delivered", segments: 2, resendN: null, providerErrorCode: null }],
  hashes: [],
  checkins: { kind: "not_built" },
  unread: [],
};

function service(over: Partial<AccessRequests> = {}): AccessRequests {
  return {
    receive: vi.fn(async () => ({ ok: true as const, value: { id: ID } })),
    open: vi.fn(async () => []),
    lookUp: vi.fn(async () => ({ ok: true as const, value: HELD })),
    deleteForResident: vi.fn(async () => ({ ok: true as const, value: { subscriber: true, pendingSignup: false, inboundReplies: 0, skippedTexts: 1, daysOpen: 3 } })),
    close: vi.fn(async () => ({ ok: true as const, value: { daysOpen: 12 } })),
    ...over,
  };
}

async function run(argv: string[], options: { env?: Record<string, string>; requests?: AccessRequests; answers?: string[]; terminal?: boolean } = {}) {
  const out: string[] = [];
  const error: string[] = [];
  const questions: string[] = [];
  // `show` asks for the number; `delete` for the number, the number again and DELETE.
  const answers = [...(options.answers ?? ["+1 416 555 0123", "+1 416 555 0123", "DELETE"])];
  const requests = options.requests ?? service();
  const close = vi.fn(async () => {});
  const connect = vi.fn((): Connection => ({ requests, close }));
  const code = await runAccessRequest(argv, {
    env: options.env ?? PRODUCTION,
    out: (l) => out.push(l),
    error: (l) => error.push(l),
    prompt: async (question) => {
      questions.push(question);
      return answers.shift() ?? "";
    },
    isTerminal: () => options.terminal ?? true,
    connect,
  });
  return { code, out: out.join("\n"), error: error.join("\n"), questions, connect, close, requests };
}

describe("access-request", () => {
  it.each([
    ["development", { ...PRODUCTION, VERCEL_ENV: "", SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" }, /access-request runs only in production/],
    ["preview", { ...PRODUCTION, VERCEL_ENV: "preview", SMS_MODE: "log", PUBLIC_BASE_URL: "https://cvh-git-x.vercel.app" }, /access-request runs only in production/],
    ["production without the secret key", { ...PRODUCTION, SUPABASE_SECRET_KEY: "" }, /SUPABASE_SECRET_KEY: required in production/],
    ["production connected as another database role", { ...PRODUCTION, DATABASE_URL: "postgres://postgres.ref:secret@aws-0-ca-central-1.pooler.supabase.com:6543/postgres" }, /cvh_app_login/],
  ])("refuses to run in %s, before connecting to anything", async (_, env, problem) => {
    const result = await run(["list"], { env: env as Record<string, string> });

    expect(result.code).toBe(1);
    expect(result.error).toMatch(problem);
    expect(result.error).not.toContain("sb_secret");
    expect(result.connect).not.toHaveBeenCalled();
  });

  it("needs a command it knows and the options of that command, and refuses anything else before connecting", async () => {
    for (const [argv, message] of [
      [[], /^Missing the command/],
      [["look"], /^Not a command: give one of receive, list, show, delete, close/],
      [["receive", "--admin", "jdoe"], /^receive: missing --request/],
      [["receive", "--admin", "jdoe", "--request", "everything"], /^--request must be one of access, correction, deletion/],
      [["show", "--id", ID], /^show: missing --verified-control/],
      [["delete", "--id", ID, "--verified-control"], /^delete: missing --admin/],
      [["close", "--id", ID, "--admin", "jdoe"], /^close: missing --outcome/],
      [["close", "--id", ID, "--admin", "jdoe", "--outcome", "deleted"], /^--outcome must be one of answered, not_verified, withdrawn \(a deletion closes its request itself\)/],
      [["close", "--id", "not-an-id", "--admin", "jdoe", "--outcome", "answered"], /^--id must be a request id as receive printed it/],
      [["list", "--admin", "jdoe"], /^list does not take --admin/],
      [["show", "--id", ID, "--verified-control", "--rehearsal"], /^show does not take --rehearsal/],
      [["show", "--id", ID, "--verified-control", "--number", "4165550123"], /Unknown option '--number'/],
    ] as [string[], RegExp][]) {
      const result = await run(argv);
      expect(result.code, argv.join(" ")).toBe(2);
      expect(result.error, argv.join(" ")).toMatch(message);
      expect(result.error).toContain("Usage: ");
      expect(result.connect).not.toHaveBeenCalled();
    }
  });

  it("never takes the number as an argument, and never prints back one given that way", async () => {
    const result = await run(["show", "+14165550123", "--id", ID, "--verified-control"]);

    expect(result.code).toBe(2);
    expect(result.error).toMatch(/^Not a command/);
    expect(result.error).not.toMatch(/555.?0123/);
    expect(result.connect).not.toHaveBeenCalled();
  });

  it("says why a lookup or a deletion needs verified control, and what to do without it", async () => {
    const { error } = await run(["delete", "--id", ID, "--admin", "jdoe"]);

    expect(error).toMatch(/--verified-control confirms that the Admin has verified control of the number \(a call back to it, or the one-time phrase texted from it\)/);
    expect(error).toMatch(/close the request as not_verified instead/);
  });

  it("explains every command, the prompt and the audit trail in the usage text", async () => {
    const { error } = await run([]);

    expect(error).toMatch(/docs\/procedures\/access-request\.md/);
    expect(error).toMatch(/read-only transaction, saves nothing and refuses to\s+print into a file or a pipe/);
    expect(error).toMatch(/cannot be\s+undone \(the pilot keeps no\s+backups\)/);
    expect(error).toMatch(/asks for the number again and for DELETE/);
    expect(error).toMatch(/show and delete run on a terminal only,\s+with nothing redirected or piped/);
    expect(error).toMatch(/never given as an argument, so it is not kept in the shell's history/);
    expect(error).toMatch(/with its dates, its outcome and the Admin, never the number/);
  });

  it("records a request with its Admin and kind, and says what to keep and what comes next", async () => {
    const result = await run(["receive", "--admin", "jdoe", "--request", "deletion", "--rehearsal"]);

    expect(result.code).toBe(0);
    expect(result.requests.receive).toHaveBeenCalledWith({ admin: "jdoe", request: "deletion", rehearsal: true });
    expect(result.out).toMatch(new RegExp(`^Recorded access request ${ID} \\(deletion, a rehearsal\\), handled by jdoe\\.`));
    expect(result.out).toMatch(/within 30 days; the weekly review flags it after 25/);
    expect(result.out).toMatch(/never in the repository or the weekly notes/);
    expect(result.questions).toEqual([]);
    expect(result.close).toHaveBeenCalledTimes(1);
  });

  it("lists the open requests with their days open, flagging those past 25 days", async () => {
    const received = new Date("2026-09-01T13:00:00Z");
    const open = vi.fn(async () => [
      { id: ID, request: "access" as const, receivedAt: received, receivedBy: "s1", receivedByName: "Priya Sharma", rehearsal: false, daysOpen: 27, flagged: true, dueBy: new Date(received.getTime() + 30 * 86_400_000) },
    ]);
    const result = await run(["list"], { requests: service({ open }) });

    expect(result.code).toBe(0);
    expect(result.out).toContain(`${ID}  access  received 2026-09-01 09:00 by Priya Sharma, open 27 days  FLAGGED: open more than 25 days, answer by 2026-10-01 09:00`);
    expect((await run(["list"])).out).toBe("No access request is open.");
  });

  it("asks for the number at a prompt and shows what is held, never the words of a text, and says nothing was saved", async () => {
    const result = await run(["show", "--id", ID.toUpperCase(), "--verified-control"]);

    expect(result.code).toBe(0);
    expect(result.questions).toEqual(["The resident's number (it is not saved): "]);
    expect(result.requests.lookUp).toHaveBeenCalledWith({ id: ID, number: "+1 416 555 0123" });
    expect(result.out).toMatch(/^What the CVH holds for \+1 ••• ••• 0123:/);
    expect(result.out).toContain("    11 Sample Road (register number 9100011), floor 2");
    expect(result.out).toContain("  2026-10-01 10:01  transactional text (welcome) in ur, 2 segments, delivered");
    expect(result.out).toMatch(/Shown on this screen only; nothing was saved or changed/);
    expect(result.out).not.toMatch(/555.?0123/);
  });

  it.each([
    ["show", ["show", "--id", ID, "--verified-control"]],
    ["delete", ["delete", "--id", ID, "--admin", "jdoe", "--verified-control"]],
  ])("refuses to %s off a terminal (a file or a pipe on any stream), before asking for the number or connecting", async (command, argv) => {
    const result = await run(argv, { terminal: false });

    expect(result.code).toBe(1);
    expect(result.error).toBe(
      `Refusing to run: ${command} asks for a resident's number and prints what is held for it, which must be typed and read on screen, never saved. Run it in a terminal, without redirecting or piping its input, its output or its errors.`,
    );
    expect(result.questions).toEqual([]);
    expect(result.connect).not.toHaveBeenCalled();
  });

  it("counts as a terminal only when what is typed, what is printed and the prompts with their echo all are one", () => {
    const tty = { isTTY: true };
    expect(onTerminal({ stdin: tty, stdout: tty, stderr: tty })).toBe(true);
    // `show ... 2>file`: readline echoes the typed number to stderr, so a redirected stderr would save it.
    expect(onTerminal({ stdin: tty, stdout: tty, stderr: { isTTY: false } })).toBe(false);
    expect(onTerminal({ stdin: tty, stdout: {}, stderr: tty })).toBe(false);
    expect(onTerminal({ stdin: { isTTY: undefined }, stdout: tty, stderr: tty })).toBe(false);
  });

  it("deletes only after showing what is held for the masked number, the number typed again and DELETE, and reports counts and the closed request", async () => {
    const argv = ["delete", "--id", ID, "--admin", "jdoe", "--verified-control"];
    const no = await run(argv, { answers: ["4165550123", "(416) 555-0123", "yes"] });
    expect(no.code).toBe(1);
    expect(no.error).toMatch(/Not confirmed: nothing was deleted and the request is still open/);
    expect(no.requests.deleteForResident).not.toHaveBeenCalled();

    const yes = await run(argv, { answers: ["4165550123", "416 555 0123", "DELETE"] });
    expect(yes.code).toBe(0);
    expect(yes.questions).toEqual([
      "The resident's number (it is not saved): ",
      "Check the last four digits against the number the Admin verified, then type the number again: ",
      "This deletes everything held for that number and cannot be undone. Type DELETE to go on: ",
    ]);
    expect(yes.requests.lookUp).toHaveBeenCalledWith({ id: ID, number: "4165550123" });
    expect(yes.out).toMatch(/^For \+1 ••• ••• 0123 the CVH holds a subscriber since 2026-10-01 10:00, no pending sign-up, 0 waiting replies and 1 text on record\./);
    expect(yes.requests.deleteForResident).toHaveBeenCalledWith({ id: ID, number: "4165550123", admin: "jdoe" });
    expect(yes.out).toMatch(/subscriber deleted, pending sign-up none, waiting replies 0, waiting texts stopped 1/);
    expect(yes.out).toMatch(/closed as deleted, 3 days after it was received, with jdoe as the Admin/);
    expect(yes.out).not.toMatch(/555.?0123/);
  });

  it("deletes nothing when the number typed again differs, or the lookup before it is refused", async () => {
    const argv = ["delete", "--id", ID, "--admin", "jdoe", "--verified-control"];
    const typo = await run(argv, { answers: ["4165550123", "4165550132", "DELETE"] });
    expect(typo.code).toBe(1);
    expect(typo.error).toBe("The two numbers differ: nothing was deleted and the request is still open.");
    expect(typo.questions).toHaveLength(2);
    expect(typo.requests.deleteForResident).not.toHaveBeenCalled();

    const closed = await run(argv, { requests: service({ lookUp: vi.fn(async () => ({ ok: false as const, error: "closed" as const })) }) });
    expect(closed.code).toBe(1);
    expect(closed.error).toBe("Refused: that access request is already closed (closed). Nothing was deleted and nothing was recorded.");
    expect(closed.questions).toHaveLength(1);
    expect(closed.requests.deleteForResident).not.toHaveBeenCalled();
  });

  it("closes a request with its outcome", async () => {
    const result = await run(["close", "--id", ID, "--admin", "jdoe", "--outcome", "not_verified"]);

    expect(result.code).toBe(0);
    expect(result.requests.close).toHaveBeenCalledWith({ id: ID, admin: "jdoe", outcome: "not_verified" });
    expect(result.out).toBe(`Request ${ID} closed as not_verified, 12 days after it was received, with jdoe as the Admin.`);
  });

  it.each([
    ["receive", ["receive", "--admin", "coord", "--request", "access"], { receive: vi.fn(async () => ({ ok: false as const, error: "not_admin" as const })) }, /^Refused: that account is not an Admin.*\(not_admin\)\. Nothing was recorded\./],
    ["show", ["show", "--id", ID, "--verified-control"], { lookUp: vi.fn(async () => ({ ok: false as const, error: "closed" as const })) }, /^Refused: that access request is already closed \(closed\)\. Nothing was shown\./],
    ["show", ["show", "--id", ID, "--verified-control"], { lookUp: vi.fn(async () => ({ ok: false as const, error: "not_canadian" as const })) }, /^Refused: that is not a Canadian number/],
    ["delete", ["delete", "--id", ID, "--admin", "jdoe", "--verified-control"], { deleteForResident: vi.fn(async () => ({ ok: false as const, error: "not_found" as const })) }, /^Refused: no access request has that id.*Nothing was deleted and nothing was recorded\./],
    [
      "delete",
      ["delete", "--id", ID, "--admin", "jdoe", "--verified-control"],
      { deleteForResident: vi.fn(async () => ({ ok: false as const, error: "checkins_not_wired" as const })) },
      /^Refused: check-ins exist \(a checkin table\) and this script cannot delete them yet: ask IT to wire E08's check-in deletion into scripts\/access-request \(checkins_not_wired\)\. Nothing was deleted/,
    ],
    ["close", ["close", "--id", ID, "--admin", "gone", "--outcome", "answered"], { close: vi.fn(async () => ({ ok: false as const, error: "admin_not_active" as const })) }, /^Refused: that Admin's account is suspended or removed/],
  ] as [string, string[], Partial<AccessRequests>, RegExp][])("refuses %s with the reason and exit 1", async (command, argv, over, message) => {
    const result = await run(argv, { requests: service(over) });

    expect(result.code).toBe(1);
    // A deletion shows what it would delete (the masked number) before it is refused.
    expect(result.out).toBe(command === "delete" ? "For +1 ••• ••• 0123 the CVH holds a subscriber since 2026-10-01 10:00, no pending sign-up, 0 waiting replies and 1 text on record." : "");
    expect(result.error).toMatch(message);
    expect(result.close).toHaveBeenCalledTimes(1);
  });

  it("prints an error by its kind and SQLSTATE only, never its text, which can quote the number, and closes its connection", async () => {
    // As Drizzle reports a failed statement: its parameters, the number among them, in the message, and the driver's error as the cause.
    class DrizzleQueryError extends Error {
      override name = "DrizzleQueryError";
    }
    const failure = new DrizzleQueryError("Failed query: select pg_advisory_xact_lock(hashtextextended($1, $2))\nparams: pending_signup:+14165550123,7302118449", {
      cause: Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" }),
    });
    for (const [argv, over] of [
      [["delete", "--id", ID, "--admin", "jdoe", "--verified-control"], { deleteForResident: async () => Promise.reject(failure) }],
      [["show", "--id", ID, "--verified-control"], { lookUp: async () => Promise.reject(failure) }],
      [["list"], { open: async () => Promise.reject(new Error("connect ECONNREFUSED")) }],
    ] as [string[], Partial<AccessRequests>][]) {
      const result = await run(argv, { requests: service(over) });

      expect(result.code, argv[0]).toBe(1);
      expect(result.error, argv[0]).toMatch(/^Failed: (DrizzleQueryError \(SQLSTATE 55P03\)|Error)\. Its text is not printed, since it can hold the number\. Run `list` to see where the request stands\.$/);
      expect(`${result.out}\n${result.error}`).not.toMatch(/555.?0123|params|ECONNREFUSED/);
      expect(result.close).toHaveBeenCalledTimes(1);
    }
  });

  it("runs through its launcher, which bundles the script", () => {
    const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "access-request"), "list"], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, NODE_ENV: "test", SMS_MODE: "log", PUBLIC_BASE_URL: "http://localhost:3000" },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/access-request runs only in production/);
  }, 60_000);
});
