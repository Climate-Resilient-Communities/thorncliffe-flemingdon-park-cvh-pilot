import { describe, expect, it } from "vitest";
import { alertView, originOf } from "./alert-view";
import { ENGLISH, ID, SERVER_NOW, URDU, englishEntry, entry, fallbackEntry, thread, translatorFor } from "./alert-test-helpers";

const en = translatorFor("en");
const view = (over: Parameters<typeof thread>[0] = {}, lang: "en" | "ur" | "fr" = "en", now = SERVER_NOW) => alertView(thread(over), { lang, serverNow: now, t: translatorFor(lang) });

describe("the types of an alert (X-13)", () => {
  it("are the catalog's words, in the order of the thread's types", () => {
    expect(view({ types: ["power", "elevator"] }).types).toEqual([
      { id: "power", word: "Power" },
      { id: "elevator", word: "Elevator" },
    ]);
  });

  it("read a type the catalog has no word for as Other", () => {
    expect(view({ types: ["no-such-type"] }).types).toEqual([{ id: "other", word: "Other" }]);
  });

  it("are written in the page language", () => {
    expect(view({ types: ["elevator"] }, "fr").types[0].word).toBe(translatorFor("fr")("x13.elevator"));
    expect(view({ types: ["elevator"] }, "ur").types[0].word).toBe(translatorFor("ur")("x13.elevator"));
  });
});

describe("an alert's text", () => {
  it("is a translation set in its own language and direction, with no label and no English to show (decision 2026-10-09)", () => {
    const { current } = view({ entries: [entry()] }, "ur");

    expect(current.text).toEqual({ body: URDU, lang: "ur", dir: "rtl", fallback: false, machine: true });
    expect(current).not.toHaveProperty("english");
  });

  it("is English left to right for an English reader, with no label and no English to show", () => {
    const { current } = view({ entries: [englishEntry()] });

    expect(current.text).toEqual({ body: ENGLISH, lang: "en", dir: "ltr", fallback: false, machine: false });
  });

  it("is English left to right when it stands in for a translation that failed, flagged as the fallback, with no label and nothing more to show", () => {
    const { current } = view({ entries: [fallbackEntry()] }, "ur");

    expect(current.text).toEqual({ body: ENGLISH, lang: "en", dir: "ltr", fallback: true, machine: false });
  });

  it("carries no 'not available', machine-translation or 'Read it in English' wording (decision 2026-10-09)", () => {
    const v = view({ entries: [fallbackEntry()] }, "ur");

    for (const field of ["unavailableTitle", "unavailableBody", "showEnglish", "originalLabel", "machineLabel", "machineFrom"]) expect(v).not.toHaveProperty(field);
  });

  it("is the newest entry's: what is true now", () => {
    const v = view({ entries: [entry({ n: 1, published_at: "2026-10-01T14:00:00.000Z" }), englishEntry({ n: 2, published_at: "2026-10-01T14:50:00.000Z", kind: "update" })] });

    expect(v.current.id).toBe(ID(2));
    expect(v.entries.map((e) => e.id)).toEqual([ID(2), ID(1)]);
  });
});

describe("the origin and verification of an alert (X-02)", () => {
  it("is the Hub's whole sentence and 'Verified by the Hub': never the Hub joined to a preposition", () => {
    const origin = view().origin;

    expect(origin).toEqual({ attribution: "Community alert from the Hub", verified: true, verification: "Verified by the Hub", whatMeans: "What this means" });
  });

  it("is 'Not yet verified' for an entry the Hub has not checked", () => {
    expect(view({ entries: [entry({ verified: false })] }).origin).toMatchObject({ verified: false, verification: "Not yet verified" });
  });

  it("is the same words on every surface: the card, the page and R-28 take them from one place", () => {
    for (const lang of ["en", "ur", "fr"] as const) {
      const t = translatorFor(lang);
      expect(originOf(entry(), t).verification, lang).toBe(t("x02.verifiedBy", { org: t("x02.hub") }));
      expect(originOf(entry({ verified: false }), t).verification, lang).toBe(t("x02.notYetVerified"));
      expect(originOf(entry(), t).attribution, lang).toBe(t("R04.fromHub"));
    }
  });

  it("names no one: a role this page does not know is a community alert, with no name", () => {
    const origin = originOf(entry({ attribution: { role: "ambassador", rsn: "4154146" } }), en);

    expect(origin.attribution).toBe("Community alert");
    expect(JSON.stringify(origin)).not.toContain("4154146");
  });
});

describe("the times of an alert", () => {
  it("are measured from the feed's clock: posted 20 minutes ago, valid until today at 3:00 PM", () => {
    const v = view({ entries: [entry({ published_at: "2026-10-01T14:40:00.000Z" })] });

    expect(v.times).toBe("Posted 20 minutes ago");
    expect(v.valid?.replace(/[  ]/g, " ")).toBe("Valid until today at 3:00 PM");
    expect(v.ended).toBeNull();
  });

  it("are the same for a phone with any clock: nothing here reads one", () => {
    const real = Date.now;
    Date.now = () => new Date("2031-01-01T00:00:00Z").getTime();
    try {
      expect(view().times).toBe("Posted 20 minutes ago");
    } finally {
      Date.now = real;
    }
  });

  it("say posted and updated for a thread with an update", () => {
    const v = view({ entries: [entry({ n: 1, published_at: "2026-10-01T13:00:00.000Z" }), entry({ n: 2, kind: "update", published_at: "2026-10-01T14:55:00.000Z" })] });

    expect(v.times).toBe("Posted 2 hours ago · Updated 5 minutes ago");
  });

  it("give the home card the prototype's R-03 line: Posted for one entry, Updated once there is an update", () => {
    expect(view({ entries: [entry({ published_at: "2026-10-01T14:40:00.000Z" })] }).cardTime).toBe("Posted 20 minutes ago");
    const v = view({ entries: [entry({ n: 1, published_at: "2026-10-01T13:00:00.000Z" }), entry({ n: 2, kind: "update", published_at: "2026-10-01T14:55:00.000Z" })] });
    expect(v.cardTime).toBe("Updated 5 minutes ago");
  });

  it("carry each entry's phase in the catalog's status words, and none for an entry without one", () => {
    const v = view({
      entries: [
        entry({ n: 1, published_at: "2026-10-01T13:00:00.000Z", phase: "problem" }),
        entry({ n: 2, kind: "update", published_at: "2026-10-01T14:00:00.000Z", phase: "in_progress" }),
        entry({ n: 3, kind: "update", published_at: "2026-10-01T14:30:00.000Z", phase: undefined }),
      ],
    });
    expect(v.entries.map((e) => e.phase)).toEqual([null, "Work in progress", "Active problem"]);
  });

  it("say the alert has ended, and no valid line, once its time has passed and nothing closed it yet", () => {
    const v = view({ valid_until: "2026-10-01T14:00:00.000Z" });

    expect(v.valid).toBeNull();
    expect(v.ended).toBe(en("R07.expiredNote"));
    expect(v.ended).toBe("This alert reached its end time without a final update.");
  });
});

describe("what to do", () => {
  it("is the guide that matches, opened at During, named in the page language", () => {
    const v = view({ types: ["elevator", "power"] });

    expect(v.guides).toEqual([
      { id: "elevator", label: "What to do: the elevator failure guide", href: "/en/ready/elevator#during" },
      { id: "power", label: "What to do: the power outage guide", href: "/en/ready/power#during" },
    ]);
  });

  it("is no guide for a type that has none", () => {
    expect(view({ types: ["other"] }).guides).toEqual([]);
  });

  it("follows the page language in the link and in the words", () => {
    const v = view({ types: ["power"] }, "ur");

    expect(v.guides[0].href).toBe("/ur/ready/power#during");
    expect(v.guides[0].label).toBe(translatorFor("ur")("R07.guide", { hazard: translatorFor("ur")("hazards.power").toLocaleLowerCase("ur") }));
  });
});
