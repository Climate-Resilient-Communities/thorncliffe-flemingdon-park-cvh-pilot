import { describe, expect, it } from "vitest";
import { z } from "zod";
import { SAFE_ERROR_PATTERN, SafeDetailError, classifyError, sanitisePath, schemaFailure } from "./safeError";

describe("classifyError", () => {
  it("names the first issue path of a failed parse, never its content", () => {
    const result = z.strictObject({ providers: z.array(z.strictObject({ neighbourhood_ids: z.array(z.string()) })) }).safeParse({ providers: [{}] });
    expect(result.success).toBe(false);
    expect(classifyError(result.error)).toBe("schema:providers.0.neighbourhood_ids");
  });

  it("prefers a safeDetail, then a SQLSTATE, then the class name, then unknown", () => {
    expect(classifyError(new SafeDetailError("listing_schema:providers.0.name"))).toBe("listing_schema:providers.0.name");
    expect(classifyError(Object.assign(new Error("permission denied for 203.0.113.9"), { code: "42501" }))).toBe("42501");
    expect(classifyError(Object.assign(new Error("x"), { code: "ECONNREFUSED" }))).toBe("Error");
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

  it("ignores an unsafe safeDetail", () => {
    expect(classifyError(Object.assign(new Error("m"), { safeDetail: "has a space" }))).toBe("Error");
  });

  it("always answers a safe string", () => {
    for (const e of [new Error("x y"), { issues: [{ path: ["a b", "c/d", Symbol("s"), 3] }] }, new SafeDetailError("a".repeat(200))]) {
      expect(classifyError(e)).toMatch(SAFE_ERROR_PATTERN);
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
});
