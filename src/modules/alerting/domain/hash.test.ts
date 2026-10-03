import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Audience } from "../../../contracts/audience";
import { canonicalContent, canonicalJson, contentHash, contentHashInput, type HashedEntry } from "./hash";

const sha256 = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");

describe("RFC 8785 canonical JSON (the examples of the RFC)", () => {
  it("section 3.2.2: members sorted, numbers as ECMAScript writes them, strings with the minimal escapes", () => {
    // The values of the RFC's example (its numbers 1E30, 4.50 and 2e-3 are the doubles 1e30, 4.5 and 0.002). Its string is,
    // character by character: euro sign, dollar, U+000F, line feed, A, apostrophe, B, quote, two backslashes, quote, slash.
    const value = {
      numbers: [333333333.33333329, 1e30, 4.5, 2e-3, 0.000000000000000000000000001],
      string: ["€$", String.fromCharCode(0x0f, 0x0a), "A'B", '"', "\\\\", '"', "/"].join(""),
      literals: [null, true, false],
    };
    // The RFC's expected text, where @ stands for a backslash: U+000F is @u000f, the line feed @n, the quote @", each backslash @@.
    const expected = '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$@u000f@nA\'B@"@@@@@"/"}'.replaceAll("@", "\\");

    expect(canonicalJson(value)).toBe(expected);
  });

  it("section 3.2.3: members sorted by UTF-16 code units, not by code points or locale", () => {
    // Characters built from their code points, so no editor or tool can normalise them (U+FB33 decomposes under NFC).
    const control = String.fromCharCode(0x80);
    const hebrewDaletDagesh = String.fromCharCode(0xfb33);
    const emoji = String.fromCodePoint(0x1f600); // the surrogates U+D83D U+DE00
    const euro = String.fromCharCode(0x20ac);
    const oDiaeresis = String.fromCharCode(0xf6);
    const value: Record<string, string> = {
      [euro]: "Euro Sign",
      "\r": "Carriage Return",
      [hebrewDaletDagesh]: "Hebrew Letter Dalet With Dagesh",
      "1": "One",
      [emoji]: "Emoji: Grinning Face",
      [control]: "Control",
      [oDiaeresis]: "Latin Small Letter O With Diaeresis",
    };

    // U+000D, "1", U+0080, ö, €, the emoji (its surrogate U+D83D sorts before U+FB33), then the Hebrew letter.
    const expected = [
      '"@r":"Carriage Return"',
      '"1":"One"',
      `"${control}":"Control"`,
      `"${oDiaeresis}":"Latin Small Letter O With Diaeresis"`,
      `"${euro}":"Euro Sign"`,
      `"${emoji}":"Emoji: Grinning Face"`,
      `"${hebrewDaletDagesh}":"Hebrew Letter Dalet With Dagesh"`,
    ].join(",");

    expect(canonicalJson(value)).toBe(`{${expected}}`.replaceAll("@", "\\"));
  });

  // Appendix B: IEEE 754 double (hex of its 64 bits) and the text RFC 8785 gives it.
  it.each([
    ["0000000000000000", "0"],
    ["8000000000000000", "0"], // minus zero is 0
    ["0000000000000001", "5e-324"], // the smallest subnormal
    ["8000000000000001", "-5e-324"],
    ["7fefffffffffffff", "1.7976931348623157e+308"], // the largest double
    ["ffefffffffffffff", "-1.7976931348623157e+308"],
    ["4340000000000000", "9007199254740992"], // 2^53
    ["c340000000000000", "-9007199254740992"],
    ["4430000000000000", "295147905179352830000"],
    ["44b52d02c7e14af5", "9.999999999999997e+22"],
    ["44b52d02c7e14af6", "1e+23"],
    ["44b52d02c7e14af7", "1.0000000000000001e+23"],
    ["444b1ae4d6e2ef4e", "999999999999999700000"],
    ["444b1ae4d6e2ef4f", "999999999999999900000"],
    ["444b1ae4d6e2ef50", "1e+21"],
    ["3eb0c6f7a0b5ed8c", "9.999999999999997e-7"],
    ["3eb0c6f7a0b5ed8d", "0.000001"],
    ["41b3de4355555553", "333333333.3333332"],
    ["41b3de4355555554", "333333333.33333325"],
    ["41b3de4355555555", "333333333.3333333"],
    ["41b3de4355555556", "333333333.3333334"],
    ["41b3de4355555557", "333333333.33333343"],
    ["becbf647612f3696", "-0.0000033333333333333333"],
    ["43143ff3c1cb0959", "1424953923781206.2"],
  ])("appendix B: the double %s is written %s", (hex, text) => {
    const view = new DataView(new ArrayBuffer(8));
    view.setBigUint64(0, BigInt(`0x${hex}`));

    expect(canonicalJson(view.getFloat64(0))).toBe(text);
    expect(canonicalJson([view.getFloat64(0)])).toBe(`[${text}]`);
  });

  it("appendix B: NaN and Infinity cannot be written", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => canonicalJson(bad)).toThrow();
      expect(() => canonicalJson({ n: bad })).toThrow();
    }
  });

  it("refuses a string with a lone surrogate (RFC 8785 requires well-formed Unicode)", () => {
    expect(() => canonicalJson("\uD800")).toThrow(/surrogate/i);
    expect(() => canonicalJson({ "\uDC00": 1 })).toThrow(/surrogate/i);
  });

  it("writes no white space, escapes the controls the way the RFC lists, and leaves everything else as it is", () => {
    expect(canonicalJson({ a: "\b\t\n\f\r\u0001\u001f\u007f \" \\ / é 😀" })).toBe('{"a":"\\b\\t\\n\\f\\r\\u0001\\u001f\u007f \\" \\\\ / é 😀"}');
    expect(canonicalJson({ b: [1, { d: null, c: [] }], a: {} })).toBe('{"a":{},"b":[1,{"c":[],"d":null}]}');
  });
});

const FLOOR = "01900000-0000-7000-8000-000000000001";
const AUDIENCE: Audience = { scope: "buildings", buildings: [{ rsn: "4154146", floors: [FLOOR] }], groups: [], types: ["power"] };
const ENGLISH = "Power is out on floors 4 to 6. Toronto Hydro is on site.";

/** A known entry: a power ack for one building, with an English and an Urdu text message and web text. */
const ENTRY: HashedEntry = {
  kind: "ack",
  alertId: "01900000-0000-7000-8000-0000000000a1",
  supersedesId: null,
  types: ["power"],
  phase: "problem",
  audience: AUDIENCE,
  channels: ["sms", "web"],
  isDrill: false,
  validUntil: new Date("2026-10-03T18:00:00Z"),
  text: ENGLISH,
  smsBodies: {
    en: { body: `Verified by the Hub\n${ENGLISH}`, encoding: "gsm7", segments: 1 },
    ur: { body: "ہب نے تصدیق کی\nبجلی بند ہے۔", encoding: "ucs2", segments: 1 },
  },
  webTexts: [{ lang: "ur", body: "بجلی بند ہے۔", machine: true, model: "north-small-translate-09-2026", status: "translated", sourceHash: sha256(ENGLISH) }],
};

// Pinned: the canonical JSON of ENTRY and the SHA-256 of it (checked outside this code with `sha256sum`).
const PINNED_JSON =
  '{"alert_id":"01900000-0000-7000-8000-0000000000a1","audience":{"buildings":[{"floors":["01900000-0000-7000-8000-000000000001"],"rsn":"4154146"}],"groups":[],"scope":"buildings","types":["power"]},"channels":["sms","web"],"is_drill":false,"kind":"ack","phase":"problem","sms_bodies":[{"body":"Verified by the Hub\\nPower is out on floors 4 to 6. Toronto Hydro is on site.","encoding":"gsm7","lang":"en","segments":1},{"body":"ہب نے تصدیق کی\\nبجلی بند ہے۔","encoding":"ucs2","lang":"ur","segments":1}],"supersedes_id":null,"types":["power"],"valid_until":"2026-10-03T18:00:00.000Z","web_texts":[{"body":"Power is out on floors 4 to 6. Toronto Hydro is on site.","lang":"en","machine":false,"model":null,"source_hash":"542e864b4aeec8e51e652dc0c7a947635e3703cff5f0cc9cc8d87f95a069280e","status":"source"},{"body":"بجلی بند ہے۔","lang":"ur","machine":true,"model":"north-small-translate-09-2026","source_hash":"542e864b4aeec8e51e652dc0c7a947635e3703cff5f0cc9cc8d87f95a069280e","status":"translated"}]}';
const PINNED_HASH = "6edc4f463ed45dbcd72f8b7f7b97e25f5ca532b74f6542f460d6ae085c90e8e6";

describe("contentHash", () => {
  it("pins the canonical JSON and the hash of a known entry", () => {
    expect(canonicalContent(ENTRY)).toBe(PINNED_JSON);
    // The source hash inside it is the SHA-256 of the English text.
    expect(sha256(ENGLISH)).toBe("542e864b4aeec8e51e652dc0c7a947635e3703cff5f0cc9cc8d87f95a069280e");
    expect(contentHash(ENTRY)).toBe(PINNED_HASH);
    expect(contentHash(ENTRY)).toBe(sha256(canonicalContent(ENTRY)));
    expect(contentHash(ENTRY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("hashes exactly the eleven members of the spine, and nothing else", () => {
    expect(Object.keys(contentHashInput(ENTRY)).sort()).toEqual(
      ["alert_id", "audience", "channels", "is_drill", "kind", "phase", "sms_bodies", "supersedes_id", "types", "valid_until", "web_texts"].sort(),
    );
  });

  it("sorts the lists by language (and the sets by code unit), so the order they were built in does not matter", () => {
    const shuffled: HashedEntry = {
      ...ENTRY,
      types: ["power"],
      channels: ["web", "sms"],
      smsBodies: { ur: ENTRY.smsBodies.ur, en: ENTRY.smsBodies.en },
      webTexts: [...ENTRY.webTexts].reverse(),
    };
    const many: HashedEntry = {
      ...ENTRY,
      types: ["water", "power", "flood"],
      smsBodies: { zh: ENTRY.smsBodies.en, ur: ENTRY.smsBodies.ur, en: ENTRY.smsBodies.en, "zh-Hant": ENTRY.smsBodies.ur },
      webTexts: [
        { ...ENTRY.webTexts[0], lang: "zh" },
        { ...ENTRY.webTexts[0], lang: "ur" },
        { ...ENTRY.webTexts[0], lang: "zh-Hant", status: "script_converted" },
      ],
    };

    expect(contentHash(shuffled)).toBe(contentHash(ENTRY));
    const input = contentHashInput(many);
    expect(input.types).toEqual(["flood", "power", "water"]);
    expect(input.sms_bodies.map((sms) => sms.lang)).toEqual(["en", "ur", "zh", "zh-Hant"]);
    expect(input.web_texts.map((text) => text.lang)).toEqual(["en", "ur", "zh", "zh-Hant"]);
    expect(contentHash({ ...many, types: ["flood", "water", "power"] })).toBe(contentHash(many));
  });

  it("does not depend on the key order of the audience, which jsonb reorders", () => {
    const reordered = { ...ENTRY, audience: { types: ["power"], groups: [], buildings: [{ rsn: "4154146", floors: [FLOOR] }], scope: "buildings" } as Audience };

    expect(contentHash(reordered)).toBe(contentHash(ENTRY));
  });

  const changes: [string, Partial<HashedEntry>][] = [
    ["the kind", { kind: "update" }],
    ["the alert", { alertId: "01900000-0000-7000-8000-0000000000a2" }],
    ["the entry it supersedes", { supersedesId: "01900000-0000-7000-8000-0000000000b1" }],
    ["the types", { types: ["water"] }],
    ["the phase", { phase: "in_progress" }],
    ["the audience", { audience: { ...AUDIENCE, groups: ["seniors"] } }],
    ["the channels", { channels: ["sms"] }],
    ["whether it is a drill", { isDrill: true }],
    ["valid until, by a millisecond", { validUntil: new Date("2026-10-03T18:00:00.001Z") }],
    ["the English text", { text: `${ENGLISH} ` }],
    ["a text message body", { smsBodies: { ...ENTRY.smsBodies, en: { ...ENTRY.smsBodies.en, body: `${ENTRY.smsBodies.en.body}.` } } }],
    ["a text message's segments", { smsBodies: { ...ENTRY.smsBodies, ur: { ...ENTRY.smsBodies.ur, segments: 2 } } }],
    ["a text message's encoding", { smsBodies: { ...ENTRY.smsBodies, en: { ...ENTRY.smsBodies.en, encoding: "ucs2" } } }],
    ["a language's text message being there", { smsBodies: { en: ENTRY.smsBodies.en } }],
    ["a web text's body", { webTexts: [{ ...ENTRY.webTexts[0], body: "بجلی بند" }] }],
    ["a web text's machine flag", { webTexts: [{ ...ENTRY.webTexts[0], machine: false }] }],
    ["a web text's model", { webTexts: [{ ...ENTRY.webTexts[0], model: "command-a-translate-08-2025" }] }],
    ["a web text's status", { webTexts: [{ ...ENTRY.webTexts[0], status: "fallback_en" }] }],
    ["a web text's source hash", { webTexts: [{ ...ENTRY.webTexts[0], sourceHash: sha256("other") }] }],
    ["a web text's language", { webTexts: [{ ...ENTRY.webTexts[0], lang: "ps" }] }],
    ["a web text being there", { webTexts: [] }],
  ];

  it.each(changes)("changes with %s", (_, change) => {
    expect(contentHash({ ...ENTRY, ...change })).not.toBe(contentHash(ENTRY));
  });

  it("is the same for the same instant however the date was made", () => {
    expect(contentHash({ ...ENTRY, validUntil: new Date(Date.UTC(2026, 9, 3, 18, 0, 0)) })).toBe(contentHash(ENTRY));
    expect(contentHash({ ...ENTRY, validUntil: new Date("2026-10-03T14:00:00-04:00") })).toBe(contentHash(ENTRY));
  });

  it("refuses content it cannot hash: an invalid date, a language twice, English among the translations", () => {
    expect(() => contentHash({ ...ENTRY, validUntil: new Date("nope") })).toThrow(RangeError);
    expect(() => contentHash({ ...ENTRY, webTexts: [ENTRY.webTexts[0], ENTRY.webTexts[0]] })).toThrow(/twice/);
    expect(() => contentHash({ ...ENTRY, webTexts: [{ ...ENTRY.webTexts[0], lang: "en" }] })).toThrow(/twice/);
  });
});
