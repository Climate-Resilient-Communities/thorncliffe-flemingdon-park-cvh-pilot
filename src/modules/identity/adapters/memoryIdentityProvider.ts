import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import type { AuthSessions, CookieJar, CreateLoginError, IdentityProvider, SetPasswordError } from "../application/ports";
import { memoryTotpSecret, totpMatches } from "./memoryTotp";

/** A TOTP factor of the fake: its secret is memoryTotpSecret(auth user id), so tests can type its codes. */
export interface MemoryFactor {
  id: string;
  status: "unverified" | "verified";
  secret: string;
}

export interface MemoryLogin {
  login: string;
  password: string;
  /** True when the user has a verified TOTP factor (kept in step with `factors`). */
  authenticatorEnrolled: boolean;
  /** The user's TOTP factors (S01.10); missing means none beyond what authenticatorEnrolled says. */
  factors?: MemoryFactor[];
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
  /** Session tokens raised to aal2 (a code was accepted for that session). */
  aal2: Set<string>;
}

interface StoredState {
  users?: Record<string, MemoryLogin>;
  details?: Record<string, { createdAt: string; staffMarker: boolean }>;
  sessions?: Record<string, string>;
  aal2?: string[];
}

const sameText = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

const SESSION_OPTIONS = { path: "/", httpOnly: true, sameSite: "lax" as const };

/** The fake's session key: the SHA-256 of its token, as the real adapter hashes a session_id. */
const keyOf = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * An in-memory IdentityProvider and AuthSessions for tests (AD-24: external services only through
 * fakes). Logins are unique like Supabase Auth's; `failNext` makes the next createLogin fail,
 * `failNextPassword` the next setPassword, `setUnavailable` every session call. Sessions are
 * random tokens in one httpOnly cookie.
 *
 * Authenticators (S01.10) are TOTP factors checked with RFC 6238 (memoryTotp.ts); each user's
 * secret is memoryTotpSecret(auth user id), so a test types the right code with totpCode(secret).
 * `enrol` gives a user a verified factor directly (a finished enrolment); `raiseOutsideApp` raises
 * a session to aal2 the way a code checked at the provider directly, outside the app, would.
 *
 * Like Supabase Auth it stores whatever password the adapter is given (the app sends the peppered
 * form), `setPassword` ends every session of the user, and `grant` is a password grant made
 * directly at the provider, as anyone with the public key can: it opens a session the app never
 * saw, to put in a cookie by hand.
 *
 * With `file`, the state lives in that JSON file instead of this process's memory, so a test runner
 * and a local server share it (the end-to-end tests). Never used outside tests and local
 * development: the environment check refuses CVH_FAKE_IDENTITY_FILE anywhere else.
 */
export function memoryIdentityProvider(options: { file?: string } = {}) {
  const memory: State = { users: new Map(), details: new Map(), sessions: new Map(), aal2: new Set() };
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
  let tokenLifetimeSeconds: number | null = 12 * 60 * 60;

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
      aal2: new Set(raw.aal2 ?? []),
    };
  };
  const save = (state: State) => {
    if (!options.file) return;
    const stored: StoredState = {
      users: Object.fromEntries(state.users),
      details: Object.fromEntries([...state.details].map(([id, d]) => [id, { createdAt: d.createdAt.toISOString(), staffMarker: d.staffMarker }])),
      sessions: Object.fromEntries(state.sessions),
      aal2: [...state.aal2],
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
          sessionKey: keyOf(opened),
          tokenLifetimeSeconds,
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
        return { authUserId, authenticatorEnrolled: user.authenticatorEnrolled, sessionKey: keyOf(value), aal: state.aal2.has(value) ? "aal2" : "aal1" };
      },
      async signOut() {
        const value = token();
        if (value)
          change((state) => {
            state.sessions.delete(value);
            state.aal2.delete(value);
          });
        jar.setAll([{ name: MEMORY_SESSION_COOKIE, value: "", options: { ...SESSION_OPTIONS, maxAge: 0 } }]);
      },
      async enrolFactor({ issuer, accountName }) {
        if (unavailable) return { ok: false, error: "unavailable" };
        const value = token();
        return change((state) => {
          const authUserId = value ? state.sessions.get(value) : undefined;
          const user = authUserId ? state.users.get(authUserId) : undefined;
          if (!value || !authUserId || !user) return { ok: false as const, error: "rejected" as const };
          // Like Supabase Auth: with a verified factor, a new one needs an aal2 session.
          if (user.authenticatorEnrolled && !state.aal2.has(value)) return { ok: false as const, error: "rejected" as const };
          const secret = memoryTotpSecret(authUserId);
          user.factors = [...factorsOf(user, authUserId), { id: randomUUID(), status: "unverified", secret }];
          const label = encodeURIComponent(`${issuer}:${accountName}`);
          const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
          return { ok: true as const, enrolment: { secret, uri, qrCode: null } };
        });
      },
      async verifyFactor({ code, factor }) {
        if (unavailable) return { ok: false, error: "unavailable" };
        const value = token();
        return change((state) => {
          const authUserId = value ? state.sessions.get(value) : undefined;
          const user = authUserId ? state.users.get(authUserId) : undefined;
          if (!value || !authUserId || !user) return { ok: false as const, error: "no_factor" as const };
          const target = factorsOf(user, authUserId)
            .filter((candidate) => candidate.status === factor)
            .at(-1);
          if (!target) return { ok: false as const, error: "no_factor" as const };
          if (!totpMatches(target.secret, code)) return { ok: false as const, error: "invalid_code" as const };
          target.status = "verified";
          // A verified factor replaces the enrolment's leftovers, as Supabase removes unverified factors.
          user.factors = factorsOf(user, authUserId).filter((candidate) => candidate === target || candidate.status === "verified");
          user.authenticatorEnrolled = true;
          state.aal2.add(value);
          return { ok: true as const, sessionKey: keyOf(value), aal: "aal2" as const, accept: async () => undefined };
        });
      },
    };
  }

  /** A user's factors, with the one `authenticatorEnrolled` stands for when a test set only the flag. */
  function factorsOf(user: MemoryLogin, authUserId: string): MemoryFactor[] {
    if (!user.factors) user.factors = user.authenticatorEnrolled ? [{ id: randomUUID(), status: "verified", secret: memoryTotpSecret(authUserId) }] : [];
    return user.factors;
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
    /** Gives the user a verified TOTP factor (secret: memoryTotpSecret(authUserId)), as a finished enrolment would. */
    enrol(authUserId: string): void;
    /** The secret of the user's TOTP factors (deterministic: memoryTotpSecret). */
    totpSecret(authUserId: string): string;
    /** Raises a session to aal2 at the provider directly, as a code checked outside the app would. */
    raiseOutsideApp(sessionToken: string): void;
    /** The access token's lifetime (`exp - iat`) of the sessions opened from now on; null for a token without one. */
    setTokenLifetime(seconds: number | null): void;
    /** A password grant made directly at the provider: the new session's cookie value, or null when the password is wrong. */
    grant(login: string, password: string): string | null;
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
    setTokenLifetime(seconds) {
      tokenLifetimeSeconds = seconds;
    },
    grant(login, password) {
      const found = [...load().users.entries()].find(([, user]) => user.login === login);
      if (!found || !sameText(found[1].password, password)) return null;
      const opened = randomBytes(24).toString("hex");
      change((state) => state.sessions.set(opened, found[0]));
      return opened;
    },
    enrol(authUserId) {
      change((state) => {
        const user = state.users.get(authUserId);
        if (!user) throw new Error("No such auth user");
        user.factors = [{ id: randomUUID(), status: "verified", secret: memoryTotpSecret(authUserId) }];
        user.authenticatorEnrolled = true;
      });
    },
    totpSecret(authUserId) {
      return memoryTotpSecret(authUserId);
    },
    raiseOutsideApp(sessionToken) {
      change((state) => {
        if (!state.sessions.has(sessionToken)) throw new Error("No such session");
        state.aal2.add(sessionToken);
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

    async removeFactors(authUserId) {
      await slow();
      if (unavailable) throw new Error("identity provider unavailable");
      change((state) => {
        const user = state.users.get(authUserId);
        if (!user) return;
        user.factors = [];
        user.authenticatorEnrolled = false;
        // The user's sessions lose the level the factor gave them.
        for (const [token, owner] of state.sessions) if (owner === authUserId) state.aal2.delete(token);
      });
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
        // Supabase's admin password update signs the user out everywhere.
        for (const [token, owner] of state.sessions) if (owner === authUserId) state.sessions.delete(token);
        return { ok: true as const };
      });
    },
  };
  return provider;
}

export type MemoryIdentityProvider = ReturnType<typeof memoryIdentityProvider>;
