import { describe, expect, it } from "vitest";
import { SAFE_ERROR_MAX_LENGTH, SafeErrorSchema, isSafeError } from "./safeError";

describe("a safe classification of a failure", () => {
  it.each([
    ["a SQLSTATE", "42501"],
    ["a SQLSTATE with letters", "XX000"],
    ["a library's constant code", "CONNECT_TIMEOUT"],
    ["a constant code with a prefix", "UND_ERR_CONNECT_TIMEOUT"],
    ["a class name", "QueryEmbedError"],
    ["a class name of one letter (a renamed class)", "a"],
    ["one of our own codes", "timed_out"],
    ["unknown", "unknown"],
    ["a fault of a release's files", "vectors_hash"],
    ["a code and a vendor class", "translate_failed:quota"],
    ["a code and a vendor class of the embedding", "embed_failed:limited"],
    ["a schema path", "listing_schema:providers.0.neighbourhood_ids"],
    ["a stage of the deadline", "timed_out:limiter"],
    ["the longest one", `${"a".repeat(9)}:${"z".repeat(SAFE_ERROR_MAX_LENGTH - 10)}`],
  ])("accepts %s", (_name, value) => {
    expect(isSafeError(value)).toBe(true);
    expect(SafeErrorSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ["a message", "connection refused at 10.0.0.1"],
    ["a sentence", "took too long"],
    ["a bare IPv4 address", "203.0.113.5"],
    ["an IPv4 address in a path", "schema:203.0.113.9"],
    ["an IPv4 address in a path, with a code before it", "listing_schema:providers.203.0.113.9"],
    ["an IPv6 address", "2001:db8::1"],
    ["an IPv6 address with a name before it", "fe80::1"],
    ["more than one colon", "schema:providers:0"],
    ["a trailing space", "42501 "],
    ["a space after the colon", "listing_schema: providers"],
    ["a hash", "f".repeat(64)],
    ["a hash as a detail", `listing_schema:${"0123456789abcdef".repeat(2)}`],
    ["a hash as a name of 40 characters", "f".repeat(40)],
    ["an empty string", ""],
    ["a code that is only a colon", ":"],
    ["a code without a name before the colon", ":quota"],
    ["a code that starts with a digit before the colon", "4:quota"],
    ["a colon and nothing after it", "translate_failed:"],
    ["one more character than the longest", "a".repeat(SAFE_ERROR_MAX_LENGTH + 1)],
    ["a name of 41 letters", "A".repeat(41)],
    ["a path in capitals before the colon", "SCHEMA:providers"],
    ["an email address", "someone@example.org"],
    ["a name with a dash", "my-error"],
  ])("refuses %s", (_name, value) => {
    expect(isSafeError(value)).toBe(false);
    expect(SafeErrorSchema.safeParse(value).success).toBe(false);
  });

  it("refuses what is not a string", () => {
    for (const value of [42, null, undefined, {}, ["42501"], true]) {
      expect(isSafeError(value)).toBe(false);
      expect(SafeErrorSchema.safeParse(value).success).toBe(false);
    }
  });

  it("does not repeat the refused value in the schema's message", () => {
    const result = SafeErrorSchema.safeParse("connection refused at 10.0.0.1");

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain("10.0.0.1");
  });
});
