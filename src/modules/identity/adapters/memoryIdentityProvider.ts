import { randomUUID } from "node:crypto";
import type { CreateLoginError, IdentityProvider } from "../application/ports";

export interface MemoryLogin {
  login: string;
  password: string;
  authenticatorEnrolled: boolean;
}

/**
 * An in-memory IdentityProvider for tests (AD-24: external services only through fakes). Logins
 * are unique like Supabase Auth's; `failNext` makes the next createLogin fail, and `enrol` stands
 * in for S01.10's authenticator enrolment.
 */
export function memoryIdentityProvider() {
  const users = new Map<string, MemoryLogin>();
  /** What findLogin reports beyond MemoryLogin: when the user was made, and the staff marker createLogin sets. */
  const details = new Map<string, { createdAt: Date; staffMarker: boolean }>();
  let nextFailure: CreateLoginError | null = null;
  let failDeletes = false;

  const provider: IdentityProvider & {
    users: Map<string, MemoryLogin>;
    failNext(error: CreateLoginError): void;
    failDeletes(fail: boolean): void;
    enrol(authUserId: string): void;
    findByLogin(login: string): [string, MemoryLogin] | undefined;
    /** Adds a login as if left behind earlier (or made by someone else, with `staffMarker: false`). */
    plant(login: string, options?: { createdAt?: Date; staffMarker?: boolean }): string;
  } = {
    users,
    failNext(error) {
      nextFailure = error;
    },
    failDeletes(fail) {
      failDeletes = fail;
    },
    enrol(authUserId) {
      const user = users.get(authUserId);
      if (!user) throw new Error("No such auth user");
      user.authenticatorEnrolled = true;
    },
    findByLogin(login) {
      return [...users.entries()].find(([, user]) => user.login === login);
    },

    plant(login, options = {}) {
      const authUserId = randomUUID();
      users.set(authUserId, { login, password: "planted", authenticatorEnrolled: false });
      details.set(authUserId, { createdAt: options.createdAt ?? new Date(0), staffMarker: options.staffMarker ?? true });
      return authUserId;
    },

    async findLogin(login) {
      const found = [...users.entries()].find(([, user]) => user.login === login);
      const extra = found ? details.get(found[0]) : undefined;
      return found ? { authUserId: found[0], createdAt: extra?.createdAt ?? new Date(0), staffMarker: extra?.staffMarker ?? true } : null;
    },

    async createLogin({ login, password }) {
      if (nextFailure) {
        const error = nextFailure;
        nextFailure = null;
        return { ok: false, error };
      }
      if ([...users.values()].some((user) => user.login === login)) return { ok: false, error: "login_taken" };
      const authUserId = randomUUID();
      users.set(authUserId, { login, password, authenticatorEnrolled: false });
      details.set(authUserId, { createdAt: new Date(), staffMarker: true });
      return { ok: true, authUserId };
    },

    async deleteLogin(authUserId) {
      if (failDeletes) throw new Error("delete failed");
      users.delete(authUserId);
      details.delete(authUserId);
    },

    async hasVerifiedAuthenticator(authUserId) {
      return users.get(authUserId)?.authenticatorEnrolled ?? false;
    },
  };
  return provider;
}

export type MemoryIdentityProvider = ReturnType<typeof memoryIdentityProvider>;
