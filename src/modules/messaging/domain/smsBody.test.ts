import { describe, expect, it } from "vitest";
import { LAUNCH_CODES, type LaunchCode } from "../../../i18n/languages";
import { SMS_STRING_KEYS, fillSms, smsStrings } from "../../../i18n/smsStrings";
import { NINE_ONE_ONE_FIRST_TYPES, alertLink, isNineOneOneFirst, render, renderAll, type SmsEntry, type SmsTranslated } from "./smsBody";
import { countSms } from "./smsEncoding";

const BASE = "https://cvh.example";
const SLUG = "k3x9a2";
const LINK = `${BASE}/a/${SLUG}`;
const ENGLISH = "Power is out on floors 4 to 6. Toronto Hydro is on site.";
const TYPES = ["power", "water", "elevator", "flood", "fire", "other", "heat", "smoke", "winter"];

const entry = (over: Partial<SmsEntry> = {}): SmsEntry => ({
  kind: "ack",
  types: ["power"],
  text: ENGLISH,
  verified: true,
  attribution: { role: "hub" },
  translations: [],
  ...over,
});

const translated = (lang: string, body: string, over: Partial<SmsTranslated> = {}): SmsTranslated => ({ lang, body, status: "translated", machine: true, ...over });
const lines = (body: string) => body.split("\n");

const FOOTER = ["More: https://cvh.example/a/k3x9a2", "To stop all messages from the Hub, reply STOP."];
const NINE_ONE_ONE = "The Hub is not an emergency service. If someone is in danger, call 911.";
const VERIFIED = ["Verified by the Hub", "Community alert from the Hub"];
const TEXT = ENGLISH;

describe("render: the English body, part by part", () => {
  it("builds a power alert in the order of the story, with the 911 line after the text", () => {
    const out = render(entry(), "en", false, SLUG, BASE);

    expect(lines(out.body)).toEqual([...VERIFIED, TEXT, NINE_ONE_ONE, ...FOOTER]);
    expect(out).toEqual({ body: out.body, encoding: "gsm7", segments: 2 });
  });

  it("puts the 911 line first (after the markers) for fire", () => {
    expect(lines(render(entry({ types: ["fire"] }), "en", false, SLUG, BASE).body)).toEqual([NINE_ONE_ONE, ...VERIFIED, TEXT, ...FOOTER]);
  });

  it("puts the 911 line first for Other, and for a fire among other types", () => {
    for (const types of [["other"], ["power", "fire"], ["flood", "other", "water"]]) {
      expect(lines(render(entry({ types }), "en", false, SLUG, BASE).body)[0], types.join()).toBe(NINE_ONE_ONE);
    }
  });

  // Drill, correction and drill-correction fixtures for both positions of the 911 line.
  const MARKER = { exercise: "Exercise. Practice only.", correction: "Correction" };
  const fixture = (first: boolean, drill: boolean, correction: boolean): string[] => {
    const markers = [...(drill ? [MARKER.exercise] : []), ...(correction ? [MARKER.correction] : [])];
    return first ? [...markers, NINE_ONE_ONE, ...VERIFIED, TEXT, ...FOOTER] : [...markers, ...VERIFIED, TEXT, NINE_ONE_ONE, ...FOOTER];
  };

  it.each([
    ["power", ["power"], false],
    ["fire", ["fire"], true],
    ["other", ["other"], true],
  ] as const)("%s: a plain alert, a drill, a correction and a drill correction keep their markers first, then the 911 line when it goes first", (_, types, first) => {
    for (const [drill, correction] of [[false, false], [true, false], [false, true], [true, true]] as const) {
      const body = render(entry({ types: [...types], kind: correction ? "correction" : "ack" }), "en", drill, SLUG, BASE).body;

      expect(lines(body), `${types.join()} drill=${drill} correction=${correction}`).toEqual(fixture(first, drill, correction));
    }
  });

  it("pins whole bodies byte for byte (the fire drill correction, and the power drill correction)", () => {
    expect(render(entry({ types: ["fire"], kind: "correction" }), "en", true, SLUG, BASE).body).toBe(
      [
        "Exercise. Practice only.",
        "Correction",
        "The Hub is not an emergency service. If someone is in danger, call 911.",
        "Verified by the Hub",
        "Community alert from the Hub",
        "Power is out on floors 4 to 6. Toronto Hydro is on site.",
        "More: https://cvh.example/a/k3x9a2",
        "To stop all messages from the Hub, reply STOP.",
      ].join("\n"),
    );
    expect(render(entry({ kind: "correction" }), "en", true, SLUG, BASE).body).toBe(
      [
        "Exercise. Practice only.",
        "Correction",
        "Verified by the Hub",
        "Community alert from the Hub",
        "Power is out on floors 4 to 6. Toronto Hydro is on site.",
        "The Hub is not an emergency service. If someone is in danger, call 911.",
        "More: https://cvh.example/a/k3x9a2",
        "To stop all messages from the Hub, reply STOP.",
      ].join("\n"),
    );
  });

  it("marks a correction only for the correction kind", () => {
    for (const kind of ["ack", "update", "withdrawal", "final"] as const) {
      expect(lines(render(entry({ kind }), "en", false, SLUG, BASE).body)).not.toContain("Correction");
    }
  });

  it("says 'Not yet verified' when it is not verified and 'Verified by the Hub' when it is", () => {
    expect(lines(render(entry({ verified: false }), "en", false, SLUG, BASE).body).slice(0, 2)).toEqual(["Not yet verified", "Community alert from the Hub"]);
    expect(lines(render(entry({ verified: true }), "en", false, SLUG, BASE).body)[0]).toBe("Verified by the Hub");
  });

  it("names a building ambassador by role and building, never by name", () => {
    const out = render(entry({ verified: false, attribution: { role: "ambassador", building: "10 Thorncliffe Park Dr" } }), "en", false, SLUG, BASE);

    expect(lines(out.body).slice(0, 2)).toEqual(["Not yet verified", "Building ambassador, 10 Thorncliffe Park Dr"]);
  });

  it("builds the /a/{slug} link from the public origin, without a doubled slash", () => {
    expect(lines(render(entry(), "en", false, SLUG, BASE).body)).toContain(`More: ${LINK}`);
    expect(lines(render(entry(), "en", false, SLUG, `${BASE}/`).body)).toContain(`More: ${LINK}`);
    expect(lines(render(entry(), "en", false, "AbC_-9", "http://localhost:3000").body)).toContain("More: http://localhost:3000/a/AbC_-9");
    expect(alertLink(BASE, SLUG)).toBe(LINK);
  });

  it.each(["", "a b", "a/b", "a?b", "../x", "slug\n", "ü", "x".repeat(65)])("refuses the slug %j", (slug) => {
    expect(() => render(entry(), "en", false, slug, BASE)).toThrow(RangeError);
  });

  it.each(["", "cvh.example", "https://cvh.example/path", "https://cvh.example?x=1", "https://", "ftp://cvh.example", "https://cvh example"])("refuses the public origin %j", (base) => {
    expect(() => render(entry(), "en", false, SLUG, base)).toThrow(RangeError);
  });

  it("ends with the stop line and has the link just before it", () => {
    for (const lang of LAUNCH_CODES) {
      const all = lines(render(entry(), lang, false, SLUG, BASE).body);
      expect(all.at(-1)).toBe(smsStrings(lang).stop);
      expect(all.at(-2)).toBe(fillSms(smsStrings(lang).link, { url: LINK }));
    }
  });
});

describe("render: exactly one 911 line, in the right place, in every language", () => {
  const cases = [
    ...TYPES.map((type) => [type]),
    ["power", "fire"],
    ["heat", "other"],
    ["power", "water", "flood"],
    ["fire", "other"],
  ];

  it.each(LAUNCH_CODES.map((lang) => [lang]))("%s", (lang) => {
    const strings = smsStrings(lang as LaunchCode);
    for (const types of cases) {
      for (const isDrill of [false, true]) {
        for (const kind of ["ack", "correction"] as const) {
          const e = entry({ types, kind, translations: lang === "en" ? [] : [translated(lang, `[${lang}]`)] });
          const all = lines(render(e, lang as LaunchCode, isDrill, SLUG, BASE).body);
          const at = all.flatMap((line, index) => (line === strings.call911 ? [index] : []));
          const where = `${lang} ${types.join("+")} drill=${isDrill} ${kind}`;

          expect(at, where).toHaveLength(1);
          const markers = (isDrill ? 1 : 0) + (kind === "correction" ? 1 : 0);
          const verification = all.findIndex((line) => line === strings.notYetVerified || line === fillSms(strings.verifiedBy, { org: strings.hub }));
          const text = all.indexOf(`[${lang}]`) === -1 ? all.indexOf(ENGLISH) : all.indexOf(`[${lang}]`);
          if (isNineOneOneFirst(types)) {
            // After the exercise and correction markers, before the verification marker.
            expect(at[0], where).toBe(markers);
            expect(at[0], where).toBeLessThan(verification);
          } else {
            // After the text (and the label), before the link and the stop line.
            expect(at[0], where).toBeGreaterThan(text);
            expect(at[0], where).toBe(all.length - 3);
          }
          if (isDrill) expect(all[0], where).toBe(strings.exercise);
          if (kind === "correction") expect(all[isDrill ? 1 : 0], where).toBe(strings.correction);
        }
      }
    }
  });

  it("defines the 911-first types as fire (fire and evacuation) and other", () => {
    expect([...NINE_ONE_ONE_FIRST_TYPES].sort()).toEqual(["fire", "other"]);
    for (const type of TYPES) expect(isNineOneOneFirst([type]), type).toBe(type === "fire" || type === "other");
    expect(isNineOneOneFirst([])).toBe(false);
  });
});

describe("render: the text, the label and the fallback", () => {
  const URDU = "ابھی بجلی بند ہے۔";

  it("adds the machine-translation label after a machine translation, in that language", () => {
    const out = render(entry({ translations: [translated("ur", URDU)] }), "ur", false, SLUG, BASE);
    const strings = smsStrings("ur");

    expect(lines(out.body)).toEqual([fillSms(strings.verifiedBy, { org: strings.hub }), fillSms(strings.community, { author: strings.hub }), URDU, strings.machineLabel, strings.call911, fillSms(strings.link, { url: LINK }), strings.stop]);
  });

  it("adds no label to a translation that is not a machine's, or to English", () => {
    const strings = smsStrings("ur");
    const human = render(entry({ translations: [translated("ur", URDU, { status: "ok", machine: false })] }), "ur", false, SLUG, BASE);

    expect(lines(human.body)).toContain(URDU);
    expect(lines(human.body)).not.toContain(strings.machineLabel);
    expect(lines(human.body)).not.toContain(strings.unavailable);
    expect(lines(render(entry(), "en", false, SLUG, BASE).body)).not.toContain(smsStrings("en").machineLabel);
  });

  it.each(LAUNCH_CODES.filter((lang) => lang !== "en").map((lang) => [lang]))("%s: a fallback is the English text with translation.unavailable in that language, and no machine label", (lang) => {
    const strings = smsStrings(lang as LaunchCode);
    // The stored body of a fallback is English too; the renderer uses the entry's own English text either way.
    const out = render(entry({ translations: [translated(lang, "anything stored", { status: "fallback_en", machine: false })] }), lang as LaunchCode, false, SLUG, BASE);
    const all = lines(out.body);

    expect(all).toEqual([fillSms(strings.verifiedBy, { org: strings.hub }), fillSms(strings.community, { author: strings.hub }), ENGLISH, strings.unavailable, strings.call911, fillSms(strings.link, { url: LINK }), strings.stop]);
    expect(out.body).not.toContain("anything stored");
    expect(all).not.toContain(strings.machineLabel);
    expect(strings.unavailable).toBe(smsStrings(lang as LaunchCode).unavailable);
  });

  it("treats a missing translation, and a blank one, as a fallback: never a blank text, never another language as hers", () => {
    const strings = smsStrings("ur");
    for (const translations of [[], [translated("ps", "پښتو")], [translated("ur", "   ")]]) {
      const all = lines(render(entry({ translations }), "ur", false, SLUG, BASE).body);
      expect(all, JSON.stringify(translations)).toContain(ENGLISH);
      expect(all).toContain(strings.unavailable);
      expect(all).not.toContain("پښتو");
    }
  });

  it("uses the translation of the language asked for, even when others are present", () => {
    const e = entry({ translations: [translated("ps", "پښتو متن"), translated("ur", URDU), translated("fr", "Texte")] });

    expect(lines(render(e, "ur", false, SLUG, BASE).body)).toContain(URDU);
    expect(lines(render(e, "fr", false, SLUG, BASE).body)).toContain("Texte");
    expect(lines(render(e, "ps", false, SLUG, BASE).body)).toContain("پښتو متن");
  });

  it("trims the text and keeps its own line breaks", () => {
    const out = render(entry({ text: "  Line one\nLine two  " }), "en", false, SLUG, BASE);

    expect(lines(out.body)).toContain("Line one");
    expect(lines(out.body)).toContain("Line two");
  });

  it("throws for a language that has no text message catalog (zh-Hant is web only)", () => {
    expect(() => render(entry(), "zh-Hant" as LaunchCode, false, SLUG, BASE)).toThrow(/No text message catalog/);
  });
});

describe("render: normalisation before freezing, and the count of the frozen body", () => {
  it("straightens the curly quotes and dashes of a pasted text, so the body is the final text and stays GSM-7", () => {
    const out = render(entry({ text: "Power’s out – don’t use the “elevators”…" }), "en", false, SLUG, BASE);

    expect(lines(out.body)).toContain("Power's out - don't use the \"elevators\"...");
    expect(out.encoding).toBe("gsm7");
  });

  it("normalises the translation too, and the whole body", () => {
    const out = render(entry({ translations: [translated("fr", "L’électricité est coupée – « étages 4 à 6 »\r\n")] }), "fr", false, SLUG, BASE);

    expect(lines(out.body)).toContain('L\'électricité est coupée - " étages 4 à 6 "');
    expect(out.body).not.toMatch(/[‘’“”–—«»\r]/);
  });

  it("stores the encoding and segments of the frozen body itself", () => {
    for (const lang of LAUNCH_CODES) {
      const out = render(entry({ translations: lang === "en" ? [] : [translated(lang, ENGLISH, { status: "fallback_en", machine: false })] }), lang, false, SLUG, BASE);
      const { encoding, segments } = countSms(out.body);

      expect({ encoding: out.encoding, segments: out.segments }, lang).toEqual({ encoding, segments });
    }
  });

  it("counts an extension character as two septets: a body of GSM-7 text with a { in it takes the extra septet", () => {
    const base = render(entry({ text: "Use stairs" }), "en", false, SLUG, BASE);
    const withBrace = render(entry({ text: "Use stairs {" }), "en", false, SLUG, BASE);

    expect(countSms(withBrace.body).units - countSms(base.body).units).toBe(3); // " {" is one space and one two-septet character
    expect(withBrace.encoding).toBe("gsm7");
  });

  it("switches to UCS-2 for a single character GSM-7 lacks, in an otherwise English body", () => {
    const out = render(entry({ text: "Power is out on floors 4 to 6 at the café ç" }), "en", false, SLUG, BASE);

    expect(out.encoding).toBe("ucs2");
  });
});

// A sentence of the catalog of each language, of the length of a real alert, stands in for the translated text, so
// every script is counted. The segments are of the whole body: the markers, the text, the label, the 911 line, the
// link and the stop line. A change to a catalog string that changes a count fails here, so the cost estimate is
// reconsidered with it (the footer adds about two segments in non-Latin scripts, a spine risk).
const SAMPLE: Record<LaunchCode, string> = {
  ur: "ابھی خیریت معلوم کرنے کا کوئی چکر نہیں۔ یہ تب شروع ہوتا ہے جب ہب آپ کی عمارت کے لیے گرمی یا بجلی کا الرٹ بھیجتا ہے۔",
  ps: "اوس د احوال پوښتنې ګرځښت نشته. هغه وخت پیلېږي چې مرکز ستاسو د ودانۍ لپاره د ګرمۍ یا برېښنا خبرتیا ولېږي.",
  tl: "Walang pag-ikot ng pangungumusta ngayon. Magsisimula ito kapag nagpadala ang Hub ng alerto tungkol sa init o kuryente para sa iyong gusali.",
  prs: "همین حالا دور احوال‌پرسی نیست. وقتی مرکز برای ساختمان شما هشدار گرمی هوا یا برق بفرستد، شروع می‌شود.",
  gu: "અત્યારે ખબર પૂછવાનો કોઈ રાઉન્ડ નથી. હબ તમારા બિલ્ડિંગ માટે ગરમી કે વીજળીની ચેતવણી મોકલે ત્યારે તે શરૂ થાય છે.",
  ta: "இப்போது நலம் விசாரிப்புச் சுற்று இல்லை. உங்கள் கட்டடத்துக்கு மையம் வெப்ப அல்லது மின்சார எச்சரிக்கை அனுப்பும்போது அது தொடங்கும்.",
  el: "Δεν υπάρχει γύρος ελέγχων αυτή τη στιγμή. Ξεκινά όταν το Hub στείλει ειδοποίηση για ζέστη ή ρεύμα για το κτίριό σας.",
  sk: "Teraz nie je žiadne kolo kontrol. Začne sa, keď Hub pošle upozornenie na horúčavu alebo výpadok elektriny pre vašu budovu.",
  bn: "এখন কোনো খোঁজখবর নেওয়ার রাউন্ড নেই। হাব আপনার বিল্ডিংয়ের জন্য গরম বা বিদ্যুতের সতর্কতা পাঠালে এটি শুরু হয়।",
  hi: "अभी कोई हालचाल राउंड नहीं है। यह तब शुरू होता है जब हब आपकी बिल्डिंग के लिए गर्मी या बिजली का अलर्ट भेजता है।",
  pa: "ਇਸ ਵੇਲੇ ਹਾਲ-ਚਾਲ ਪੁੱਛਣ ਦਾ ਕੋਈ ਗੇੜਾ ਨਹੀਂ। ਇਹ ਉਦੋਂ ਸ਼ੁਰੂ ਹੁੰਦਾ ਹੈ ਜਦੋਂ ਹੱਬ ਤੁਹਾਡੀ ਬਿਲਡਿੰਗ ਲਈ ਗਰਮੀ ਜਾਂ ਬਿਜਲੀ ਦੀ ਚੇਤਾਵਨੀ ਭੇਜਦਾ ਹੈ।",
  zh: "目前没有探望巡查。当中心为您的楼宇发出高温或停电警报时，巡查就会开始。",
  es: "No hay ronda de chequeos de bienestar en este momento. Empieza cuando el Hub envía una alerta de calor o de corte de luz para su edificio.",
  fr: "Pas de tournée de prise de nouvelles en ce moment. Elle commence quand le Hub envoie une alerte de chaleur ou de panne de courant pour votre immeuble.",
  en: "No check-in round right now. It starts when the Hub sends a heat or power alert for your building.",
};

// [encoding, segments of the translated body, segments of the fallback body] at BASE and SLUG, a power alert from the Hub.
const COUNTS: Record<LaunchCode, ["gsm7" | "ucs2", number, number]> = {
  ur: ["ucs2", 5, 5],
  ps: ["ucs2", 5, 5],
  tl: ["gsm7", 3, 3],
  prs: ["ucs2", 5, 5],
  gu: ["ucs2", 5, 4],
  ta: ["ucs2", 6, 5],
  el: ["ucs2", 6, 6],
  sk: ["ucs2", 6, 5],
  bn: ["ucs2", 5, 4],
  hi: ["ucs2", 5, 5],
  pa: ["ucs2", 6, 5],
  zh: ["ucs2", 3, 3],
  es: ["ucs2", 6, 5],
  fr: ["ucs2", 7, 5],
  en: ["gsm7", 2, 2],
};

describe("render: fixtures per language (encoding and segments of the frozen body)", () => {
  it("has a fixture for every launch language and nothing else", () => {
    expect(Object.keys(SAMPLE).sort()).toEqual([...LAUNCH_CODES].sort());
    expect(Object.keys(COUNTS).sort()).toEqual([...LAUNCH_CODES].sort());
  });

  it.each(LAUNCH_CODES.map((lang) => [lang]))("%s", (language) => {
    const lang = language as LaunchCode;
    const [encoding, segments, fallbackSegments] = COUNTS[lang];
    // English is the authoring language: its sample is the entry's own text. Every other language's sample is a
    // translation of it, and its fallback is the English alert text.
    const out = render(entry(lang === "en" ? { text: SAMPLE.en } : { translations: [translated(lang, SAMPLE[lang])] }), lang, false, SLUG, BASE);
    const fallback = render(entry({ translations: [translated(lang, ENGLISH, { status: "fallback_en", machine: false })] }), lang, false, SLUG, BASE);

    expect({ encoding: out.encoding, segments: out.segments }, `${lang} translated`).toEqual({ encoding, segments });
    expect(fallback.segments, `${lang} fallback`).toBe(fallbackSegments);
    // The count is of the body that is stored, by the encoder, never of its source text.
    expect(countSms(out.body)).toMatchObject({ encoding: out.encoding, segments: out.segments });
    expect(out.body).toContain(SAMPLE[lang]);
  });

  it("is GSM-7 only for the languages written in the Latin letters of the alphabet GSM-7 has (English, Tagalog), UCS-2 for the rest", () => {
    expect(LAUNCH_CODES.filter((lang) => COUNTS[lang][0] === "gsm7").sort()).toEqual(["en", "tl"]);
  });
});

describe("renderAll", () => {
  it("renders every launch language, English included, and each equals render", () => {
    const e = entry({ translations: [translated("ur", SAMPLE.ur), translated("fr", SAMPLE.fr, { status: "fallback_en", machine: false })] });
    const all = renderAll(e, true, SLUG, BASE);

    expect(Object.keys(all).sort()).toEqual([...LAUNCH_CODES].sort());
    for (const lang of LAUNCH_CODES) expect(all[lang], lang).toEqual(render(e, lang, true, SLUG, BASE));
    expect(all.ur.body).toContain(SAMPLE.ur);
    expect(all.fr.body).toContain(ENGLISH);
    expect(all.pa.body).toContain(ENGLISH); // no translation: the fallback
  });
});

describe("the catalog strings the renderer uses", () => {
  it("are the ones named in SMS_STRING_KEYS, and no word comes from anywhere else", () => {
    const out = render(entry({ types: ["fire"], kind: "correction", translations: [translated("ur", "متن")] }), "ur", true, SLUG, BASE);
    const strings = smsStrings("ur");
    const expected = [strings.exercise, strings.correction, strings.call911, fillSms(strings.verifiedBy, { org: strings.hub }), fillSms(strings.community, { author: strings.hub }), "متن", strings.machineLabel, fillSms(strings.link, { url: LINK }), strings.stop];

    expect(lines(out.body)).toEqual(expected);
    expect(Object.keys(SMS_STRING_KEYS)).toHaveLength(12);
  });
});
