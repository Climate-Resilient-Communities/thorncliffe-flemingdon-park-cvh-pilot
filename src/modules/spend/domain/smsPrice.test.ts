import { describe, expect, it } from "vitest";
import { centsOf, rateInTenThousandths, toCadMillicents } from "./smsPrice";

describe("an actual price in Canadian dollars (S06.08)", () => {
  it("converts a US-dollar price at the configured rate, exactly, to thousandths of a cent", () => {
    // Twilio reports a charge as a negative decimal string. 0.0079 USD x 1.4 = 0.01106 CAD = 1.106 cents.
    const converted = toCadMillicents("-0.00790", "USD", 1.4);
    expect(converted).toEqual({ ok: true, priceText: "-0.00790", unit: "USD", rate: 1.4, millicents: 1106 });
    expect(centsOf(1106)).toBe(1.106);
  });

  it("takes a Canadian-dollar price as it is, at a rate of 1, whatever the configured rate", () => {
    expect(toCadMillicents("-0.0125", "CAD", 1.4)).toEqual({ ok: true, priceText: "-0.0125", unit: "CAD", rate: 1, millicents: 1250 });
    expect(toCadMillicents("0.0125", "cad", 1.4)).toMatchObject({ ok: true, unit: "CAD", millicents: 1250 });
  });

  it("drops the sign (a price is what the message cost) and keeps the text as the provider gave it", () => {
    expect(toCadMillicents("0.0079", "USD", 1.4)).toMatchObject({ ok: true, priceText: "0.0079", millicents: 1106 });
    expect(toCadMillicents(" -0.0079 ", "USD", 1.4)).toMatchObject({ ok: true, priceText: "-0.0079", millicents: 1106 });
  });

  it("rounds once, half up, at the thousandth of a cent, with no floating point in the amount", () => {
    // 0.00005 USD x 1.5 = 0.000075 CAD = 0.0075 cents = 7.5 millicents, which rounds up to 8.
    expect(toCadMillicents("0.00005", "USD", 1.5)).toMatchObject({ millicents: 8 });
    // 0.00001 USD x 1.4 = 0.0000140 CAD = 1.4 millicents, which rounds down to 1.
    expect(toCadMillicents("0.00001", "USD", 1.4)).toMatchObject({ millicents: 1 });
    // The classic float trap: 1.005 x 100 is 100.49999999999999 in floating point.
    expect(toCadMillicents("1.005", "CAD", 1)).toMatchObject({ millicents: 100_500 });
    // A thousand messages of one price add up to exactly a thousand times the one.
    const one = toCadMillicents("-0.0079", "USD", 1.3721);
    expect(one.ok && one.millicents * 1000).toBe(1084 * 1000);
  });

  it("converts a price of zero to zero (a message that cost nothing is still a message the provider billed)", () => {
    expect(toCadMillicents("0", "USD", 1.4)).toMatchObject({ ok: true, millicents: 0 });
    expect(toCadMillicents("-0.00000", "USD", 1.4)).toMatchObject({ ok: true, millicents: 0 });
  });

  it("says a message has no price yet when the provider gave none", () => {
    for (const price of [null, undefined, "", "   "]) expect(toCadMillicents(price, "USD", 1.4), String(price)).toEqual({ ok: false, reason: "no_price" });
  });

  it("refuses a price it cannot read and a currency it has no rate for, rather than guess", () => {
    for (const price of ["abc", "0,0079", "1e-3", "--1", "0.123456789", "1234567890", "NaN"]) {
      expect(toCadMillicents(price, "USD", 1.4), price).toEqual({ ok: false, reason: "price_unusable" });
    }
    for (const unit of [null, undefined, "", "EUR", "usdx", "US"]) {
      expect(toCadMillicents("-0.0079", unit, 1.4), String(unit)).toEqual({ ok: false, reason: "price_unusable" });
    }
  });

  it("holds a rate as whole ten-thousandths and refuses one that is not a positive number of at most four decimals", () => {
    expect(rateInTenThousandths(1.4)).toBe(14_000);
    expect(rateInTenThousandths(1.3721)).toBe(13_721);
    for (const bad of [0, -1, 1.23456, Number.NaN, Number.POSITIVE_INFINITY]) expect(() => rateInTenThousandths(bad), String(bad)).toThrow(RangeError);
  });
});
