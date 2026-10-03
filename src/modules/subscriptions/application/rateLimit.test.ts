// The address a client is counted under, before it is hashed (S03.04, AD-22): pure, no database.
import { describe, expect, it } from "vitest";
import { clientHash, normaliseClientAddress } from "./rateLimit";

describe("normaliseClientAddress", () => {
  it("leaves an IPv4 address as it is", () => {
    expect(normaliseClientAddress("203.0.113.7")).toBe("203.0.113.7");
  });

  it("turns an IPv6 address into its /64 prefix, so every address of one subscriber's /64 is one client", () => {
    const a = normaliseClientAddress("2001:db8:abcd:12:1:2:3:4");
    const b = normaliseClientAddress("2001:db8:abcd:12:ffff:ffff:ffff:ffff");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
    expect(normaliseClientAddress("2001:db8:abcd:13::1")).not.toBe(a);
  });

  it("reads compressed, padded, upper-case, bracketed and zoned spellings as the same prefix", () => {
    for (const spelling of ["2001:db8::1", "2001:0db8:0000:0000:0000:0000:0000:0001", "2001:DB8:0:0::1", "[2001:db8::1]", "2001:db8::1%eth0", "2001:db8:0:0:1::"]) {
      expect(normaliseClientAddress(spelling), spelling).toBe("2001:db8:0:0::/64");
    }
    expect(normaliseClientAddress("::1")).toBe("0:0:0:0::/64");
    expect(normaliseClientAddress("::")).toBe("0:0:0:0::/64");
    expect(normaliseClientAddress("fe80::1")).toBe("fe80:0:0:0::/64");
    expect(normaliseClientAddress("1::")).toBe("1:0:0:0::/64");
  });

  it("turns an IPv4-mapped IPv6 address, in any spelling, into the plain IPv4 address", () => {
    for (const spelling of ["::ffff:203.0.113.7", "::FFFF:203.0.113.7", "0:0:0:0:0:ffff:203.0.113.7", "::ffff:cb00:7107", "0000:0000:0000:0000:0000:ffff:cb00:7107", "[::ffff:203.0.113.7]"]) {
      expect(normaliseClientAddress(spelling), spelling).toBe("203.0.113.7");
    }
  });

  it("counts the mapped and the plain spelling of one IPv4 client as one client", () => {
    expect(clientHash("k", "search", normaliseClientAddress("::ffff:198.51.100.9"))).toBe(clientHash("k", "search", normaliseClientAddress("198.51.100.9")));
  });

  it("does not read another address with an IPv4 tail as mapped IPv4", () => {
    expect(normaliseClientAddress("64:ff9b::198.51.100.9")).toBe("64:ff9b:0:0::/64");
  });

  it("leaves what is not an address (no header: `unknown`) as it is", () => {
    expect(normaliseClientAddress("unknown")).toBe("unknown");
    expect(normaliseClientAddress("2001:db8::zz")).toBe("2001:db8::zz");
  });
});
