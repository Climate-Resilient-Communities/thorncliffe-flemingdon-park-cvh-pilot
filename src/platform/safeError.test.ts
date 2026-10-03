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
