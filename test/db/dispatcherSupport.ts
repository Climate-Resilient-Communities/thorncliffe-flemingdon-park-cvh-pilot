// Support for the sender's tests against a real database (S06.02): a fake clock that jumps instead of waiting, a fake provider that
// records every call, a fake resolver, deliveries seeded as the app's role, and the dispatcher wired to the real store and the real
// tables. Nothing here reaches Twilio or any real provider, and every phone number is obviously fake.
import { randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { opsRecorder } from "../../src/app/dispatch";
import { alertStandingReader } from "../../src/modules/alerting";
import {
  createDispatcher,
  drizzleDispatchStore,
  type ContactResolver,
  type DispatchStore,
  type Dispatcher,
  type DispatcherClock,
  type DispatcherConfig,
  type DispatcherDeps,
  type MessageSubmission,
  type MessagingLog,
  type SubmitAnswer,
} from "../../src/modules/messaging";
import type { Db } from "../../src/platform/db";
import { uuidv7 } from "../../src/platform/ids";
import { deliveryFixtures, DEFAULT_BODIES, type FrozenBodies, type SeededEntry, type Tx } from "./deliveryFixtures";

type Sql = postgres.Sql;
export type Row = Record<string, unknown>;

export const SERVICE_SID = `MG${"1".repeat(32)}`;
export const BASE_URL = "https://cvh.example";

/** The message id the fake provider gives its n-th acceptance. */
export const sidOf = (n: number) => `SM${n.toString(16).padStart(32, "0")}`;

/** A fake E.164 number for a recipient id (obviously not a real one: the 555 exchange). */
export const numberOf = (id: string) => `+1416555${String(Number.parseInt(id.replaceAll("-", "").slice(-4), 16) % 10_000).padStart(4, "0")}`;

// --- the clock ------------------------------------------------------------------------------------------

export interface FakeClock extends DispatcherClock {
  /** The fake time in milliseconds. */
  ms(): number;
  advance(ms: number): void;
  /** Every sleep the dispatcher asked for. */
  readonly sleeps: number[];
}

/**
 * A clock that runs with the real one and jumps: `sleep` and `advance` move it forward at once, so a stall of a minute is one
 * `advance`, not a minute of waiting, and rows made a moment ago are never "in the future". `skewMs` is its distance from the
 * database's clock (the whole of what it has jumped), so every decision the database makes with `now()` (the lease, a claim's age, a
 * backoff, a `send_by`) follows it.
 */
export function fakeClock(startMs: number = Date.now()): FakeClock {
  let offset = startMs - Date.now();
  const sleeps: number[] = [];
  return {
    now: () => new Date(Date.now() + offset),
    ms: () => Date.now() + offset,
    advance: (ms) => void (offset += ms),
    async sleep(ms) {
      sleeps.push(ms);
      offset += ms;
      await Promise.resolve();
    },
    skewMs: () => offset,
    sleeps,
  };
}

// --- the provider ----------------------------------------------------------------------------------------

export interface ProviderCall extends MessageSubmission {
  /** The fake clock's time when the call was made. */
  at: number;
}

export type Answerer = SubmitAnswer | ((submission: MessageSubmission, callNumber: number) => SubmitAnswer | Promise<SubmitAnswer>);

/** A provider that records every call and answers as told (acceptance with a new message id by default). Never touches a network. */
export function fakeProvider(clock: FakeClock, initial?: Answerer) {
  const calls: ProviderCall[] = [];
  let answerer: Answerer | undefined = initial;
  return {
    calls,
    answer(next: Answerer | undefined) {
      answerer = next;
    },
    async submit(submission: MessageSubmission): Promise<SubmitAnswer> {
      calls.push({ ...submission, at: clock.ms() });
      const callNumber = calls.length;
      if (answerer === undefined) return { kind: "accepted", httpStatus: 201, status: "queued", messageId: sidOf(callNumber) };
      return typeof answerer === "function" ? answerer(submission, callNumber) : answerer;
    },
  };
}

// --- the resolver ----------------------------------------------------------------------------------------

/** A resolver that gives every recipient a fake number, and says who is gone; it records what it was asked. */
export function fakeResolver(options: { gone?: Set<string>; onResolve?: () => Promise<void> } = {}) {
  const gone = options.gone ?? new Set<string>();
  const asked: { deliveryId: string; kind: string; id: string | null; deliveryKind?: string; purpose?: string | null }[] = [];
  const resolver: ContactResolver = {
    async resolve(_tx, recipient) {
      asked.push({ deliveryId: recipient.deliveryId, kind: recipient.kind, id: recipient.id, deliveryKind: recipient.deliveryKind, purpose: recipient.purpose });
      await options.onResolve?.();
      if (recipient.id === null || gone.has(recipient.id)) return { found: false, reason: "recipient_gone" };
      return { found: true, number: numberOf(recipient.id) };
    },
  };
  return { resolver, asked, gone };
}

// --- the world --------------------------------------------------------------------------------------------

export interface LogLine {
  level: "info" | "error";
  evt: string;
  fields: Record<string, unknown>;
}

export function dispatcherWorld(owner: Sql, appSql: Sql, app: Db) {
  const fx = deliveryFixtures(owner);
  const lines: LogLine[] = [];
  const log: MessagingLog = {
    info: (evt, fields) => void lines.push({ level: "info", evt, fields }),
    error: (evt, fields) => void lines.push({ level: "error", evt, fields }),
  };
  const clock = fakeClock();
  let provider = fakeProvider(clock);
  let resolver = fakeResolver();
  const worldClock = { current: clock };

  /** Every row of `delivery` and everything the dispatcher could have written elsewhere, as one string (to search for what must never be there). */
  async function everythingStored(): Promise<string> {
    const deliveries = await owner`select * from delivery`;
    const events = await owner`select * from ops_event`;
    const lease = await owner`select * from dispatcher_lease`;
    return JSON.stringify({ deliveries, events, lease });
  }

  async function reset() {
    // The pause names a staff account, so it is cleared before the fixtures delete theirs.
    await owner`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null where id = 1`;
    await fx.cleanup();
    await owner`update dispatcher_lease set token = gen_random_uuid(), holder = 'none', expires_at = to_timestamp(0), renewed_at = to_timestamp(0), paced_until = to_timestamp(0) where id = 1`;
    await owner`delete from ops_event where kind in ('delivery.unknown', 'dispatch.provider_auth_failed', 'messaging.smart_encoding_on', 'messaging.service_check_failed',
                 'delivery.unknown_resolved', 'delivery.callback_ignored', 'delivery.provider_id_mismatch', 'webhook.signature_invalid')`;
    lines.length = 0;
    worldClock.current = fakeClock();
    provider = fakeProvider(worldClock.current);
    resolver = fakeResolver();
  }

  /** The dispatcher on the real tables, the fake clock, provider and resolver (every part can be replaced). */
  function dispatcher(over: Partial<Omit<DispatcherDeps, "store" | "config">> & { store?: DispatchStore; config?: DispatcherConfig } = {}): Dispatcher {
    const { store, config, ...rest } = over;
    return createDispatcher({
      db: app,
      store: store ?? drizzleDispatchStore,
      resolver: resolver.resolver,
      alerts: alertStandingReader,
      ops: opsRecorder,
      log,
      clock: worldClock.current,
      config: config ?? { mode: "live", submitter: provider, messagingServiceSid: SERVICE_SID, publicBaseUrl: BASE_URL },
      ...rest,
    });
  }

  // --- seeding, as the app's role ---

  async function transactionalRow(over: Row = {}): Promise<string> {
    const id = (over.id as string | undefined) ?? uuidv7();
    const purpose = (over.purpose as string | undefined) ?? "menu_reply";
    const row: Row = {
      id,
      kind: "transactional",
      recipient_kind: "subscriber",
      recipient_id: randomUUID(),
      created_by_module: "subscriptions",
      purpose,
      lang: "en",
      body: `Text ${id.slice(-6)}. Reply STOP`,
      segments: 1,
      cost_estimate_cents: 2,
      ...over,
    };
    row.idempotency_key ??= `transactional:${randomUUID()}:${purpose}:${randomUUID()}`;
    const columns = Object.keys(row);
    const params: unknown[] = [];
    const values = columns.map((column) => {
      const value = row[column];
      params.push(value);
      return `$${params.length}`;
    });
    // send_by: the purpose's own window from the database's now() unless given.
    const withSendBy = row.send_by === undefined;
    await appSql.unsafe(
      `insert into delivery (${columns.join(", ")}${withSendBy ? ", send_by" : ""}) values (${values.join(", ")}${withSendBy ? ", now() + interval '20 minutes'" : ""})`,
      params as never[],
    );
    return id;
  }

  /** `count` transactional texts, each in its own transaction so each is older than the next (the claim order's last key). */
  async function seedTransactional(count: number, over: Row | ((index: number) => Row) = {}): Promise<string[]> {
    const ids: string[] = [];
    for (let index = 0; index < count; index += 1) ids.push(await transactionalRow(typeof over === "function" ? over(index) : over));
    return ids;
  }

  interface AlertOptions {
    types?: string[];
    scope?: "neighbourhood" | "buildings";
    kind?: "ack" | "update" | "correction" | "withdrawal" | "final";
    isDrill?: boolean;
    /** Recipients: a count of subscribers (or roster members for a drill), or the exact ids. */
    recipients?: number | string[];
    recipientKind?: "subscriber" | "roster";
    bodies?: FrozenBodies;
    validUntil?: Date;
    /** Closes the thread in the approving transaction (the entry is then the closing entry). */
    closes?: boolean;
  }

  /** An entry approved by the transaction that writes its deliveries (the approval's shape, S04.07), and the ids of those deliveries. */
  async function seedAlert(options: AlertOptions = {}): Promise<{ entry: SeededEntry; ids: string[]; recipients: string[] }> {
    const entry = await fx.entry("pending_approval", {
      isDrill: options.isDrill,
      types: options.types,
      scope: options.scope,
      kind: options.kind,
      bodies: options.bodies,
      validUntil: options.validUntil,
    });
    const recipients = Array.isArray(options.recipients) ? options.recipients : Array.from({ length: options.recipients ?? 1 }, () => randomUUID());
    const recipientKind = options.recipientKind ?? (options.isDrill ? "roster" : "subscriber");
    const bodies = options.bodies ?? DEFAULT_BODIES;
    const ids: string[] = [];
    await appSql.begin(async (tx: Tx) => {
      await tx`select set_config('cvh.approval_entry_id', ${entry.entryId}, true)`;
      for (const recipient of recipients) {
        const id = uuidv7();
        ids.push(id);
        await tx`insert into delivery (id, kind, recipient_kind, recipient_id, entry_id, created_by_module, lang, body, segments, cost_estimate_cents, idempotency_key)
                 values (${id}, 'alert', ${recipientKind}, ${recipient}, ${entry.entryId}, 'alerting', 'en', ${bodies.en.body}, ${bodies.en.segments}, 4, ${`${entry.entryId}:${recipient}:sms`})`;
      }
      await fx.approve(tx, entry);
      if (options.closes) await tx`update alert set status = 'closed', closed_reason = 'resolved', closed_at = now() where id = ${entry.alertId}`;
    });
    return { entry, ids, recipients };
  }

  // --- reading ---

  const rowOf = async (id: string): Promise<Row> => (await owner`select * from delivery where id = ${id}`)[0] as Row;
  const stateOf = async (id: string) => (await rowOf(id)).state as string;
  const statesOf = async (ids: string[]) => Object.fromEntries((await owner`select id, state from delivery where id = any(${ids})`).map((row) => [row.id as string, row.state as string]));
  const opsEvents = async (kind: string) => (await owner`select kind, severity, subject_type, subject_id, detail from ops_event where kind = ${kind} order by id`) as unknown as Row[];

  /** Pauses (with who, when and why, as S06.06's use case will) or resumes, as the owner: this story only reads the switch. */
  async function setPause(on: boolean) {
    if (!on) {
      await owner`update messaging_control set paused = false, paused_by = null, paused_at = null, reason = null where id = 1`;
      return;
    }
    const admin = await fx.staff("admin");
    await owner`update messaging_control set paused = true, paused_by = ${admin.id}, paused_at = now(), reason = 'test pause' where id = 1`;
  }

  /** Waits until some statement is waiting for a lock (the hand-off, or a change, waiting for the other to commit). */
  async function untilSomeoneWaitsForALock(timeoutMs = 10_000) {
    const started = Date.now();
    for (;;) {
      const [waiting] = await owner`select count(*)::int as n from pg_locks where not granted`;
      if (waiting.n > 0) return;
      if (Date.now() - started > timeoutMs) throw new Error("nobody waited for a lock");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** Waits until a condition holds (polling), for events in another connection. */
  async function until(condition: () => boolean | Promise<boolean>, what: string, timeoutMs = 10_000) {
    const started = Date.now();
    while (!(await condition())) {
      if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  return {
    fx,
    lines,
    log,
    get clock() {
      return worldClock.current;
    },
    get provider() {
      return provider;
    },
    get resolver() {
      return resolver;
    },
    useProvider(next: ReturnType<typeof fakeProvider>) {
      provider = next;
    },
    useResolver(next: ReturnType<typeof fakeResolver>) {
      resolver = next;
    },
    reset,
    dispatcher,
    transactionalRow,
    seedTransactional,
    seedAlert,
    rowOf,
    stateOf,
    statesOf,
    opsEvents,
    setPause,
    everythingStored,
    untilSomeoneWaitsForALock,
    until,
  };
}

export type DispatcherWorld = ReturnType<typeof dispatcherWorld>;

/** A promise that is resolved from outside, to hold a worker at a chosen point. */
export function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** A fresh random id helper for tests that need many distinct recipients. */
export const newId = () => randomUUID();
export const hex = (bytes = 4) => randomBytes(bytes).toString("hex");
