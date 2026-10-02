import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { AuthSessions, CookieJar, CreateLoginError, IdentityProvider, SetPasswordError } from "../application/ports";

export interface MemoryLogin {
  login: string;
  password: string;
  authenticatorEnrolled: boolean;
}

/** The fake's session cookie. Real sessions are Supabase's (supabaseAuthSessions.ts). */
export const MEMORY_SESSION_COOKIE = "cvh-fake-session";

/** What findLogin reports beyond MemoryLogin: when the user was made, and the staff marker createLogin sets. */
interface LoginDetails {
  createdAt: Date;
  staffMarker: boolean;
}

interface State {
  users: Map<string, MemoryLogin>;
  details: Map<string, LoginDetails>;
  /** Session token → auth user id. */
  sessions: Map<string, string>;
}

interface StoredState {
  users?: Record<string, MemoryLogin>;
  details?: Record<string, { createdAt: string; staffMarker: boolean }>;
  sessions?: Record<string, string>;
}

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const SESSION_OPTIONS = { path: "/", httpOnly: true, sameSite: "lax" as const };

/**
 * An in-memory IdentityProvider and AuthSessions for tests (AD-24: external services only through
 * fakes). Logins are unique like Supabase Auth's; `failNext` makes the next createLogin fail,
 * `failNextPassword` the next setPassword, `setUnavailable` every session call, and `enrol` stands
 * in for S01.10's authenticator enrolment. Sessions are random tokens in one httpOnly cookie.
 *
 * With `file`, the state lives in that JSON file instead of this process's memory, so a test runner
 * and a local server share it (the end-to-end tests). Never used outside tests and local
 * development: the environment check refuses CVH_FAKE_IDENTITY_FILE anywhere else.
 */
export function memoryIdentityProvider(options: { file?: string } = {}) {
  const memory: State = { users: new Map(), details: new Map(), sessions: new Map() };
  let nextFailure: CreateLoginError | null = null;
  let nextPasswordFailure: SetPasswordError | null = null;
  let failDeletes = false;
  let latency: { ms: number; fails: boolean } | null = null;
  /** Every call takes `latency.ms` first, then fails like the real adapter's timeout does (or answers, if `fails` is false). */
  const slow = async () => {
    if (!latency) return;
    await new Promise((resolve) => setTimeout(resolve, latency!.ms));
    if (latency.fails) throw new Error("identity provider timed out");
  };
  let unavailable = false;

  const load = (): State => {
    if (!options.file) return memory;
    let raw: StoredState = {};
    try {
      raw = JSON.parse(readFileSync(options.file, "utf8")) as StoredState;
    } catch {
      // No file yet: empty.
    }
    return {
      users: new Map(Object.entries(raw.users ?? {})),
      details: new Map(Object.entries(raw.details ?? {}).map(([id, d]) => [id, { createdAt: new Date(d.createdAt), staffMarker: d.staffMarker }])),
      sessions: new Map(Object.entries(raw.sessions ?? {})),
    };
  };
  const save = (state: State) => {
    if (!options.file) return;
    const stored: StoredState = {
      users: Object.fromEntries(state.users),
      details: Object.fromEntries([...state.details].map(([id, d]) => [id, { createdAt: d.createdAt.toISOString(), staffMarker: d.staffMarker }])),
      sessions: Object.fromEntries(state.sessions),
    };
    const temporary = `${options.file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(stored));
    renameSync(temporary, options.file);
  };
  const change = <T>(edit: (state: State) => T): T => {
    const state = load();
    const result = edit(state);
    save(state);
    return result;
  };

  function sessions(jar: CookieJar): AuthSessions {
    const token = () => jar.getAll().find((cookie) => cookie.name === MEMORY_SESSION_COOKIE)?.value ?? null;
    return {
      async checkPassword({ login, password }) {
        if (unavailable) return { ok: false, error: "unavailable" };
        const found = [...load().users.entries()].find(([, user]) => user.login === login);
        if (!found || !sameText(found[1].password, password)) return { ok: false, error: "invalid_credentials" };
        const [authUserId] = found;
        const opened = randomBytes(24).toString("hex");
        change((state) => state.sessions.set(opened, authUserId));
        return {
          ok: true,
          authUserId,
          async accept() {
            jar.setAll([{ name: MEMORY_SESSION_COOKIE, value: opened, options: { ...SESSION_OPTIONS, maxAge: 12 * 60 * 60 } }]);
          },
          async discard() {
            change((state) => state.sessions.delete(opened));
          },
        };
      },
      async currentUser() {
        if (unavailable) throw new Error("identity provider unavailable");
        const value = token();
        if (!value) return null;
        const state = load();
        const authUserId = state.sessions.get(value);
        const user = authUserId ? state.users.get(authUserId) : undefined;
        if (!authUserId || !user) return null;
        return { authUserId, authenticatorEnrolled: user.authenticatorEnrolled };
      },
      async signOut() {
        const value = token();
        if (value) change((state) => state.sessions.delete(value));
        jar.setAll([{ name: MEMORY_SESSION_COOKIE, value: "", options: { ...SESSION_OPTIONS, maxAge: 0 } }]);
      },
    };
  }

  const provider: IdentityProvider & {
    readonly users: Map<string, MemoryLogin>;
    /** Open sessions: token → auth user id. */
    readonly sessionTokens: Map<string, string>;
    failNext(error: CreateLoginError): void;
    failNextPassword(error: SetPasswordError): void;
    failDeletes(fail: boolean): void;
    setUnavailable(down: boolean): void;
    /** Simulates a slow or hanging provider: each call waits `ms`, then times out (`fails`, the default) or answers. `null` ends it. */
    delay(ms: number | null, options?: { fails?: boolean }): void;
    enrol(authUserId: string): void;
    findByLogin(login: string): [string, MemoryLogin] | undefined;
    /** Adds a login as if left behind earlier (or made by someone else, with `staffMarker: false`). */
    plant(login: string, options?: { createdAt?: Date; staffMarker?: boolean; password?: string }): string;
    sessions(jar: CookieJar): AuthSessions;
  } = {
    get users() {
      return load().users;
    },
    get sessionTokens() {
      return load().sessions;
    },
    failNext(error) {
      nextFailure = error;
    },
    failNextPassword(error) {
      nextPasswordFailure = error;
    },
    failDeletes(fail) {
      failDeletes = fail;
    },
    setUnavailable(down) {
      unavailable = down;
    },
    delay(ms, options = {}) {
      latency = ms === null ? null : { ms, fails: options.fails ?? true };
    },
    enrol(authUserId) {
      change((state) => {
        const user = state.users.get(authUserId);
        if (!user) throw new Error("No such auth user");
        user.authenticatorEnrolled = true;
      });
    },
    findByLogin(login) {
      return [...load().users.entries()].find(([, user]) => user.login === login);
    },
    plant(login, plantOptions = {}) {
      const authUserId = randomUUID();
      change((state) => {
        state.users.set(authUserId, { login, password: plantOptions.password ?? "planted", authenticatorEnrolled: false });
        state.details.set(authUserId, { createdAt: plantOptions.createdAt ?? new Date(0), staffMarker: plantOptions.staffMarker ?? true });
      });
      return authUserId;
    },
    sessions,

    async findLogin(login) {
      await slow();
      const state = load();
      const found = [...state.users.entries()].find(([, user]) => user.login === login);
      if (!found) return null;
      const extra = state.details.get(found[0]);
      return { authUserId: found[0], createdAt: extra?.createdAt ?? new Date(0), staffMarker: extra?.staffMarker ?? true };
    },

    async createLogin({ login, password }) {
      try {
        await slow();
      } catch {
        return { ok: false, error: "unavailable" };
      }
      if (nextFailure) {
        const error = nextFailure;
        nextFailure = null;
        return { ok: false, error };
      }
      return change((state) => {
        if ([...state.users.values()].some((user) => user.login === login)) return { ok: false as const, error: "login_taken" as const };
        const authUserId = randomUUID();
        state.users.set(authUserId, { login, password, authenticatorEnrolled: false });
        state.details.set(authUserId, { createdAt: new Date(), staffMarker: true });
        return { ok: true as const, authUserId };
      });
    },

    async deleteLogin(authUserId) {
      await slow();
      if (failDeletes) throw new Error("delete failed");
      change((state) => {
        state.users.delete(authUserId);
        state.details.delete(authUserId);
        for (const [token, owner] of state.sessions) if (owner === authUserId) state.sessions.delete(token);
      });
    },

    async hasVerifiedAuthenticator(authUserId) {
      await slow();
      return load().users.get(authUserId)?.authenticatorEnrolled ?? false;
    },

    async setPassword(authUserId, password) {
      try {
        await slow();
      } catch {
        return { ok: false, error: "unavailable" };
      }
      if (nextPasswordFailure) {
        const error = nextPasswordFailure;
        nextPasswordFailure = null;
        return { ok: false, error };
      }
      return change((state) => {
        const user = state.users.get(authUserId);
        if (!user) return { ok: false as const, error: "rejected" as const };
        user.password = password;
        return { ok: true as const };
      });
    },
  };
  return provider;
}

export type MemoryIdentityProvider = ReturnType<typeof memoryIdentityProvider>;
