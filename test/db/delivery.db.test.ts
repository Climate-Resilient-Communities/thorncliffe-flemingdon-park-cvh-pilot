// The outbox against a real database (S06.01): the `delivery` table and its lock-down, the state transition table checked for
// every pair of states against domain/deliveryState.ts (by direct SQL with the app's credentials, cvh_app_login), the terminal
// states, the idempotent insert under concurrency, the rules for creating an alert, a transactional and a campaign delivery,
// the forgetting of a deleted recipient, and the ContactResolver's hand-off rule for an `inbound_reply` recipient.
// "Direct SQL" is the app's role with no use case in front, which is all the app's code could ever do. The provider is never
// called: this story sends nothing.
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "../../scripts/db/migrate.mjs";
import {
  CREATING_MODULES,
  DELIVERY_STATES,
  RECIPIENT_KINDS,
  TERMINAL_STATES,
  TRANSACTIONAL_PURPOSES,
  TRANSITION_TABLE,
  canTransition,
  createContactResolver,
  createDeliveryQueue,
  looksLikePhoneNumber,
  maskForLog,
  purposeRule,
  type DeliveryState,
  type MessagingLog,
  type RecipientNumberSource,
} from "../../src/modules/messaging";
import { createDb, type Db } from "../../src/platform/db";
import { sql as drizzleSql } from "drizzle-orm";
import { deliveryFixtures, FAKE_NUMBER, FAKE_SID, OUTCOME_AFTER_HAND_OFF, transitionStatement, DEFAULT_BODIES, type SeededEntry, type Tx } from "./deliveryFixtures";
import { connect, serverUrl } from "./helpers";

let owner: ReturnType<typeof connect>;
let appUrl: string;
let appSql: postgres.Sql;
let app: Db;
const fixtures = () => deliveryFixtures(owner);
let fx: ReturnType<typeof fixtures>;
const scratchTables: string[] = [];

beforeAll(async () => {
  owner = connect(serverUrl());
  await migrate({ sql: owner, log: () => {} });
  const password = randomBytes(18).toString("hex");
  await owner.unsafe(`alter role cvh_app_login password '${password}'`);
  const url = new URL(serverUrl());
  url.username = "cvh_app_login";
  url.password = password;
  appUrl = url.href;
  appSql = postgres(appUrl, { max: 6, onnotice: () => {} });
  app = createDb(appUrl);
  fx = fixtures();
  // Open the pool's connections now, so the concurrent inserts below really overlap.
  await Promise.all(Array.from({ length: 6 }, () => app.$client`select pg_sleep(0.1)`));
});

afterAll(async () => {
  await fx.cleanup();
  for (const table of scratchTables) await owner.unsafe(`drop table if exists ${table}`);
  await app.$client.end({ timeout: 5 });
  await appSql.end({ timeout: 5 });
  await owner.unsafe("alter role cvh_app_login password null");
  await owner.end({ timeout: 5 });
});

beforeEach(async () => {
  await fx.cleanup();
});

// --- helpers --------------------------------------------------------------------------------------------

/** A value the insert takes as SQL (the database's clock), not as a parameter. */
class Raw {
  constructor(readonly text: string) {}
}
const raw = (text: string) => new Raw(text);
type Row = Record<string, unknown>;

/** `insert into delivery` with the given columns, returning the row. */
async function insertRow(tx: Tx | postgres.Sql, row: Row) {
  const columns = Object.keys(row);
  const params: unknown[] = [];
  const values = columns.map((column) => {
    const value = row[column];
    if (value instanceof Raw) return value.text;
    params.push(value);
    return `$${params.length}`;
  });
  const [inserted] = await tx.unsafe(`insert into delivery (${columns.join(", ")}) values (${values.join(", ")}) returning *`, params as never[]);
  return inserted;
}

/** A transactional row that passes every rule, with the key rebuilt from its parts unless the key is given. */
function transactionalRow(over: Row = {}): Row {
  const subject = randomUUID();
  const merged: Row = {
    id: randomUUID(),
    kind: "transactional",
    recipient_kind: "subscriber",
    recipient_id: randomUUID(),
    created_by_module: "subscriptions",
    purpose: "menu_reply",
    lang: "en",
    body: "Reply 1 to change your building.",
    segments: 1,
    cost_estimate_cents: 2,
    send_by: raw("now() + interval '10 minutes'"),
    ...over,
  };
  merged.idempotency_key ??= `transactional:${subject}:${merged.purpose}:${randomUUID()}`;
  return merged;
}

/** An alert row for the entry, in its frozen body for `lang`, with the key rebuilt unless given. */
function alertRow(entry: SeededEntry, over: Row = {}): Row {
  const lang = (over.lang as string | undefined) ?? "en";
  const frozen = entry.bodies[lang] ?? DEFAULT_BODIES.en;
  const recipient = (over.recipient_id as string | undefined) ?? randomUUID();
  const merged: Row = {
    id: randomUUID(),
    kind: "alert",
    recipient_kind: "subscriber",
    recipient_id: recipient,
    entry_id: entry.entryId,
    created_by_module: "alerting",
    lang,
    body: frozen.body,
    segments: frozen.segments,
    cost_estimate_cents: 4,
    ...over,
  };
  merged.idempotency_key ??= `${entry.entryId}:${recipient}:sms`;
  return merged;
}

/** One transaction as the app's role, optionally marked as the approval of `entryId`. */
async function asApp<T>(run: (tx: Tx) => PromiseLike<T>, approving?: string): Promise<T> {
  return appSql.begin(async (tx) => {
    if (approving) await tx`select set_config('cvh.approval_entry_id', ${approving}, true)`;
    return await run(tx);
  }) as Promise<T>;
}

/** A row without what forgetting a recipient changes (its link, its key and the update time). */
const withoutLink = (row: Row) => Object.fromEntries(Object.entries(row).filter(([column]) => !["recipient_id", "idempotency_key", "updated_at"].includes(column)));

const stateOf = async (id: string) => (await owner`select state from delivery where id = ${id}`)[0].state as DeliveryState;
const rowOf = async (id: string) => (await owner`select * from delivery where id = ${id}`)[0];
const count = async () => (await owner`select count(*)::int as n from delivery`)[0].n as number;

/** The legal path from a new (queued) row to each state, every step taken as the app. */
const PATH: Record<DeliveryState, DeliveryState[]> = {
  queued: [],
  claimed: ["claimed"],
  submitted: ["claimed", "submitted"],
  unknown: ["claimed", "unknown"],
  delivered: ["claimed", "delivered"],
  undelivered: ["claimed", "undelivered"],
  failed: ["claimed", "failed"],
  cancelled: ["cancelled"],
  skipped: ["skipped"],
  skipped_env: ["claimed", "skipped_env"],
};

/**
 * A transactional row in `state`, reached only by legal transitions; `handedOff` records the hand-off while it is claimed (and a
 * row that goes on to an outcome of the provider is always handed off first: the database allows no outcome without it).
 */
async function rowIn(state: DeliveryState, options: { handedOff?: boolean; over?: Row } = {}): Promise<string> {
  const row = await asApp((tx) => insertRow(tx, transactionalRow(options.over)));
  const path = PATH[state];
  for (const [index, step] of path.entries()) {
    await asApp((tx) => transitionStatement(tx, row.id, step));
    const next = path[index + 1];
    if (step === "claimed" && (options.handedOff || (next !== undefined && OUTCOME_AFTER_HAND_OFF.includes(next)))) await handOff(row.id);
  }
  return row.id;
}

/** The hand-off, recorded while the row is claimed (the database times it). */
const handOff = (id: string) => asApp((tx) => tx`update delivery set handed_off_at = now() where id = ${id}`);

/** The error's message and those of its causes: Drizzle wraps the database's own error, which holds the trigger's words. */
function messageOf(error: unknown): string {
  const messages: string[] = [];
  for (let current = error, depth = 0; current && depth < 5; depth += 1) {
    messages.push(current instanceof Error ? current.message : String(current));
    current = (current as { cause?: unknown }).cause;
  }
  return messages.join(" | ");
}
async function refusal(run: () => PromiseLike<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return messageOf(error);
  }
  throw new Error("expected the database to refuse the statement");
}

// --- the table ----------------------------------------------------------------------------------------

describe("the delivery table", () => {
  it("has exactly the fields of the definitions and no column that could hold a phone number", async () => {
    const columns = await owner`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'delivery' order by column_name`;
    expect(columns.map((c) => c.column_name)).toEqual(
      [
        "attempts", "body", "callback_ref", "campaign_id", "channel", "claim_rank", "claim_token", "claimed_at", "claimed_by", "completed_at", "cost_estimate_cents",
        "created_at", "created_by_module", "due_at", "entry_id", "handed_off_at", "id", "idempotency_key", "kind", "lang", "provider_error_code",
        "provider_message_id", "purpose", "recipient_id", "recipient_kind", "segments", "send_by", "state", "submitted_at", "updated_at",
      ].sort(),
    );
    for (const { column_name: name } of columns) expect(name, name).not.toMatch(/phone|msisdn|mobile|^to$|^to_|number$|e164/);
  });

  it("has a unique idempotency_key and a unique callback_ref", async () => {
    const unique = await owner`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.delivery'::regclass and contype = 'u' order by 1`;
    expect(unique.map((u) => u.def)).toEqual(["UNIQUE (callback_ref)", "UNIQUE (idempotency_key)"]);
    const row = transactionalRow();
    await asApp((tx) => insertRow(tx, row));
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ idempotency_key: row.idempotency_key }))))).toMatch(/delivery_idempotency_key_unique/);
  });

  it("makes the callback reference itself: a random UUID the caller cannot choose", async () => {
    const mine = randomUUID();
    const first = await asApp((tx) => insertRow(tx, transactionalRow({ callback_ref: mine })));
    const second = await asApp((tx) => insertRow(tx, transactionalRow()));
    for (const row of [first, second]) expect(row.callback_ref).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(first.callback_ref).not.toBe(mine);
    expect(first.callback_ref).not.toBe(second.callback_ref);
  });

  it("times a row by the database's clock, whatever the caller sent, and starts it queued", async () => {
    const row = await asApp((tx) => insertRow(tx, transactionalRow({ created_at: new Date("2020-01-01T00:00:00Z"), updated_at: new Date("2020-01-01T00:00:00Z") })));
    expect(Math.abs(row.created_at.getTime() - Date.now())).toBeLessThan(60_000);
    expect(row.state).toBe("queued");
    expect(row.attempts).toBe(0);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ state: "claimed", claimed_at: new Date(), claimed_by: "w", claim_token: randomUUID() }))))).toMatch(/queued/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ attempts: 1 }))))).toMatch(/queued, with no attempts/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ provider_message_id: FAKE_SID }))))).toMatch(/no provider answer/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ recipient_id: null }))))).toMatch(/names its recipient/);
  });

  it("has row level security on and nothing for anon, authenticated, service_role or PUBLIC, and lets the app read and add but never delete", async () => {
    const [info] = await owner`select relrowsecurity as rls from pg_class where oid = 'public.delivery'::regclass`;
    expect(info.rls).toBe(true);
    const policies = await owner`select policyname, roles::text[] as roles, cmd from pg_policies where schemaname = 'public' and tablename = 'delivery' order by cmd`;
    expect(policies.map((p) => [p.cmd, p.roles])).toEqual([["INSERT", ["cvh_app"]], ["SELECT", ["cvh_app"]], ["UPDATE", ["cvh_app"]]]);
    for (const role of ["anon", "authenticated", "service_role", "public"]) {
      const [privilege] = await owner.unsafe(`select has_table_privilege('${role}', 'public.delivery', 'select, insert, update, delete, truncate, references, trigger') as any_privilege`);
      expect(privilege.any_privilege, role).toBe(false);
      const [column] = await owner.unsafe(`select has_column_privilege('${role}', 'public.delivery', 'body', 'select, insert, update') as any_privilege`);
      expect(column.any_privilege, `${role} (column)`).toBe(false);
    }
    const can = async (privilege: string) => (await owner.unsafe(`select has_table_privilege('cvh_app', 'public.delivery', '${privilege}') as ok`))[0].ok;
    expect(await can("select")).toBe(true);
    expect(await can("insert")).toBe(true);
    expect(await can("delete")).toBe(false);
    expect(await can("truncate")).toBe(false);
    const row = await asApp((tx) => insertRow(tx, transactionalRow()));
    expect(await refusal(() => asApp((tx) => tx`delete from delivery where id = ${row.id}`))).toMatch(/permission denied/);
    expect(await refusal(() => appSql.unsafe("truncate delivery"))).toMatch(/permission denied/);
  });

  it("lets the app change only what the dispatcher and the callbacks change", async () => {
    const columns = await owner`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'delivery' order by column_name`;
    const changeable: string[] = [];
    for (const { column_name: name } of columns) {
      const [privilege] = await owner.unsafe(`select has_column_privilege('cvh_app', 'public.delivery', '${name}', 'update') as ok`);
      if (privilege.ok) changeable.push(name);
    }
    expect(changeable).toEqual(["attempts", "claim_token", "claimed_by", "due_at", "handed_off_at", "provider_error_code", "provider_message_id", "state"]);
    const id = await rowIn("queued");
    for (const column of ["recipient_id", "idempotency_key", "body", "callback_ref", "claimed_at", "completed_at", "created_at"]) {
      expect(await refusal(() => asApp((tx) => tx.unsafe(`update delivery set ${column} = ${column} where id = '${id}'`))), column).toMatch(/permission denied/);
    }
  });

  it("lets the app lock rows to claim them (FOR UPDATE SKIP LOCKED), as the dispatcher does", async () => {
    const id = await rowIn("queued");
    const taken = await asApp(async (tx) => {
      const first = await tx`select id from delivery where state = 'queued' order by created_at for update skip locked limit 1`;
      // A second connection finds the locked row unavailable and skips it.
      const second = await appSql.begin((other) => other`select id from delivery where id = ${id} for update skip locked`);
      return { first, second };
    });
    expect(taken.first.map((row) => row.id)).toEqual([id]);
    expect(taken.second).toHaveLength(0);
  });

  it("refuses what the table does not hold", async () => {
    const cases: [string, Row][] = [
      ["an unknown kind", { kind: "marketing" }],
      ["an unknown recipient kind", { recipient_kind: "stranger" }],
      ["an unknown module", { created_by_module: "directory" }],
      ["a channel other than sms", { channel: "email" }],
      ["an unknown language", { lang: "xx" }],
      ["an empty body", { body: "   " }],
      ["a body of more than 1600 characters", { body: "a".repeat(1601) }],
      ["no segments", { segments: 0 }],
      ["more than 24 segments", { segments: 25 }],
      ["a negative cost", { cost_estimate_cents: -1 }],
    ];
    // The table's checks, or the insert trigger's words where it speaks first (a kind, a recipient kind or a module it does not know).
    for (const [name, over] of cases) {
      await expect(refusal(() => asApp((tx) => insertRow(tx, transactionalRow(over)))), name).resolves.toMatch(/violates check constraint|kind:subject:purpose:nonce|never texted to|not on the allow-list/);
    }
  });
});

// --- the state transition table ---------------------------------------------------------------------

describe("the state transitions", () => {
  it("allow exactly the table's changes, for every ordered pair of states (direct SQL as the app)", async () => {
    const outcomes: string[] = [];
    for (const from of DELIVERY_STATES) {
      for (const to of DELIVERY_STATES) {
        if (from === to) continue;
        // A claimed row that goes on to the provider's answer was handed to the provider first (cancelling or skipping it needs it not to be).
        const id = await rowIn(from, { handedOff: from === "claimed" && OUTCOME_AFTER_HAND_OFF.includes(to) });
        const attempt = asApp((tx) => transitionStatement(tx, id, to));
        if (canTransition(from, to)) {
          await expect(attempt, `${from} -> ${to}`).resolves.toBeDefined();
          expect(await stateOf(id), `${from} -> ${to}`).toBe(to);
          outcomes.push(`${from}>${to} allowed`);
        } else {
          const message = await refusal(() => attempt);
          expect(message, `${from} -> ${to}`).toMatch(/never changes|not an allowed transition/);
          expect(await stateOf(id), `${from} -> ${to}`).toBe(from);
          outcomes.push(`${from}>${to} refused`);
        }
      }
    }
    // 10 states: 90 ordered pairs. The table's rows expand to 20 changes, every other pair is refused.
    expect(outcomes).toHaveLength(90);
    expect(outcomes.filter((o) => o.endsWith("allowed"))).toHaveLength(20);
    const fromTable = TRANSITION_TABLE.flatMap((row) => row.from.flatMap((from) => row.to.map((to) => `${from}>${to}`)));
    expect(new Set(fromTable).size).toBe(20);
  });

  it("refuse the changes the story names: delivered to failed, and cancelled to queued", async () => {
    const delivered = await rowIn("delivered");
    expect(await refusal(() => asApp((tx) => tx`update delivery set state = 'failed' where id = ${delivered}`))).toMatch(/delivered delivery never changes/);
    const cancelled = await rowIn("cancelled");
    expect(await refusal(() => asApp((tx) => tx`update delivery set state = 'queued' where id = ${cancelled}`))).toMatch(/cancelled delivery never changes/);
    expect(await stateOf(delivered)).toBe("delivered");
    expect(await stateOf(cancelled)).toBe("cancelled");
  });

  it("never change a terminal row in any way, for the app or for the owner", async () => {
    for (const state of TERMINAL_STATES) {
      const id = await rowIn(state);
      const before = await rowOf(id);
      const statements = [
        "update delivery set due_at = now() + interval '1 hour'",
        "update delivery set attempts = attempts + 1",
        "update delivery set provider_error_code = 30003",
        "update delivery set handed_off_at = now()",
        "update delivery set claimed_by = 'other'",
        "update delivery set state = state",
      ];
      for (const statement of statements) {
        expect(await refusal(() => asApp((tx) => tx.unsafe(`${statement} where id = '${id}'`))), `${state}: ${statement}`).toMatch(/never changes/);
      }
      expect(await refusal(() => owner.unsafe(`update delivery set body = 'edited' where id = '${id}'`)), `${state} (owner, body)`).toMatch(/frozen at creation/);
      expect(await refusal(() => owner.unsafe(`update delivery set provider_message_id = '${FAKE_SID.replace("0", "1")}' where id = '${id}'`)), `${state} (owner)`).toMatch(/never changes|never change/);
      expect(await rowOf(id)).toEqual(before);
    }
  });

  it("freeze what was fixed at creation: the body, segments, cost, language, key, recipient and callback reference", async () => {
    const id = await rowIn("queued");
    const frozen: [string, string][] = [
      ["body", "'a different text'"],
      ["segments", "3"],
      ["cost_estimate_cents", "99"],
      ["lang", "'fr'"],
      ["idempotency_key", "'transactional:x:menu_reply:y'"],
      ["recipient_kind", "'staff'"],
      ["recipient_id", `'${randomUUID()}'`],
      ["callback_ref", `'${randomUUID()}'`],
      ["send_by", "now() + interval '5 minutes'"],
      ["purpose", "'welcome'"],
      ["created_by_module", "'ops'"],
    ];
    for (const [column, value] of frozen) {
      expect(await refusal(() => owner.unsafe(`update delivery set ${column} = ${value} where id = '${id}'`)), column).toMatch(/frozen at creation|never change|recipient/);
    }
    expect((await rowOf(id)).body).toBe("Reply 1 to change your building.");
  });

  it("keep the provider's id once it is known, and only let attempts go up", async () => {
    const id = await rowIn("claimed");
    await asApp((tx) => tx`update delivery set provider_message_id = ${FAKE_SID}, attempts = 1 where id = ${id}`);
    await asApp((tx) => tx`update delivery set provider_message_id = ${FAKE_SID} where id = ${id}`);
    expect(await refusal(() => asApp((tx) => tx`update delivery set provider_message_id = ${`SM${"f".repeat(32)}`} where id = ${id}`))).toMatch(/provider id, once known, never changes/);
    expect(await refusal(() => asApp((tx) => tx`update delivery set attempts = 0 where id = ${id}`))).toMatch(/attempts only go up/);
    expect(await refusal(() => asApp((tx) => tx`update delivery set attempts = 4 where id = ${id}`))).toMatch(/delivery_attempts_valid/);
  });

  it("make a claim name its worker and lease, time it by the database, and clear it when the row returns to the queue", async () => {
    const id = await rowIn("queued");
    expect(await refusal(() => asApp((tx) => tx`update delivery set state = 'claimed' where id = ${id}`))).toMatch(/delivery_claim_coherent/);
    expect(await refusal(() => asApp((tx) => tx`update delivery set state = 'claimed', claimed_by = 'w1' where id = ${id}`))).toMatch(/delivery_claim_coherent/);
    const token = randomUUID();
    await asApp((tx) => tx`update delivery set state = 'claimed', claimed_by = 'w1', claim_token = ${token} where id = ${id}`);
    const claimed = await rowOf(id);
    expect(claimed.claimed_by).toBe("w1");
    expect(claimed.claim_token).toBe(token);
    expect(Math.abs(claimed.claimed_at.getTime() - Date.now())).toBeLessThan(60_000);
    // The claim does not move while the row stays claimed, and only a claim or a return to the queue changes it.
    expect(await refusal(() => asApp((tx) => tx`update delivery set claimed_by = 'w2' where id = ${id}`))).toMatch(/claim changes only with the state/);
    expect(await refusal(() => asApp((tx) => tx`update delivery set state = 'failed', claimed_by = 'w2' where id = ${id}`))).toMatch(/only a claim or a return/);
    await asApp((tx) => tx`update delivery set handed_off_at = now() where id = ${id}`);
    await asApp((tx) => tx`update delivery set state = 'queued', attempts = 1, due_at = now() + interval '30 seconds' where id = ${id}`);
    const requeued = await rowOf(id);
    expect([requeued.state, requeued.claimed_at, requeued.claimed_by, requeued.claim_token, requeued.handed_off_at, requeued.attempts]).toEqual(["queued", null, null, null, null, 1]);
  });

  it("record the hand-off once, while the row is claimed", async () => {
    const queued = await rowIn("queued");
    expect(await refusal(() => asApp((tx) => tx`update delivery set handed_off_at = now() where id = ${queued}`))).toMatch(/recorded once, while the row is claimed/);
    const claimed = await rowIn("claimed");
    await asApp((tx) => tx`update delivery set handed_off_at = '2020-01-01T00:00:00Z' where id = ${claimed}`);
    const handedOff = (await rowOf(claimed)).handed_off_at as Date;
    expect(Math.abs(handedOff.getTime() - Date.now())).toBeLessThan(60_000);
    expect(await refusal(() => asApp((tx) => tx`update delivery set handed_off_at = now() where id = ${claimed}`))).toMatch(/recorded once/);
    expect(await refusal(() => asApp((tx) => tx`update delivery set handed_off_at = null where id = ${claimed}`))).toMatch(/recorded once/);
    // A change of state never records it.
    const other = await rowIn("claimed");
    expect(await refusal(() => asApp((tx) => tx`update delivery set state = 'failed', handed_off_at = now() where id = ${other}`))).toMatch(/recorded on its own/);
  });

  it("never cancel or skip a text already handed to the provider, but stop one that was not", async () => {
    for (const to of ["cancelled", "skipped"] as const) {
      const inFlight = await rowIn("claimed", { handedOff: true });
      expect(await refusal(() => asApp((tx) => transitionStatement(tx, inFlight, to))), to).toMatch(/already handed to the provider/);
      expect(await stateOf(inFlight)).toBe("claimed");
      const notYet = await rowIn("claimed");
      await asApp((tx) => transitionStatement(tx, notYet, to));
      expect(await stateOf(notYet)).toBe(to);
      const queued = await rowIn("queued");
      await asApp((tx) => transitionStatement(tx, queued, to));
      expect(await stateOf(queued)).toBe(to);
    }
    // A handed-off row can still go on: back to the queue (not accepted), or to what the provider answered.
    for (const to of ["queued", "submitted", "failed", "unknown", "delivered", "undelivered", "skipped_env"] as const) {
      const inFlight = await rowIn("claimed", { handedOff: true });
      await asApp((tx) => transitionStatement(tx, inFlight, to));
      expect(await stateOf(inFlight), to).toBe(to);
    }
  });

  it("send a handed-off text back to the queue only if it was not accepted, and that counts an attempt: no automatic second submission", async () => {
    const requeue = (id: string, attempts?: number) =>
      asApp((tx) => tx.unsafe(`update delivery set state = 'queued'${attempts === undefined ? "" : `, attempts = ${attempts}`}, due_at = now() + interval '30 seconds' where id = '${id}'`));
    const claimAndHandOff = async (id: string) => {
      await asApp((tx) => transitionStatement(tx, id, "claimed"));
      await handOff(id);
    };
    const id = await rowIn("claimed", { handedOff: true });
    // A dispatcher or sweep bug that requeues a text the provider was handed, with no attempt counted, is refused and the row is untouched.
    expect(await refusal(() => requeue(id))).toMatch(/goes back to the queue only if it was not accepted, and that counts an attempt/);
    expect(await refusal(() => requeue(id, 0))).toMatch(/not accepted/);
    const held = await rowOf(id);
    expect([held.state, held.attempts]).toEqual(["claimed", 0]);
    expect(held.handed_off_at).toBeInstanceOf(Date);
    // Not accepted (429, or no request sent) is counted: the claim, the lease and the hand-off are cleared.
    await requeue(id, 1);
    const first = await rowOf(id);
    expect([first.state, first.attempts, first.claimed_by, first.claim_token, first.handed_off_at]).toEqual(["queued", 1, null, null, null]);
    // Three attempts in all; the backoffs of the definitions are the dispatcher's, the database counts.
    for (const attempts of [2, 3]) {
      await claimAndHandOff(id);
      await requeue(id, attempts);
      expect((await rowOf(id)).attempts).toBe(attempts);
    }
    // At 3 attempts there is no fourth: a handed-off row can only fail (or become unknown, or be answered), never be queued again.
    await claimAndHandOff(id);
    expect(await refusal(() => requeue(id, 4))).toMatch(/delivery_attempts_valid/);
    expect(await refusal(() => requeue(id, 3))).toMatch(/not accepted/);
    expect(await refusal(() => requeue(id))).toMatch(/not accepted/);
    await asApp((tx) => transitionStatement(tx, id, "failed"));
    expect(await stateOf(id)).toBe("failed");
    // A claim that was not handed off (a pause before the hand-off, a claim that expired) returns to the queue with no attempt counted.
    const unhanded = await rowIn("claimed");
    await requeue(unhanded);
    expect([(await rowOf(unhanded)).state, (await rowOf(unhanded)).attempts]).toEqual(["queued", 0]);
  });

  it("give an outcome (submitted, unknown, delivered, undelivered) only to a text that was handed to the provider", async () => {
    for (const to of OUTCOME_AFTER_HAND_OFF) {
      const id = await rowIn("claimed");
      expect(await refusal(() => asApp((tx) => transitionStatement(tx, id, to))), to).toMatch(/a text not handed to the provider has no outcome/);
      expect(await stateOf(id), to).toBe("claimed");
      await handOff(id);
      await asApp((tx) => transitionStatement(tx, id, to));
      expect(await stateOf(id), to).toBe(to);
    }
    // A permanent error found before the call (no usable number) and a log-mode skip have no provider answer to wait for.
    for (const to of ["failed", "skipped_env"] as const) {
      const id = await rowIn("claimed");
      await asApp((tx) => transitionStatement(tx, id, to));
      expect(await stateOf(id), to).toBe(to);
    }
  });

  it("never queue a text the provider gave an id, so it cannot be sent again", async () => {
    const id = await rowIn("claimed", { handedOff: true });
    await asApp((tx) => tx`update delivery set provider_message_id = ${FAKE_SID}, attempts = 1 where id = ${id}`);
    expect(await refusal(() => asApp((tx) => tx`update delivery set state = 'queued', attempts = 2 where id = ${id}`))).toMatch(/delivery_claim_coherent/);
    expect(await stateOf(id)).toBe("claimed");
    const queued = await rowIn("queued");
    expect(await refusal(() => asApp((tx) => tx`update delivery set provider_message_id = ${FAKE_SID} where id = ${queued}`))).toMatch(/delivery_claim_coherent/);
    expect((await rowOf(queued)).provider_message_id).toBeNull();
  });

  it("time what happens: submitted_at at the first submission, completed_at at a terminal state and never before", async () => {
    const id = await rowIn("queued");
    expect((await rowOf(id)).completed_at).toBeNull();
    await asApp((tx) => transitionStatement(tx, id, "claimed"));
    await handOff(id);
    await asApp((tx) => transitionStatement(tx, id, "submitted"));
    const submitted = await rowOf(id);
    expect(submitted.submitted_at).toBeInstanceOf(Date);
    expect(submitted.completed_at).toBeNull();
    await asApp((tx) => transitionStatement(tx, id, "unknown"));
    await asApp((tx) => transitionStatement(tx, id, "submitted"));
    expect((await rowOf(id)).submitted_at).toEqual(submitted.submitted_at);
    await asApp((tx) => transitionStatement(tx, id, "delivered"));
    const done = await rowOf(id);
    expect(done.completed_at).toBeInstanceOf(Date);
    expect(done.updated_at.getTime()).toBeGreaterThanOrEqual(submitted.updated_at.getTime());
  });

  it("need the provider's id for a submitted, delivered or undelivered text", async () => {
    for (const to of ["submitted", "delivered", "undelivered"] as const) {
      const id = await rowIn("claimed", { handedOff: true });
      expect(await refusal(() => asApp((tx) => tx.unsafe(`update delivery set state = '${to}' where id = '${id}'`))), to).toMatch(/delivery_in_flight_has_provider_id/);
    }
    // A permanent failure or a log-mode skip has none to give.
    const failed = await rowIn("claimed");
    await asApp((tx) => tx`update delivery set state = 'failed', provider_error_code = 21211 where id = ${failed}`);
    expect((await rowOf(failed)).provider_error_code).toBe(21211);
  });
});

// --- idempotency -------------------------------------------------------------------------------------

describe("the idempotency key", () => {
  const queue = createDeliveryQueue();
  const welcome = (recipientId: string, nonce: string) => ({
    module: "subscriptions" as const,
    purpose: "welcome",
    recipient: { kind: "subscriber" as const, id: recipientId },
    subject: recipientId,
    nonce,
    lang: "en" as const,
    body: "Welcome. Reply 1 to change your building.",
    segments: 1,
    costEstimateCents: 2,
  });
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it("returns the existing row for a second insert of the same key, with no error", async () => {
    const input = welcome(randomUUID(), "n1");
    const first = await app.transaction((tx) => queue.enqueueTransactional(tx, input));
    const second = await app.transaction((tx) => queue.enqueueTransactional(tx, input));
    if (!first.ok || !second.ok) throw new Error("refused");
    expect(first.value.created).toBe(true);
    expect(second.value.created).toBe(false);
    expect(second.value.delivery.id).toBe(first.value.delivery.id);
    expect(second.value.delivery.callbackRef).toBe(first.value.delivery.callbackRef);
    expect(await count()).toBe(1);
  });

  it("leaves exactly one row when two inserts of the same key run at the same time, and neither caller gets an error", async () => {
    const input = welcome(randomUUID(), "race");
    let firstHasInserted: () => void = () => undefined;
    const inserted = new Promise<void>((resolve) => (firstHasInserted = resolve));
    const started = Date.now();
    const first = app.transaction(async (tx) => {
      const result = await queue.enqueueTransactional(tx, input);
      firstHasInserted();
      await sleep(400); // the first transaction holds its uncommitted row while the second one inserts
      return result;
    });
    await inserted;
    const secondStarted = Date.now();
    const second = app.transaction((tx) => queue.enqueueTransactional(tx, input));
    const [a, b] = await Promise.all([first, second]);
    if (!a.ok || !b.ok) throw new Error("refused");
    // The second waited for the first to commit (so the two really overlapped), then read the first's row back.
    expect(Date.now() - secondStarted).toBeGreaterThanOrEqual(250);
    expect(Date.now() - started).toBeGreaterThanOrEqual(400);
    expect([a.value.created, b.value.created]).toEqual([true, false]);
    expect(b.value.delivery.id).toBe(a.value.delivery.id);
    expect(await count()).toBe(1);
  });

  it("leaves one row for each of many simultaneous pairs", async () => {
    const inputs = Array.from({ length: 12 }, (_, index) => welcome(randomUUID(), `pair${index}`));
    const results = await Promise.all(inputs.flatMap((input) => [app.transaction((tx) => queue.enqueueTransactional(tx, input)), app.transaction((tx) => queue.enqueueTransactional(tx, input))]));
    for (const result of results) expect(result.ok).toBe(true);
    for (let index = 0; index < inputs.length; index += 1) {
      const [a, b] = [results[index * 2], results[index * 2 + 1]];
      if (!a.ok || !b.ok) throw new Error("refused");
      expect(a.value.delivery.id).toBe(b.value.delivery.id);
      expect([a.value.created, b.value.created].filter(Boolean)).toHaveLength(1);
    }
    expect(await count()).toBe(inputs.length);
  });

  it("lets the waiting insert go ahead when the first one rolls back", async () => {
    const input = welcome(randomUUID(), "rollback");
    let firstHasInserted: () => void = () => undefined;
    const inserted = new Promise<void>((resolve) => (firstHasInserted = resolve));
    const first = app
      .transaction(async (tx) => {
        await queue.enqueueTransactional(tx, input);
        firstHasInserted();
        await sleep(300);
        throw new Error("rolled back");
      })
      .catch(() => undefined);
    await inserted;
    const second = await app.transaction((tx) => queue.enqueueTransactional(tx, input));
    await first;
    if (!second.ok) throw new Error("refused");
    expect(second.value.created).toBe(true);
    expect(await count()).toBe(1);
  });

  it("holds one row per key in an alert batch with the same recipient twice, and is idempotent per entry and recipient", async () => {
    const entry = await fx.entry("pending_approval");
    const recipient = randomUUID();
    const text = { recipient: { kind: "subscriber" as const, id: recipient }, lang: "en" as const, body: entry.bodies.en.body, segments: entry.bodies.en.segments, costEstimateCents: 4 };
    const run = () =>
      app.transaction(async (tx) => {
        await queue.markApprovalTransaction(tx, entry.entryId);
        return queue.enqueueAlertDeliveries(tx, entry.entryId, [text, text]);
      });
    const first = await run();
    const again = await run();
    if (!first.ok || !again.ok) throw new Error("refused");
    expect(first.value.map((r) => r.created)).toEqual([true, false]);
    expect(again.value.map((r) => r.created)).toEqual([false, false]);
    expect(again.value[0].delivery.id).toBe(first.value[0].delivery.id);
    expect(first.value[0].delivery.idempotencyKey).toBe(`${entry.entryId}:${recipient}:sms`);
    expect(await count()).toBe(1);
  });
});

// --- alert deliveries ----------------------------------------------------------------------------------

describe("alert deliveries", () => {
  it("are refused outside an approval transaction, and accepted inside the one that marked their entry", async () => {
    const entry = await fx.entry("pending_approval");
    expect(await refusal(() => asApp((tx) => insertRow(tx, alertRow(entry))))).toMatch(/only inside the approval transaction of its entry/);
    expect(await refusal(() => owner.begin((tx) => insertRow(tx, alertRow(entry))))).toMatch(/only inside the approval transaction/);
    expect(await count()).toBe(0);
    const row = await asApp((tx) => insertRow(tx, alertRow(entry)), entry.entryId);
    expect(row.kind).toBe("alert");
    expect(row.state).toBe("queued");
    expect(await count()).toBe(1);
  });

  it("are refused when the marker is for another entry", async () => {
    const entry = await fx.entry("pending_approval");
    const other = await fx.entry("pending_approval");
    expect(await refusal(() => asApp((tx) => insertRow(tx, alertRow(entry)), other.entryId))).toMatch(/only inside the approval transaction of its entry/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, alertRow(entry)), randomUUID()))).toMatch(/only inside the approval transaction/);
  });

  it("do not outlive the transaction that marked them: the marker is local to it, even on a reused connection", async () => {
    const entry = await fx.entry("pending_approval");
    const single = postgres(appUrl, { max: 1, onnotice: () => {} });
    try {
      await single.begin(async (tx) => {
        await tx`select set_config('cvh.approval_entry_id', ${entry.entryId}, true)`;
        await insertRow(tx, alertRow(entry));
      });
      expect(await refusal(() => single.begin((tx) => insertRow(tx, alertRow(entry))))).toMatch(/only inside the approval transaction/);
      expect(await refusal(() => insertRow(single, alertRow(entry)))).toMatch(/only inside the approval transaction/);
    } finally {
      await single.end({ timeout: 5 });
    }
    expect(await count()).toBe(1);
  });

  it("belong only to an entry that is being approved: pending approval, never a draft or a discarded entry", async () => {
    for (const [status, ok] of [["pending_approval", true], ["draft", false], ["discarded", false]] as const) {
      const entry = await fx.entry(status);
      const attempt = () => asApp((tx) => insertRow(tx, alertRow(entry)), entry.entryId);
      if (ok) await expect(attempt(), status).resolves.toBeDefined();
      else expect(await refusal(attempt), status).toMatch(/being approved or is approved/);
    }
    const missing = randomUUID();
    const entry = await fx.entry("pending_approval");
    const recipient = randomUUID();
    const orphan = alertRow(entry, { entry_id: missing, recipient_id: recipient, idempotency_key: `${missing}:${recipient}:sms` });
    expect(await refusal(() => asApp((tx) => insertRow(tx, orphan), missing))).toMatch(/being approved or is approved, not missing/);
  });

  it("are accepted for an approved entry only in the transaction that approved it, written before or after the approval", async () => {
    // The approval, then the deliveries, in one transaction: the entry is `approved` with approved_at = now().
    const approvedFirst = await fx.entry("pending_approval");
    await asApp(async (tx) => {
      await fx.approve(tx, approvedFirst);
      await insertRow(tx, alertRow(approvedFirst));
    }, approvedFirst.entryId);
    // The deliveries, then the approval, in one transaction.
    const writtenFirst = await fx.entry("pending_approval");
    await asApp(async (tx) => {
      await insertRow(tx, alertRow(writtenFirst));
      await fx.approve(tx, writtenFirst);
    }, writtenFirst.entryId);
    expect(await owner`select status from alert_entry where id in (${approvedFirst.entryId}, ${writtenFirst.entryId})`).toEqual([{ status: "approved" }, { status: "approved" }]);
    expect(await count()).toBe(2);
  });

  it("are refused for an entry approved by an earlier transaction, even with the marker set (a later transaction can set it too)", async () => {
    const later = /an alert delivery of an approved entry is created in the transaction that approved it/;
    // Approved a moment ago by its own transaction, which wrote no delivery.
    const justApproved = await fx.entry("pending_approval");
    await asApp((tx) => fx.approve(tx, justApproved));
    expect(await refusal(() => asApp((tx) => insertRow(tx, alertRow(justApproved)), justApproved.entryId))).toMatch(later);
    // Approved long ago (a seeded entry), and the same for the owner's connection.
    const longAgo = await fx.entry("approved");
    expect(await refusal(() => asApp((tx) => insertRow(tx, alertRow(longAgo)), longAgo.entryId))).toMatch(later);
    expect(await refusal(() => owner.begin(async (tx) => {
      await tx`select set_config('cvh.approval_entry_id', ${longAgo.entryId}, true)`;
      return insertRow(tx, alertRow(longAgo));
    }))).toMatch(later);
    // Approving another entry in the same transaction does not make this one's deliveries acceptable.
    const other = await fx.entry("pending_approval");
    expect(await refusal(() => asApp(async (tx) => {
      await fx.approve(tx, other);
      await insertRow(tx, alertRow(longAgo));
    }, longAgo.entryId))).toMatch(later);
    expect(await count()).toBe(0);
  });

  it("carry the entry's frozen SMS body and segments for their language, byte for byte", async () => {
    const entry = await fx.entry("pending_approval");
    const ok = await asApp((tx) => insertRow(tx, alertRow(entry, { lang: "ur" })), entry.entryId);
    expect(ok.body).toBe(entry.bodies.ur.body);
    expect(ok.segments).toBe(2);
    const refused = (over: Row) => refusal(() => asApp((tx) => insertRow(tx, alertRow(entry, over)), entry.entryId));
    expect(await refused({ body: `${entry.bodies.en.body} ` })).toMatch(/frozen SMS body and segments/);
    expect(await refused({ lang: "en", body: entry.bodies.ur.body })).toMatch(/frozen SMS body and segments/);
    expect(await refused({ segments: 2 })).toMatch(/frozen SMS body and segments/);
    // A language the entry has no body for gets no delivery in it (a recipient of that language is sent the English body).
    expect(await refused({ lang: "fr" })).toMatch(/frozen SMS body and segments/);
  });

  it("are keyed entry:recipient:channel, so a recipient is texted once per entry", async () => {
    const entry = await fx.entry("pending_approval");
    const recipient = randomUUID();
    const refused = (key: string) => refusal(() => asApp((tx) => insertRow(tx, alertRow(entry, { recipient_id: recipient, idempotency_key: key })), entry.entryId));
    expect(await refused(`${entry.entryId}:${randomUUID()}:sms`)).toMatch(/key is entry_id:recipient:channel/);
    expect(await refused(`${randomUUID()}:${recipient}:sms`)).toMatch(/key is entry_id:recipient:channel/);
    expect(await refused(`alert:${recipient}:menu_reply:n`)).toMatch(/key is entry_id:recipient:channel/);
    await asApp((tx) => insertRow(tx, alertRow(entry, { recipient_id: recipient })), entry.entryId);
    expect(await refusal(() => asApp((tx) => insertRow(tx, alertRow(entry, { recipient_id: recipient })), entry.entryId))).toMatch(/delivery_idempotency_key_unique/);
  });

  it("go to a subscriber or a drill-roster member, and name no purpose, campaign or other module", async () => {
    const entry = await fx.entry("pending_approval");
    for (const kind of ["subscriber", "roster"]) await expect(asApp((tx) => insertRow(tx, alertRow(entry, { recipient_kind: kind })), entry.entryId), kind).resolves.toBeDefined();
    for (const kind of ["pending_signup", "staff", "oncall", "inbound_reply"]) {
      expect(await refusal(() => asApp((tx) => insertRow(tx, alertRow(entry, { recipient_kind: kind })), entry.entryId)), kind).toMatch(/delivery_kind_shape/);
    }
    for (const over of [{ purpose: "welcome" }, { campaign_id: randomUUID() }, { created_by_module: "ops" }, { entry_id: null }]) {
      expect(await refusal(() => asApp((tx) => insertRow(tx, alertRow(entry, over)), entry.entryId)), JSON.stringify(over)).toMatch(/delivery_kind_shape|entry_id:recipient:channel|approval transaction/);
    }
  });

  it("are written by the queue's use case only inside the marked transaction, and refused as a value for a bad recipient", async () => {
    const entry = await fx.entry("pending_approval");
    const queue = createDeliveryQueue();
    const text = { recipient: { kind: "subscriber" as const, id: randomUUID() }, lang: "en" as const, body: entry.bodies.en.body, segments: 1, costEstimateCents: 4 };
    // Without the mark the database refuses (an error, not an expected outcome: the caller broke the rule).
    expect(await refusal(() => app.transaction((tx) => queue.enqueueAlertDeliveries(tx, entry.entryId, [text])))).toMatch(/approval transaction/);
    const bad = await app.transaction(async (tx) => {
      await queue.markApprovalTransaction(tx, entry.entryId);
      return queue.enqueueAlertDeliveries(tx, entry.entryId, [text, { ...text, recipient: { kind: "staff" as never, id: randomUUID() } }]);
    });
    expect(bad).toEqual({ ok: false, error: "RECIPIENT_NOT_ALLOWED" });
    expect(await count()).toBe(0);
  });
});

// --- transactional deliveries --------------------------------------------------------------------------

describe("transactional deliveries", () => {
  it("are accepted exactly where the module's allow-list says, for every module, purpose and kind of recipient", async () => {
    const purposes = [...new Set([...TRANSACTIONAL_PURPOSES.map((p) => p.purpose), "not_a_purpose"])];
    let accepted = 0;
    for (const creator of CREATING_MODULES) {
      for (const purpose of purposes) {
        for (const recipientKind of RECIPIENT_KINDS) {
          const rule = purposeRule(creator, purpose);
          const expected = rule !== undefined && rule.recipientKinds.includes(recipientKind);
          const attempt = () => asApp((tx) => insertRow(tx, transactionalRow({ created_by_module: creator, purpose, recipient_kind: recipientKind })));
          if (expected) {
            await expect(attempt(), `${creator}/${purpose}/${recipientKind}`).resolves.toBeDefined();
            accepted += 1;
          } else {
            expect(await refusal(attempt), `${creator}/${purpose}/${recipientKind}`).toMatch(/not on the allow-list|never texted to|violates check constraint/);
          }
        }
      }
    }
    expect(accepted).toBe(TRANSACTIONAL_PURPOSES.reduce((sum, p) => sum + p.recipientKinds.length, 0));
    expect(await count()).toBe(accepted);
  });

  it("refuse a purpose that is on another module's allow-list", async () => {
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ created_by_module: "alerting", purpose: "welcome" }))))).toMatch(/purpose welcome is not on the allow-list of module alerting/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ created_by_module: "subscriptions", purpose: "oncall_alert", recipient_kind: "oncall" }))))).toMatch(/not on the allow-list/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ created_by_module: "ops", purpose: "welcome" }))))).toMatch(/not on the allow-list/);
  });

  it("refuse a confirmation to a subscriber and a signup_info to anyone but an inbound_reply recipient", async () => {
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ purpose: "confirmation", recipient_kind: "subscriber" }))))).toMatch(/never texted to a subscriber/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ purpose: "signup_info", recipient_kind: "pending_signup" }))))).toMatch(/never texted to a pending_signup/);
    await expect(asApp((tx) => insertRow(tx, transactionalRow({ purpose: "confirmation", recipient_kind: "pending_signup" })))).resolves.toBeDefined();
    await expect(asApp((tx) => insertRow(tx, transactionalRow({ purpose: "signup_info", recipient_kind: "inbound_reply" })))).resolves.toBeDefined();
  });

  it("need a send_by, ahead of now and within the purpose's window", async () => {
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ send_by: null }))))).toMatch(/has a send_by/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ send_by: raw("now() - interval '1 minute'") }))))).toMatch(/send_by of a menu_reply text is within/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ send_by: raw("now()") }))))).toMatch(/send_by of a menu_reply text is within/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ send_by: raw("now() + interval '30 minutes 1 second'") }))))).toMatch(/send_by of a menu_reply text is within/);
    await expect(asApp((tx) => insertRow(tx, transactionalRow({ send_by: raw("now() + interval '30 minutes'") })))).resolves.toBeDefined();
    // 48 hours for a confirmation, as the definitions say.
    const confirmation = { purpose: "confirmation", recipient_kind: "pending_signup" };
    await expect(asApp((tx) => insertRow(tx, transactionalRow({ ...confirmation, send_by: raw("now() + interval '48 hours'") })))).resolves.toBeDefined();
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ ...confirmation, send_by: raw("now() + interval '48 hours 1 second'") }))))).toMatch(/within/);
  });

  it("are keyed kind:subject:purpose:nonce, with no colon, plus sign or empty part", async () => {
    const refused = (key: string) => refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ idempotency_key: key }))));
    expect(await refused("transactional:subject:menu_reply")).toMatch(/kind:subject:purpose:nonce/);
    expect(await refused("transactional:subject:menu_reply:n:extra")).toMatch(/kind:subject:purpose:nonce/);
    expect(await refused("transactional::menu_reply:n")).toMatch(/kind:subject:purpose:nonce/);
    expect(await refused("transactional:subject:menu_reply:")).toMatch(/kind:subject:purpose:nonce/);
    expect(await refused("campaign:subject:menu_reply:n")).toMatch(/kind:subject:purpose:nonce/);
    expect(await refused("transactional:subject:welcome:n")).toMatch(/kind:subject:purpose:nonce/);
    // The trigger speaks before the table's format check, so a number with a plus sign is refused as a number.
    expect(await refused("transactional:+14165550123:menu_reply:n")).toMatch(/no part of a key is a phone number/);
    expect(await refused("transactional:a b:menu_reply:n")).toMatch(/delivery_key_format/);
    expect(await refused(`transactional:${"a".repeat(200)}:menu_reply:n`)).toMatch(/delivery_key_format/);
    await expect(asApp((tx) => insertRow(tx, transactionalRow({ idempotency_key: "transactional:S1:menu_reply:n1" })))).resolves.toBeDefined();
  });

  it("refuse a key whose subject or nonce is a phone number, by the same rule as the app's looksLikePhoneNumber", async () => {
    const message = /no part of a key is a phone number/;
    const keyWith = (subject: string, nonce: string) => `transactional:${subject}:menu_reply:${nonce}`;
    // The numbers as a person writes them (the key's alphabet allows digits, dots and dashes; the plus sign is refused as a number too).
    for (const number of ["+14165550123", "14165550123", "4165550123", "416-555-0123", "416.555.0123", "1234567", "123456789012345"]) {
      expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ idempotency_key: keyWith(number, "n1") })))), `subject ${number}`).toMatch(message);
      expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ idempotency_key: keyWith("S1", number) })))), `nonce ${number}`).toMatch(message);
    }
    // Everything else is judged exactly as the app judges it: the two lists must agree on every sample.
    const samples = ["S1", "123456", "1234567890123456", "12-34-56", "1.2.3.4.5.6.7", "a1234567", "1234567a", randomUUID(), FAKE_SID, "n1"];
    for (const [index, sample] of samples.entries()) {
      const attempt = () => asApp((tx) => insertRow(tx, transactionalRow({ idempotency_key: keyWith(sample, `k${index}`) })));
      if (looksLikePhoneNumber(sample)) expect(await refusal(attempt), sample).toMatch(message);
      else await expect(attempt(), sample).resolves.toBeDefined();
    }
  });

  it("name no entry and no campaign", async () => {
    const entry = await fx.entry("pending_approval");
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ entry_id: entry.entryId }))))).toMatch(/delivery_kind_shape/);
    expect(await refusal(() => asApp((tx) => insertRow(tx, transactionalRow({ campaign_id: randomUUID() }))))).toMatch(/delivery_kind_shape/);
  });

  it("get their send_by from the database's clock through the queue, and a given one for signup_info", async () => {
    const queue = createDeliveryQueue();
    const base = { module: "subscriptions" as const, recipient: { kind: "subscriber" as const, id: randomUUID() }, subject: "S1", lang: "en" as const, body: "Reply 1.", segments: 1, costEstimateCents: 2 };
    const menu = await app.transaction((tx) => queue.enqueueTransactional(tx, { ...base, purpose: "menu_reply", nonce: "a" }));
    if (!menu.ok) throw new Error("refused");
    expect(menu.value.delivery.sendBy!.getTime() - menu.value.delivery.createdAt.getTime()).toBe(30 * 60_000);
    // The `inbound_reply` row's own expiry is the send_by of its signup_info text (the queue checks it is within the window).
    const expiresAt = new Date(Date.now() + 20 * 60_000);
    const info = await app.transaction((tx) =>
      queue.enqueueTransactional(tx, { ...base, recipient: { kind: "inbound_reply", id: randomUUID() }, purpose: "signup_info", nonce: "b", sendBy: expiresAt }),
    );
    if (!info.ok) throw new Error("refused");
    expect(info.value.delivery.sendBy).toEqual(expiresAt);
    const missing = await app.transaction((tx) => queue.enqueueTransactional(tx, { ...base, recipient: { kind: "inbound_reply", id: randomUUID() }, purpose: "signup_info", nonce: "c" }));
    expect(missing).toEqual({ ok: false, error: "SEND_BY_INVALID" });
    const tooFar = await app.transaction((tx) => queue.enqueueTransactional(tx, { ...base, purpose: "menu_reply", nonce: "d", sendBy: new Date(Date.now() + 31 * 60_000) }));
    expect(tooFar).toEqual({ ok: false, error: "SEND_BY_INVALID" });
    const wrongModule = await app.transaction((tx) => queue.enqueueTransactional(tx, { ...base, module: "ops", purpose: "welcome", nonce: "e" }));
    expect(wrongModule).toEqual({ ok: false, error: "PURPOSE_NOT_ALLOWED" });
    const phoneKey = await app.transaction((tx) => queue.enqueueTransactional(tx, { ...base, purpose: "menu_reply", subject: "+14165550123", nonce: "f" }));
    expect(phoneKey).toEqual({ ok: false, error: "KEY_PART_INVALID" });
    expect(await count()).toBe(2);
  });
});

// --- campaign deliveries -------------------------------------------------------------------------------

describe("campaign deliveries", () => {
  const campaignRow = (campaignId: string, over: Row = {}): Row => {
    const recipient = randomUUID();
    return {
      id: randomUUID(),
      kind: "campaign",
      recipient_kind: "subscriber",
      recipient_id: recipient,
      campaign_id: campaignId,
      created_by_module: "subscriptions",
      purpose: "reconsent",
      lang: "en",
      body: "Do you want to keep getting alerts? Reply YES.",
      segments: 1,
      cost_estimate_cents: 2,
      idempotency_key: `campaign:${campaignId}:reconsent:${recipient}`,
      ...over,
    };
  };
  const message = /needs a campaign started by an Admin at aal2/;

  /**
   * Stands in for S09.07, which replaces delivery_campaign_started_by_admin() with a read of the campaign row: in one owner
   * transaction that is always rolled back, the function answers true, so the rest of the campaign rules can be tried.
   */
  async function asIfCampaignStarted<T>(run: (tx: Tx) => PromiseLike<T>): Promise<T> {
    const rolledBack = "rolled back on purpose";
    let result: T | undefined;
    try {
      await owner.begin(async (tx) => {
        await tx.unsafe(
          "create or replace function public.delivery_campaign_started_by_admin(p_campaign_id uuid) returns boolean language sql stable set search_path = '' as $$ select true $$",
        );
        result = await run(tx);
        throw new Error(rolledBack);
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== rolledBack) throw error;
    }
    return result as T;
  }

  it("are all refused until S09.07 creates campaigns: nothing the caller states makes a campaign started", async () => {
    const admin = await fx.staff("admin");
    const campaignId = randomUUID();
    expect(await refusal(() => asApp((tx) => insertRow(tx, campaignRow(campaignId))))).toMatch(message);
    // What an earlier version of this rule read: the campaign's id, an active Admin and aal2, all said by the caller. Nobody is believed.
    expect(
      await refusal(() =>
        appSql.begin(async (tx) => {
          await tx`select set_config('cvh.campaign_id', ${campaignId}, true)`;
          await tx`select set_config('cvh.campaign_started_by', ${admin.id}, true)`;
          await tx`select set_config('cvh.campaign_aal', 'aal2', true)`;
          return insertRow(tx, campaignRow(campaignId));
        }),
      ),
    ).toMatch(message);
    // Nor the owner.
    expect(await refusal(() => owner.begin((tx) => insertRow(tx, campaignRow(campaignId))))).toMatch(message);
    expect(await count()).toBe(0);
  });

  it("are refused by a function that answers false for any campaign: the one S09.07 replaces with a read of the campaign row", async () => {
    const [answers] = await appSql`select public.delivery_campaign_started_by_admin(${randomUUID()}::uuid) as started, public.delivery_campaign_started_by_admin(null) as nothing`;
    expect(answers).toEqual({ started: false, nothing: false });
  });

  it("are refused through the queue's use case too, and nothing is written", async () => {
    const queue = createDeliveryQueue();
    const campaignId = randomUUID();
    const input = { campaignId, purpose: "reconsent", recipient: { kind: "subscriber" as const, id: randomUUID() }, lang: "en" as const, body: "Reply YES to keep your alerts.", segments: 1, costEstimateCents: 2 };
    expect(await refusal(() => app.transaction((tx) => queue.enqueueCampaignDelivery(tx, input)))).toMatch(message);
    expect(await count()).toBe(0);
  });

  it("go to a subscriber and to no other kind of recipient, once a campaign is started", async () => {
    const campaignId = randomUUID();
    for (const kind of RECIPIENT_KINDS) {
      const attempt = () => asIfCampaignStarted((tx) => insertRow(tx, campaignRow(campaignId, { recipient_kind: kind })));
      if (kind === "subscriber") await expect(attempt(), kind).resolves.toMatchObject({ kind: "campaign", state: "queued", recipient_kind: "subscriber" });
      else expect(await refusal(attempt), kind).toMatch(/delivery_kind_shape/);
    }
    expect(await count()).toBe(0);
  });

  it("keep the shape and the key of their kind once a campaign is started: a campaign, a purpose, the subscriptions module, no entry, no phone number", async () => {
    const campaignId = randomUUID();
    const refused = (over: Row) => refusal(() => asIfCampaignStarted((tx) => insertRow(tx, campaignRow(campaignId, over))));
    expect(await refused({ campaign_id: null })).toMatch(/delivery_kind_shape/);
    expect(await refused({ purpose: null, idempotency_key: `campaign:${campaignId}:x:y` })).toMatch(/delivery_kind_shape|kind:subject:purpose:nonce/);
    expect(await refused({ created_by_module: "ops" })).toMatch(/delivery_kind_shape/);
    expect(await refused({ idempotency_key: `${campaignId}:${randomUUID()}:sms` })).toMatch(/kind:subject:purpose:nonce/);
    expect(await refused({ idempotency_key: `campaign:${campaignId}:reconsent:4165550123` })).toMatch(/no part of a key is a phone number/);
    expect(await refused({ entry_id: (await fx.entry("pending_approval")).entryId })).toMatch(/delivery_kind_shape/);
    expect(await count()).toBe(0);
  });
});

// --- a deleted recipient -------------------------------------------------------------------------------

describe("a deleted recipient", () => {
  /** A table of recipients that carries the trigger every recipient table carries (the owner's, as a migration would add it). */
  async function recipientTable(kind: string, trigger = `delivery_forget_recipient('${kind}')`) {
    const name = `scratch_recipient_${randomBytes(4).toString("hex")}`;
    await owner.unsafe(`create table ${name} (id uuid primary key)`);
    await owner.unsafe(`grant select, insert, delete on ${name} to cvh_app`);
    await owner.unsafe(`create trigger ${name}_forget_deliveries after delete on ${name} for each row execute function ${trigger}`);
    scratchTables.push(name);
    return name;
  }

  it("is forgotten by every row that names it, in any state, and the row's key forgets it too", async () => {
    const table = await recipientTable("subscriber");
    const gone = randomUUID();
    const kept = randomUUID();
    await owner.unsafe(`insert into ${table} (id) values ('${gone}'), ('${kept}')`);
    // The subject of a text's key is usually the recipient's id, so the key holds it too.
    const ofRecipient = (id: string, nonce: string) => ({ recipient_kind: "subscriber", recipient_id: id, idempotency_key: `transactional:${id}:menu_reply:${nonce}` });
    const states: DeliveryState[] = ["queued", "claimed", "submitted", "unknown", "delivered", "undelivered", "failed", "cancelled", "skipped", "skipped_env"];
    const ids: Record<string, string> = {};
    for (const state of states) ids[state] = await rowIn(state, { over: ofRecipient(gone, state) });
    const keptId = await rowIn("delivered", { over: ofRecipient(kept, "kept") });
    const before = await Promise.all(states.map((state) => rowOf(ids[state])));
    expect(before.every((row) => row.recipient_id === gone && row.idempotency_key.includes(gone))).toBe(true);

    await asApp((tx) => tx.unsafe(`delete from ${table} where id = '${gone}'`));

    for (const [index, state] of states.entries()) {
      const after = await rowOf(ids[state]);
      expect(after.recipient_id, state).toBeNull();
      expect(after.idempotency_key, state).toBe(`detached:${ids[state]}`);
      // Nothing else changed: not the state, not the body, not the times.
      expect(withoutLink(after), state).toEqual(withoutLink(before[index]));
    }
    expect(JSON.stringify(await owner`select * from delivery where recipient_kind = 'subscriber'`)).not.toContain(gone);
    const survivor = await rowOf(keptId);
    expect(survivor.recipient_id).toBe(kept);
    expect(survivor.idempotency_key).toContain(kept);
  });

  it("is forgotten only by rows of its kind: another kind's row with the same id is left alone", async () => {
    const table = await recipientTable("roster");
    const shared = randomUUID();
    await owner.unsafe(`insert into ${table} (id) values ('${shared}')`);
    // A roster text is an alert: written inside an approval, for an entry.
    const entry = await fx.entry("pending_approval");
    const rosterRow = await asApp((tx) => insertRow(tx, alertRow(entry, { recipient_kind: "roster", recipient_id: shared })), entry.entryId);
    const otherKind = await rowIn("queued", { over: { recipient_kind: "subscriber", recipient_id: shared } });
    await asApp((tx) => tx.unsafe(`delete from ${table} where id = '${shared}'`));
    expect((await rowOf(rosterRow.id)).recipient_id).toBeNull();
    expect((await rowOf(otherKind)).recipient_id).toBe(shared);
  });

  it("cannot be forgotten by the app itself, only by deleting the recipient", async () => {
    const id = await rowIn("queued");
    expect(await refusal(() => asApp((tx) => tx`update delivery set recipient_id = null where id = ${id}`))).toMatch(/permission denied/);
    expect(await refusal(() => owner`update delivery set recipient_id = null where id = ${id}`)).toMatch(/frozen at creation/);
    expect(await refusal(() => owner`update delivery set recipient_id = null, state = 'cancelled', idempotency_key = ${`detached:${id}`} where id = ${id}`)).toMatch(/forgetting a recipient changes nothing else/);
    expect((await rowOf(id)).recipient_id).not.toBeNull();
  });

  it("takes only a recipient kind as the trigger's argument", async () => {
    const table = await recipientTable("not_a_kind", "delivery_forget_recipient('not_a_kind')");
    const id = randomUUID();
    await owner.unsafe(`insert into ${table} (id) values ('${id}')`);
    expect(await refusal(() => asApp((tx) => tx.unsafe(`delete from ${table} where id = '${id}'`)))).toMatch(/takes the recipient_kind as its one argument/);
    expect((await owner.unsafe(`select count(*)::int as n from ${table}`))[0].n).toBe(1);
  });

  it("has its queued and claimed-but-not-handed-off texts skipped first (skipRecipientDeliveries), and its handed-off ones left", async () => {
    const queue = createDeliveryQueue();
    const table = await recipientTable("subscriber");
    const gone = randomUUID();
    await owner.unsafe(`insert into ${table} (id) values ('${gone}')`);
    const over = { recipient_kind: "subscriber", recipient_id: gone };
    const queued = await rowIn("queued", { over });
    const claimed = await rowIn("claimed", { over });
    const handedOff = await rowIn("claimed", { over, handedOff: true });
    const submitted = await rowIn("submitted", { over });
    const unknown = await rowIn("unknown", { over });
    const delivered = await rowIn("delivered", { over });
    const elsewhere = await rowIn("queued");

    const report = await app.transaction(async (tx) => {
      const result = await queue.skipRecipientDeliveries(tx, { kind: "subscriber", id: gone });
      await tx.execute(drizzleSql.raw(`delete from ${table} where id = '${gone}'`));
      return result;
    });

    expect(report).toEqual({ skipped: 2, inFlight: 3 });
    expect([await stateOf(queued), await stateOf(claimed)]).toEqual(["skipped", "skipped"]);
    expect([await stateOf(handedOff), await stateOf(submitted), await stateOf(unknown), await stateOf(delivered)]).toEqual(["claimed", "submitted", "unknown", "delivered"]);
    expect(await stateOf(elsewhere)).toBe("queued");
    // Every row of the recipient has forgotten it, including the ones left in flight.
    expect(await owner`select id from delivery where recipient_id = ${gone}`).toHaveLength(0);
    expect((await rowOf(handedOff)).recipient_id).toBeNull();
  });

  it("is skipped by the one statement that waits for a hand-off that holds the row, and then leaves it alone", async () => {
    const queue = createDeliveryQueue();
    const recipient = randomUUID();
    const claimed = await rowIn("claimed", { over: { recipient_kind: "subscriber", recipient_id: recipient } });
    let handOffHasLock: () => void = () => undefined;
    const locked = new Promise<void>((resolve) => (handOffHasLock = resolve));
    const handOff = app.transaction(async (tx) => {
      await tx.execute(drizzleSql`select id from delivery where id = ${claimed} for update`);
      handOffHasLock();
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.execute(drizzleSql`update delivery set handed_off_at = now() where id = ${claimed}`);
    });
    await locked;
    const skip = app.transaction((tx) => queue.skipRecipientDeliveries(tx, { kind: "subscriber", id: recipient }));
    const [, report] = await Promise.all([handOff, skip]);
    // The hand-off committed first: the text is in flight, so the skip leaves it and reports it.
    expect(report).toEqual({ skipped: 0, inFlight: 1 });
    expect(await stateOf(claimed)).toBe("claimed");
  });
});

// --- the ContactResolver --------------------------------------------------------------------------------

describe("the ContactResolver at the hand-off point", () => {
  /**
   * `inbound_reply`'s row, as subscriptions will hold it (S07.04): a number with no subscription, awaiting one reply. It carries
   * the trigger every recipient table carries, so deleting the row in the hand-off transaction forgets the recipient on the
   * delivery row that is being handed off (S07.04 attaches it in the migration that creates the table).
   */
  async function inboundReplyTable() {
    const name = `scratch_inbound_reply_${randomBytes(4).toString("hex")}`;
    await owner.unsafe(`create table ${name} (id uuid primary key, number text not null, expires_at timestamptz not null)`);
    await owner.unsafe(`grant select, insert, delete on ${name} to cvh_app`);
    await owner.unsafe(`grant update on ${name} to cvh_app`);
    await owner.unsafe(`create trigger ${name}_forget_deliveries after delete on ${name} for each row execute function delivery_forget_recipient('inbound_reply')`);
    scratchTables.push(name);
    return name;
  }
  const lines: { evt: string; fields: Record<string, unknown> }[] = [];
  const log: MessagingLog = {
    info: (evt, fields) => void lines.push({ evt, fields }),
    error: (evt, fields) => void lines.push({ evt, fields }),
  };

  beforeEach(() => {
    lines.length = 0;
  });

  /** The number source of a kind, over the scratch table: with `consume` it locks the row, reads the number and deletes the row. */
  const sourceOver = (table: string): RecipientNumberSource => ({
    async numberOf(tx, recipientId, { consume }) {
      const rows = await tx.execute<{ number: string }>(drizzleSql.raw(`select number from ${table} where id = '${recipientId}' for update`));
      const found = rows[0]?.number ?? null;
      if (found !== null && consume) await tx.execute(drizzleSql.raw(`delete from ${table} where id = '${recipientId}'`));
      return found;
    },
  });

  async function inboundReplyDelivery(replyId: string) {
    const id = await rowIn("claimed", {
      over: { recipient_kind: "inbound_reply", recipient_id: replyId, purpose: "signup_info", body: "Sign up at https://example.org/join. Reply STOP to stop." },
    });
    return id;
  }

  it("takes an inbound_reply number in the hand-off transaction: the row is deleted, and the number exists only in memory", async () => {
    const table = await inboundReplyTable();
    const replyId = randomUUID();
    await owner.unsafe(`insert into ${table} (id, number, expires_at) values ('${replyId}', '${FAKE_NUMBER}', now() + interval '30 minutes')`);
    const deliveryId = await inboundReplyDelivery(replyId);
    const resolver = createContactResolver({ sources: { inbound_reply: sourceOver(table) }, log });

    // The hand-off transaction: lock the delivery row, resolve the number, record the hand-off, commit.
    const heldInMemory = await app.transaction(async (tx) => {
      await tx.execute(drizzleSql`select id from delivery where id = ${deliveryId} for update`);
      const resolved = await resolver.resolve(tx, { deliveryId, kind: "inbound_reply", id: replyId });
      await tx.execute(drizzleSql`update delivery set handed_off_at = now() where id = ${deliveryId}`);
      return resolved;
    });

    expect(heldInMemory).toEqual({ found: true, number: FAKE_NUMBER });
    // Committed: the row is gone and the delivery is handed off, so a stop after this point sends nothing (unknown by lease expiry).
    expect(await owner.unsafe(`select 1 from ${table} where id = '${replyId}'`)).toHaveLength(0);
    expect((await rowOf(deliveryId)).handed_off_at).toBeInstanceOf(Date);
    // The number is in no table the delivery could put it in, and not in the log.
    const digits = FAKE_NUMBER.slice(1);
    expect(JSON.stringify(await owner`select * from delivery`)).not.toContain(digits);
    expect(JSON.stringify(lines)).not.toContain(digits);
    expect(lines).toEqual([
      { evt: "contact.resolved", fields: { module: "messaging", delivery_id: deliveryId, recipient_kind: "inbound_reply", number: maskForLog(FAKE_NUMBER), consumed: true } },
    ]);
    expect(lines[0].fields.number).toBe("+*********23");
    // A second hand-off finds the recipient gone.
    const again = await app.transaction((tx) => resolver.resolve(tx, { deliveryId, kind: "inbound_reply", id: replyId }));
    expect(again).toEqual({ found: false, reason: "recipient_gone" });
  });

  it("commits the hand-off even though taking the number forgets the recipient on the row being handed off, and that text is never retried", async () => {
    const table = await inboundReplyTable();
    const replyId = randomUUID();
    await owner.unsafe(`insert into ${table} (id, number, expires_at) values ('${replyId}', '${FAKE_NUMBER}', now() + interval '30 minutes')`);
    const deliveryId = await inboundReplyDelivery(replyId);
    const originalKey = (await rowOf(deliveryId)).idempotency_key as string;
    const resolver = createContactResolver({ sources: { inbound_reply: sourceOver(table) }, log });

    // The hand-off reads the delivery row's recipient BEFORE it takes the number: taking it (deleting the `inbound_reply` row)
    // runs the recipient table's trigger, which clears `recipient_id` on this very row inside this transaction.
    const resolved = await app.transaction(async (tx) => {
      const [locked] = await tx.execute<{ recipient_kind: string; recipient_id: string }>(
        drizzleSql`select recipient_kind, recipient_id from delivery where id = ${deliveryId} for update`,
      );
      expect(locked.recipient_id).toBe(replyId);
      const result = await resolver.resolve(tx, { deliveryId, kind: "inbound_reply", id: locked.recipient_id });
      await tx.execute(drizzleSql`update delivery set handed_off_at = now() where id = ${deliveryId}`);
      return result;
    });
    expect(resolved).toEqual({ found: true, number: FAKE_NUMBER });

    // The hand-off committed, and the row no longer names its recipient: its key is `detached:<id>`.
    const handedOff = await rowOf(deliveryId);
    expect(handedOff.state).toBe("claimed");
    expect(handedOff.handed_off_at).toBeInstanceOf(Date);
    expect(handedOff.recipient_id).toBeNull();
    expect(handedOff.idempotency_key).toBe(`detached:${deliveryId}`);
    // So the key it was created with is free while the text is in flight. A duplicate reply to one inbound message is stopped by
    // `inbound_seen` (S07.04), not by this key.
    await expect(asApp((tx) => insertRow(tx, transactionalRow({ purpose: "signup_info", recipient_kind: "inbound_reply", idempotency_key: originalKey })))).resolves.toBeDefined();
    // And if the provider then answers 429 and the row goes back to the queue, the next hand-off has no recipient to read a number
    // for: the text is skipped, never resent (the number was taken once, and is gone).
    await asApp((tx) => transitionStatement(tx, deliveryId, "queued"));
    const requeued = await rowOf(deliveryId);
    expect([requeued.state, requeued.attempts, requeued.recipient_id]).toEqual(["queued", 1, null]);
    expect(await app.transaction((tx) => resolver.resolve(tx, { deliveryId, kind: "inbound_reply", id: requeued.recipient_id }))).toEqual({ found: false, reason: "recipient_gone" });
  });

  it("keeps the row when the hand-off transaction does not commit: nothing was handed off and nothing is lost", async () => {
    const table = await inboundReplyTable();
    const replyId = randomUUID();
    await owner.unsafe(`insert into ${table} (id, number, expires_at) values ('${replyId}', '${FAKE_NUMBER}', now() + interval '30 minutes')`);
    const deliveryId = await inboundReplyDelivery(replyId);
    const resolver = createContactResolver({ sources: { inbound_reply: sourceOver(table) }, log });

    await expect(
      app.transaction(async (tx) => {
        await resolver.resolve(tx, { deliveryId, kind: "inbound_reply", id: replyId });
        throw new Error("the worker stopped before it committed the hand-off");
      }),
    ).rejects.toThrow(/stopped/);

    expect(await owner.unsafe(`select 1 from ${table} where id = '${replyId}'`)).toHaveLength(1);
    expect((await rowOf(deliveryId)).handed_off_at).toBeNull();
  });

  it("reads a roster or other number without taking it, and stores it nowhere", async () => {
    const table = await inboundReplyTable();
    const memberId = randomUUID();
    await owner.unsafe(`insert into ${table} (id, number, expires_at) values ('${memberId}', '${FAKE_NUMBER}', now() + interval '1 day')`);
    const resolver = createContactResolver({ sources: { roster: sourceOver(table) }, log });
    const first = await app.transaction((tx) => resolver.resolve(tx, { deliveryId: randomUUID(), kind: "roster", id: memberId }));
    const second = await app.transaction((tx) => resolver.resolve(tx, { deliveryId: randomUUID(), kind: "roster", id: memberId }));
    expect(first).toEqual({ found: true, number: FAKE_NUMBER });
    expect(second).toEqual(first);
    expect(lines.every((line) => line.fields.consumed === false)).toBe(true);
    expect(JSON.stringify(lines)).not.toContain(FAKE_NUMBER.slice(1));
  });

  it("reports a deleted recipient as gone, so the hand-off point skips the row", async () => {
    const table = await inboundReplyTable();
    const resolver = createContactResolver({ sources: { subscriber: sourceOver(table) }, log });
    expect(await app.transaction((tx) => resolver.resolve(tx, { deliveryId: randomUUID(), kind: "subscriber", id: randomUUID() }))).toEqual({ found: false, reason: "recipient_gone" });
    expect(await app.transaction((tx) => resolver.resolve(tx, { deliveryId: randomUUID(), kind: "subscriber", id: null }))).toEqual({ found: false, reason: "recipient_gone" });
  });
});

// A last guard: the suite above leaves no row behind for the next test file.
afterEach(() => {
  vi.restoreAllMocks();
});
