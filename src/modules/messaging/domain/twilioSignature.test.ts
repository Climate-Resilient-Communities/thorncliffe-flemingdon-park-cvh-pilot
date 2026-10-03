import { validateRequest, getExpectedTwilioSignature } from "twilio/lib/webhooks/webhooks";
import { describe, expect, it } from "vitest";
import { expectedTwilioSignature, isValidTwilioSignature, type FormParameters } from "./twilioSignature";

// Known vectors. Each expected value below was computed outside this code with
//   printf '%s' '<url><name><value>...sorted...' | openssl dgst -sha1 -hmac '<token>' -binary | base64
// (Twilio's documented algorithm done by hand) and is also what the official library's helper (`twilio`, already a dependency)
// returns, which the last tests check for many more shapes of request. Nothing here calls Twilio: the token is made up.

const VECTOR_URL = "https://mycompany.com/myapp.php?foo=1&bar=2";
const VECTOR_TOKEN = "12345";
const VECTOR_PARAMS: FormParameters = [
  ["Digits", "1234"],
  ["To", "+18005551212"],
  ["From", "+14158675310"],
  ["Caller", "+14158675310"],
  ["CallSid", "CA1234567890ABCDE"],
];
const VECTOR_SIGNATURE = "GvWf1cFY/Q7PnoempGyD5oXAezc=";

// A status callback the way the dispatcher's URL and Twilio's parameters look.
const CALLBACK_URL = "https://cvh.example/api/twilio/status?ref=0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const CALLBACK_TOKEN = "fake-auth-token-for-tests";
const CALLBACK_PARAMS: FormParameters = [
  ["MessageSid", "SM0123456789abcdef0123456789abcdef"],
  ["SmsSid", "SM0123456789abcdef0123456789abcdef"],
  ["AccountSid", `AC${"0".repeat(32)}`],
  ["MessagingServiceSid", `MG${"1".repeat(32)}`],
  ["To", "+14165550123"],
  ["MessageStatus", "undelivered"],
  ["SmsStatus", "undelivered"],
  ["ErrorCode", "30003"],
];
const CALLBACK_SIGNATURE = "IsF1kDFqmv+Bkb/+SgpWpa5hgLQ=";

const asObject = (params: FormParameters) => {
  const out: Record<string, string | string[]> = {};
  for (const [name, value] of params) {
    const existing = out[name];
    out[name] = existing === undefined ? value : [...(Array.isArray(existing) ? existing : [existing]), value];
  }
  return out;
};

describe("Twilio's signature, by the documented algorithm", () => {
  it("gives the known signature of the URL with its query string and the sorted parameters", () => {
    expect(expectedTwilioSignature(VECTOR_TOKEN, VECTOR_URL, VECTOR_PARAMS)).toBe(VECTOR_SIGNATURE);
  });

  it("gives the known signature of a status callback to the dispatcher's URL, whose reference is part of what is signed", () => {
    expect(expectedTwilioSignature(CALLBACK_TOKEN, CALLBACK_URL, CALLBACK_PARAMS)).toBe(CALLBACK_SIGNATURE);
    expect(expectedTwilioSignature(CALLBACK_TOKEN, CALLBACK_URL.replace("4a5b", "4a5c"), CALLBACK_PARAMS)).not.toBe(CALLBACK_SIGNATURE);
  });

  it("does not depend on the order the parameters were sent in", () => {
    expect(expectedTwilioSignature(VECTOR_TOKEN, VECTOR_URL, [...VECTOR_PARAMS].reverse())).toBe(VECTOR_SIGNATURE);
  });

  it("signs a POST with no parameters as the URL alone", () => {
    // printf '%s' 'https://cvh.example/api/twilio/status' | openssl dgst -sha1 -hmac 'fake-auth-token-for-tests' -binary | base64
    expect(expectedTwilioSignature(CALLBACK_TOKEN, "https://cvh.example/api/twilio/status", [])).toBe("n6XwtUQy7fO0qyA1l1oBa7vzatc=");
  });

  it("accepts the right signature and nothing else", () => {
    expect(isValidTwilioSignature(VECTOR_TOKEN, VECTOR_SIGNATURE, VECTOR_URL, VECTOR_PARAMS)).toBe(true);
    expect(isValidTwilioSignature(CALLBACK_TOKEN, CALLBACK_SIGNATURE, CALLBACK_URL, CALLBACK_PARAMS)).toBe(true);
  });

  it("refuses a missing, empty, truncated, extended or altered signature", () => {
    for (const signature of [null, "", VECTOR_SIGNATURE.slice(0, -1), `${VECTOR_SIGNATURE}A`, VECTOR_SIGNATURE.toLowerCase(), " " + VECTOR_SIGNATURE, "x".repeat(10_000)]) {
      expect(isValidTwilioSignature(VECTOR_TOKEN, signature, VECTOR_URL, VECTOR_PARAMS), String(signature).slice(0, 30)).toBe(false);
    }
  });

  it("refuses a signature made with another token, and any signature when no token is given", () => {
    expect(isValidTwilioSignature("12346", VECTOR_SIGNATURE, VECTOR_URL, VECTOR_PARAMS)).toBe(false);
    expect(isValidTwilioSignature("", expectedTwilioSignature("", VECTOR_URL, VECTOR_PARAMS), VECTOR_URL, VECTOR_PARAMS)).toBe(false);
  });

  it("refuses a request whose URL, a value, a name or the parameter set differs by one character", () => {
    const check = (url: string, params: FormParameters) => isValidTwilioSignature(VECTOR_TOKEN, VECTOR_SIGNATURE, url, params);
    expect(check(VECTOR_URL.replace("https", "http"), VECTOR_PARAMS)).toBe(false);
    expect(check(VECTOR_URL.replace("bar=2", "bar=3"), VECTOR_PARAMS)).toBe(false);
    expect(check(`${VECTOR_URL}&x=1`, VECTOR_PARAMS)).toBe(false);
    expect(check(VECTOR_URL, VECTOR_PARAMS.map(([name, value]) => (name === "Digits" ? [name, "1235"] : [name, value])))).toBe(false);
    expect(check(VECTOR_URL, VECTOR_PARAMS.map(([name, value]) => (name === "Digits" ? ["digits", value] : [name, value])))).toBe(false);
    expect(check(VECTOR_URL, VECTOR_PARAMS.slice(1))).toBe(false);
    expect(check(VECTOR_URL, [...VECTOR_PARAMS, ["Extra", ""]])).toBe(false);
  });
});

describe("agreement with the official library's helper", () => {
  const SHAPES: { name: string; url: string; params: FormParameters }[] = [
    { name: "the vector", url: VECTOR_URL, params: VECTOR_PARAMS },
    { name: "a status callback", url: CALLBACK_URL, params: CALLBACK_PARAMS },
    { name: "names that differ only in case, and one that is a prefix of another", url: "https://cvh.example/x", params: [["Body", "b"], ["body", "a"], ["Bod", "c"], ["BodyX", "d"], ["a", "1"], ["B", "2"]] },
    { name: "empty values and spaces", url: "https://cvh.example/x?ref=1", params: [["Empty", ""], ["Spaced", "a b  c"], ["Plus", "+1 416"]] },
    { name: "non-ASCII text", url: "https://cvh.example/x", params: [["Body", "عمارت 12 میں بجلی بند ہے ✓ é"], ["To", "+14165550123"]] },
    { name: "a name sent twice (each distinct value counts once, in order)", url: "https://cvh.example/x", params: [["Media", "b"], ["Media", "a"], ["Media", "b"], ["Other", "z"]] },
    { name: "a very long value", url: "https://cvh.example/x", params: [["Body", "x".repeat(5000)]] },
    { name: "no parameters", url: "https://cvh.example/api/twilio/status", params: [] },
  ];

  it.each(SHAPES)("signs $name exactly as the library does", ({ url, params }) => {
    expect(expectedTwilioSignature(CALLBACK_TOKEN, url, params)).toBe(getExpectedTwilioSignature(CALLBACK_TOKEN, url, asObject(params)));
  });

  it.each(SHAPES)("accepts what the library signs, for $name, and the library accepts what we sign", ({ url, params }) => {
    const theirs = getExpectedTwilioSignature(CALLBACK_TOKEN, url, asObject(params));
    expect(isValidTwilioSignature(CALLBACK_TOKEN, theirs, url, params)).toBe(true);
    expect(validateRequest(CALLBACK_TOKEN, expectedTwilioSignature(CALLBACK_TOKEN, url, params), url, asObject(params))).toBe(true);
  });
});
