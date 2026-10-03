import { describe, expect, it } from "vitest";
import { z } from "zod";
import { isSafeError } from "@/contracts/safeError";
import { SafeDetailError, classifyError, sanitisePath, schemaFailure } from "./safeError";

/** An error that throws if anything but its `name` and `code` is read from it: the message, the query and its parameters are not. */
function tripwire(parts: { name?: string; code?: string; cause?: unknown } = {}, extra: string[] = []): Error {
  const error = new Error("never read");
  Object.defineProperty(error, "message", {
    get() {
      throw new Error("the message was read");
    },
  });
  for (const key of extra) {
    Object.defineProperty(error, key, {
      enumerable: true,
      get() {
        throw new Error(`${key} was read`);
      },
    });
  }
  if (parts.name !== undefined) error.name = parts.name;
  if (parts.code !== undefined) Object.assign(error, { code: parts.code });
  if (parts.cause !== undefined) Object.assign(error, { cause: parts.cause });
  return error;
}

describe("classifyError", () => {
  it("names the first issue path of a failed parse, never its content", () => {
    const result = z.strictObject({ providers: z.array(z.strictObject({ neighbourhood_ids: z.array(z.string()) })) }).safeParse({ providers: [{}] });
    expect(result.success).toBe(false);
    expect(classifyError(result.error)).toBe("schema:providers.0.neighbourhood_ids");
  });

  it("prefers a safeDetail, then a SQLSTATE, then a constant code, then the class name, then unknown", () => {
    expect(classifyError(new SafeDetailError("listing_schema:providers.0.name"))).toBe("listing_schema:providers.0.name");
    expect(classifyError(Object.assign(new Error("permission denied for 203.0.113.9"), { code: "42501" }))).toBe("42501");
    expect(classifyError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("ECONNREFUSED");
    expect(classifyError(new TypeError("secret"))).toBe("TypeError");
    expect(classifyError("a string")).toBe("unknown");
    expect(classifyError(null)).toBe("unknown");
    expect(classifyError(Object.create(null))).toBe("unknown");
  });

  it("finds the SQLSTATE of the error drizzle wraps a failed query in, and never uses the wrapper's message (the query and its parameters)", () => {
    const stopped = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    class DrizzleQueryError extends Error {}
    const wrapped = Object.assign(new DrizzleQueryError("Failed query: insert into rate_limit values ($1)\nparams: 203.0.113.9"), { cause: stopped });

    expect(classifyError(wrapped)).toBe("57014");
    expect(classifyError(Object.assign(new DrizzleQueryError("Failed query: x"), { cause: new TypeError("no code") }))).toBe("DrizzleQueryError");
    expect(classifyError(Object.assign(new DrizzleQueryError("Failed query: x"), { cause: undefined }))).toBe("DrizzleQueryError");
    // A cause that points back at its error does not loop, and one buried deeper than a wrapper or two is not searched for.
    const loop: { cause?: unknown } = new Error("loop");
    loop.cause = loop;
    expect(classifyError(loop)).toBe("Error");
    const deep = Object.assign(new Error("a"), { cause: Object.assign(new Error("b"), { cause: Object.assign(new Error("c"), { cause: stopped }) }) });
    expect(classifyError(deep)).toBe("Error");
  });

  describe("in a production build, where classes are renamed", () => {
    it("tells the class by the name the error sets, not by the name of its constructor (`class mu extends Error`)", () => {
      // What `next build` makes of `class QueryEmbedError extends Error { name = "QueryEmbedError" }`.
      const mu = class mu extends Error {
        override name = "QueryEmbedError";
      };
      const a = class a extends Error {
        constructor() {
          super("x");
          this.name = "EnvError";
        }
      };

      expect(mu.name).toBe("mu");
      expect(classifyError(new mu("secret"))).toBe("QueryEmbedError");
      expect(classifyError(new a())).toBe("EnvError");
      expect(classifyError(new DOMException("nobody asked", "AbortError"))).toBe("AbortError");
    });

    it("falls back to the constructor's name only for an error that sets no name, and ignores a name that is not a name", () => {
      class Unnamed extends Error {}
      class Weird extends Error {
        override name = "has a space";
      }
      class Plain extends Error {
        override name = "Error";
      }

      expect(classifyError(new Unnamed("x"))).toBe("Unnamed");
      expect(classifyError(new Weird("x"))).toBe("Weird");
      expect(classifyError(new Plain("x"))).toBe("Plain");
      expect(classifyError(new Error("x"))).toBe("Error");
    });

    it("recognises the error drizzle wraps a failed query in by its shape, whatever its class was renamed to, without reading the query or its parameters", () => {
      const wrapper = tripwire({}, ["query", "params"]);
      const renamed = new (class a extends Error {})("Failed query: select 1\nparams: 203.0.113.9");
      Object.assign(renamed, { query: "select 1", params: ["203.0.113.9"] });

      expect(classifyError(wrapper)).toBe("DrizzleQueryError");
      expect(classifyError(renamed)).toBe("DrizzleQueryError");
      expect(classifyError(Object.assign(new Error("x"), { query: "select 1" }))).toBe("Error"); // not the shape: no parameters
    });

    it("tells the code of a connection error that has no SQLSTATE, from the error or from the one it wraps", () => {
      const refused = Object.assign(new Error("connect ECONNREFUSED 203.0.113.9:5432"), { code: "ECONNREFUSED", address: "203.0.113.9", port: 5432 });
      const timeout = Object.assign(new Error("write CONNECT_TIMEOUT 203.0.113.9:5432"), { code: "CONNECT_TIMEOUT", errno: "CONNECT_TIMEOUT", address: "203.0.113.9" });
      const wrapper = (cause: unknown) => Object.assign(new Error("Failed query: select 1"), { query: "select 1", params: [], cause });
      const fetchFailed = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect timeout"), { code: "UND_ERR_CONNECT_TIMEOUT" }) });

      expect(classifyError(refused)).toBe("ECONNREFUSED");
      expect(classifyError(timeout)).toBe("CONNECT_TIMEOUT");
      expect(classifyError(wrapper(timeout))).toBe("CONNECT_TIMEOUT");
      expect(classifyError(wrapper(refused))).toBe("ECONNREFUSED");
      expect(classifyError(fetchFailed)).toBe("UND_ERR_CONNECT_TIMEOUT");
      // A SQLSTATE beats a constant code, wherever each is.
      expect(classifyError(Object.assign(new Error("x"), { code: "ECONNRESET", cause: Object.assign(new Error("y"), { code: "57014" }) }))).toBe("57014");
    });

    it("ignores a code that is not a constant (lowercase, a number, free text) and falls back to the name", () => {
      for (const code of ["connection refused at 203.0.113.9", "econnrefused", "E", "SOME_CODE_THAT_IS_FAR_TOO_LONG_TO_BE_A_CONSTANT_CODE_X"]) {
        expect(classifyError(Object.assign(new TypeError("x"), { code }))).toBe("TypeError");
      }
      expect(classifyError(Object.assign(new TypeError("x"), { code: 503 }))).toBe("TypeError");
    });

    it("reads only the name and the code of an error, never its message", () => {
      expect(classifyError(tripwire({ name: "StorageApiError" }))).toBe("StorageApiError");
      expect(classifyError(tripwire({ code: "42501" }))).toBe("42501");
      expect(classifyError(tripwire({ cause: tripwire({ code: "ECONNREFUSED" }) }))).toBe("ECONNREFUSED");
    });
  });

  it("ignores an unsafe safeDetail", () => {
    expect(classifyError(Object.assign(new Error("m"), { safeDetail: "has a space" }))).toBe("Error");
    expect(classifyError(Object.assign(new Error("m"), { safeDetail: "schema:203.0.113.9" }))).toBe("Error");
  });

  it("always answers a safe string", () => {
    for (const e of [
      new Error("x y"),
      { issues: [{ path: ["a b", "c/d", Symbol("s"), 3] }] },
      new SafeDetailError("a".repeat(200)),
      { issues: [{ path: ["203.0.113.9"] }] },
      Object.assign(new Error("x"), { name: "f".repeat(40) }),
      new (class extends Error {})("anonymous"),
    ]) {
      expect(isSafeError(classifyError(e)), String(classifyError(e))).toBe(true);
    }
  });
});

describe("sanitisePath", () => {
  it("keeps A-Za-z0-9_. and replaces the rest, capped at 80 characters", () => {
    expect(sanitisePath(["providers", 0, "a b/é"])).toBe("providers.0.a_b__");
    expect(sanitisePath(["x".repeat(200)])).toHaveLength(80);
    expect(schemaFailure("listing_schema", [{ path: ["providers", 2, "name"] }])).toBe("listing_schema:providers.2.name");
    expect(schemaFailure("listing_schema", [])).toBe("listing_schema");
  });

  it("leaves out a path that is not safe to tell (a key that looks like an address), keeping the prefix", () => {
    expect(schemaFailure("listing_schema", [{ path: ["providers", "203.0.113.9"] }])).toBe("listing_schema");
    expect(schemaFailure("listing_schema", [{ path: ["f".repeat(40)] }])).toBe("listing_schema");
  });
});
