import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LaunchCode } from "@/i18n/languages";
import { AlertCard } from "./alert-card";
import { AlertDetail } from "./alert-detail";
import { alertView } from "./alert-view";
import { ENGLISH, ID, SERVER_NOW, URDU, englishEntry, entry, fallbackEntry, thread, translatorFor } from "./alert-test-helpers";
import { VerifiedExplainer } from "./verified-explainer";

const render = (t: Parameters<typeof thread>[0], lang: "en" | "ur" | "fr" = "en") => {
  const translate = translatorFor(lang);
  const view = alertView(thread(t), { lang: lang as LaunchCode, serverNow: SERVER_NOW, t: translate });
  return renderToStaticMarkup(<AlertDetail view={view} lang={lang as LaunchCode} t={translate} />);
};
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

describe("alert detail (R-07)", () => {
  it("shows the type words and icons (X-13) as the page's heading, each type with its icon and its words", () => {
    const html = render({ types: ["elevator", "power"], entries: [englishEntry()] });

    expect(html).toMatch(/<h1 class="alert-types alert-types--lg" data-testid="alert-types">/);
    expect(html).toContain('data-testid="alert-type-elevator"');
    expect(html).toContain('<span class="alert-ico alert-ico--elevator" aria-hidden="true"></span>');
    expect(html).toContain(">Elevator<");
    expect(html).toContain('data-testid="alert-type-power"');
    expect(html).toContain('<span class="alert-ico alert-ico--power" aria-hidden="true"></span>');
    expect(html).toContain(">Power<");
  });

  it("shows the origin and verification marker (X-02): the Hub's sentence, 'Verified by the Hub', and a link to what verified means (R-28)", () => {
    const html = render({ entries: [englishEntry()] });

    expect(html).toContain('data-testid="alert-attribution"');
    expect(html).toContain("Community alert from the Hub");
    expect(html).toContain("Verified by the Hub");
    expect(html).toMatch(/<a class="alert-verify alert-verify--verified tap"[^>]*data-testid="alert-whatmeans"[^>]*href="\/en\/alerts\/kbcdfghj\/verified"/);
    expect(html).toContain("What this means");
    expect(html).toContain('<span class="alert-ico alert-ico--verified" aria-hidden="true"></span>');
  });

  it("marks an alert that is not yet verified in words, in shape and with its own icon, not in colour alone", () => {
    const html = render({ entries: [englishEntry({ verified: false })] });

    expect(html).toContain("Not yet verified");
    expect(html).toContain("alert-verify--unverified");
    expect(html).toContain('alert-ico--unverified');
    expect(html).toContain('data-verified="false"');
    expect(html).not.toContain("Verified by the Hub");
  });

  it("shows the text with the machine-translation label (X-04) and 'Read it in English', whose body is the English in English, left to right", () => {
    const html = render({ entries: [entry()] }, "ur");

    expect(html).toContain(`lang="ur" dir="rtl" data-testid="alert-text">${URDU}</p>`);
    expect(html).toContain('data-testid="alert-mt"');
    expect(html).toContain('alert-ico--language');
    expect(html).toContain('data-testid="alert-english"');
    expect(html).toContain('<summary class="tap" data-testid="alert-english-toggle">');
    expect(html).toContain(`<p class="alert-text" lang="en" dir="ltr" data-testid="alert-english-body">${ENGLISH}</p>`);
    // Native disclosure: closed until the resident opens it, and it works with no script.
    expect(html).toContain('<details class="alert-english"');
    expect(html).not.toContain("<details open");
  });

  it("has no label and nothing to show for text that is English already, and no note", () => {
    const html = render({ entries: [englishEntry()] });

    expect(html).not.toContain('data-testid="alert-mt"');
    expect(html).not.toContain('data-testid="alert-english"');
    expect(html).not.toContain('data-testid="alert-unavailable"');
    expect(html).toContain(`data-testid="alert-text">${ENGLISH}</p>`);
  });

  it("shows the English with 'Translation not available' in the resident's language for a fallback language", () => {
    const html = render({ entries: [fallbackEntry()] }, "ur");
    const ur = translatorFor("ur");

    // The English, left to right, marked as unavailable for a test and for a screen reader's voice.
    expect(html).toContain(`lang="en" dir="ltr" data-testid="alert-text" data-translation="unavailable">${ENGLISH}</p>`);
    // The note, in the resident's language: the catalog's `translation.unavailable` and its body, naming Urdu by its own name.
    expect(html).toContain('data-testid="alert-unavailable"');
    expect(html).toContain(ur("x04.unavailable"));
    expect(html).toContain(ur("x04.unavailableBody", { lang: "اردو" }));
    // It was not machine translated, so no label and no second English.
    expect(html).not.toContain('data-testid="alert-mt"');
    expect(html).not.toContain('data-testid="alert-english"');
  });

  it("says in English what the note says, for an English reader of a thread that fell back (the catalog's own words)", () => {
    expect(translatorFor("en")("x04.unavailable")).toBe("Not yet available in this language");
  });

  it("shows when it was posted and how long it is valid, against the feed's clock", () => {
    const html = render({ entries: [englishEntry({ published_at: "2026-10-01T14:40:00.000Z" })] });

    expect(html).toMatch(/data-testid="alert-times">Posted 20 minutes ago</);
    expect(html.replace(/[  ]/g, " ")).toMatch(/data-testid="alert-valid">Valid until today at 3:00 PM</);
    expect(html).not.toContain('data-testid="alert-ended"');
  });

  it("says the alert's time has passed when it has, and shows no valid line", () => {
    const html = render({ valid_until: "2026-10-01T14:00:00.000Z", entries: [englishEntry()] });

    expect(html).toContain('data-testid="alert-ended"');
    expect(html).toContain("This alert reached its end time without a final update.");
    expect(html).not.toContain('data-testid="alert-valid"');
  });

  it("has the not-911 statement and the 911 block (X-01): the one catalog block, once, in its full form", () => {
    const html = render({ entries: [englishEntry()] });

    expect(count(html, /data-component="not-911"/g)).toBe(1);
    expect(html).toContain('data-variant="block"');
    expect(html).toContain("The CVH is not an emergency service.");
    expect(html).toContain("If someone is in danger, call 911.");
  });

  it("has the 911 block in the page's language", () => {
    const html = render({ entries: [englishEntry()] }, "fr");

    expect(count(html, /data-component="not-911"/g)).toBe(1);
    expect(html).toContain(translatorFor("fr")("x01.text").replace(/^\[EN\] /, "").replace(/'/g, "&#x27;"));
  });

  it("links to the matching guide, opened at During, for each type that has one, and to none for Other", () => {
    const html = render({ types: ["elevator", "power"], entries: [englishEntry()] });

    expect(html).toContain('href="/en/ready/elevator#during"');
    expect(html).toContain('href="/en/ready/power#during"');
    expect(html).toContain("What to do: the elevator failure guide");
    expect(html).toContain('data-testid="alert-guide-elevator"');
    const other = render({ types: ["other"], entries: [englishEntry()] });
    expect(other).not.toContain("/ready/");
    expect(other).not.toContain('data-testid="alert-actions"');
  });

  it("links the guide in the page language", () => {
    expect(render({ types: ["power"], entries: [englishEntry()] }, "ur")).toContain('href="/ur/ready/power#during"');
  });

  it("lists every entry of the thread, newest first, with the latest marked, once there is an update", () => {
    const html = render({
      entries: [
        englishEntry({ n: 1, published_at: "2026-10-01T13:00:00.000Z" }),
        englishEntry({ n: 2, kind: "update", published_at: "2026-10-01T14:30:00.000Z", text: { lang: "en", body: "Update: power is back on floors 1 to 4.", machine: false, model: null, status: "source", source_hash: "b".repeat(64) } }),
      ],
    });

    expect(html).toContain('data-testid="alert-thread"');
    expect(html.indexOf(`data-testid="alert-entry-${ID(2)}"`)).toBeLessThan(html.indexOf(`data-testid="alert-entry-${ID(1)}"`));
    expect(html).toContain("Updates, newest first");
    expect(html).toContain("Update: power is back on floors 1 to 4.");
    expect(count(html, /class="alert-tag"/g)).toBe(1);
    expect(html).toContain("alert-entry--latest");
  });

  it("reads a thread newest first by the entries' own times, whatever order the feed lists them in (entriesNewestFirst), with the catalog's words for the thread, the kinds, the times and the valid-until", () => {
    const body = (text: string) => ({ lang: "en" as const, body: text, machine: false, model: null, status: "source" as const, source_hash: "b".repeat(64) });
    const entries = [
      englishEntry({ n: 2, kind: "update", published_at: "2026-10-01T14:00:00.000Z", text: body("Update one.") }),
      englishEntry({ n: 4, kind: "final", published_at: "2026-10-01T14:50:00.000Z", text: body("Final word.") }),
      englishEntry({ n: 1, kind: "ack", published_at: "2026-10-01T13:00:00.000Z", text: body("First word.") }),
      englishEntry({ n: 3, kind: "correction", published_at: "2026-10-01T14:30:00.000Z", text: body("Corrected word.") }),
    ];
    const en = translatorFor("en");
    const html = render({ entries, valid_until: "2026-10-01T19:00:00.000Z" });

    // Newest first, from the entries' times and not from the order they arrive in; the alert above is the newest.
    const positions = [4, 3, 2, 1].map((n) => html.indexOf(`data-testid="alert-entry-${ID(n)}"`));
    expect(positions[3]).toBeGreaterThan(-1);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(html).toContain(`data-testid="alert-text">Final word.</p>`);
    // The catalog's words: the thread's heading, one label per kind, the one "Latest" tag, the times and the valid-until line.
    expect(html).toContain(en("R07.thread"));
    for (const kind of ["ack", "update", "correction", "final"]) expect(html).toContain(`>${en(`R07.kinds.${kind}`)}<`);
    expect(count(html, new RegExp(`>${en("R07.latestTag")}<`, "g"))).toBe(1);
    expect(html).toContain(en("R07.timeLine", { posted: "2 hours ago", updated: "10 minutes ago" }));
    expect(html.replace(/[  ]/g, " ")).toMatch(/data-testid="alert-valid">Valid until today at 3:00 PM</);
    expect(count(html, /alert-entry--latest/g)).toBe(1);
  });

  it("draws each entry's phase in the catalog's status words (status.active, status.progress), on the entry that reported it, in English and Urdu", () => {
    const entries = [
      englishEntry({ n: 1, kind: "ack", phase: "problem", published_at: "2026-10-01T13:00:00.000Z" }),
      englishEntry({ n: 2, kind: "update", phase: "in_progress", published_at: "2026-10-01T14:30:00.000Z" }),
      englishEntry({ n: 3, kind: "update", phase: undefined, published_at: "2026-10-01T14:45:00.000Z" }),
    ];
    for (const lang of ["en", "ur"] as const) {
      const t = translatorFor(lang);
      const html = render({ entries }, lang);
      const phaseOf = (n: number) => html.match(new RegExp(`data-testid="alert-entry-phase-${ID(n)}"[^>]*>(?:<[^>]*>)*([^<]*)`))?.[1];
      expect(phaseOf(1), lang).toBe(t("status.active"));
      expect(phaseOf(2), lang).toBe(t("status.progress"));
      expect(html, lang).not.toContain(`alert-entry-phase-${ID(3)}`);
    }
    expect(translatorFor("en")("status.active")).toBe("Active problem");
    expect(translatorFor("en")("status.progress")).toBe("Work in progress");
  });

  it("has every word the thread uses in the catalog of each language: R07.thread, the kinds, the end-time note and the valid-until line (R07.earlier is not drawn by R-07)", () => {
    for (const lang of ["en", "ur", "fr"] as const) {
      const t = translatorFor(lang);
      for (const key of ["R07.thread", "R07.earlier", "R07.latestTag", "R07.expiredNote", "R07.timeLine", "R07.timeLineOne", "R07.kinds.ack", "R07.kinds.update", "R07.kinds.correction", "R07.kinds.final"]) {
        expect(t(key, { posted: "x", updated: "y" }), `${lang} ${key}`).not.toBe("");
      }
      expect(t("R07.validLine", { until: "z" })).toContain("z");
    }
    expect(translatorFor("en")("R07.earlier")).toBe("Earlier updates");
  });

  it("reads the same page from a thread listed newest first as from one listed oldest first", () => {
    const first = englishEntry({ n: 1, published_at: "2026-10-01T13:00:00.000Z" });
    const second = englishEntry({ n: 2, kind: "update", published_at: "2026-10-01T14:30:00.000Z" });
    expect(render({ entries: [second, first] })).toBe(render({ entries: [first, second] }));
  });

  it("has no thread list for an alert with one entry: it is the alert above", () => {
    expect(render({ entries: [englishEntry()] })).not.toContain('data-testid="alert-thread"');
  });

  it("names no person and shows no hash, model or id of an entry that a resident has no use for", () => {
    const html = render({ entries: [entry()] }, "ur");

    expect(html).not.toContain("north-small-translate");
    expect(html).not.toContain("a".repeat(64));
  });

  it("goes back to home", () => {
    expect(render({ entries: [englishEntry()] })).toMatch(/<a class="alert-back tap"[^>]*href="\/en"/);
  });
});

describe("the alert card on home", () => {
  const card = (t: Parameters<typeof thread>[0], lang: "en" | "ur" = "en") => {
    const translate = translatorFor(lang);
    return renderToStaticMarkup(
      <ul>
        <AlertCard view={alertView(thread(t), { lang, serverNow: SERVER_NOW, t: translate })} lang={lang} t={translate} />
      </ul>,
    );
  };

  it("is one link to the alert with its types, its words, who sent it, whether it is verified, and when it was posted", () => {
    const html = card({ entries: [englishEntry({ published_at: "2026-10-01T14:40:00.000Z" })] });

    expect(html).toMatch(/<a class="alert-card tap"[^>]*data-testid="alert-card-kbcdfghj"[^>]*href="\/en\/alerts\/kbcdfghj"/);
    expect(html).toContain(">Elevator<");
    expect(html).toContain(ENGLISH);
    expect(html).toContain("Community alert from the Hub");
    expect(html).toContain("Verified by the Hub");
    expect(html).toContain("Posted 20 minutes ago");
    expect(html).toContain("Read the alert");
  });

  it("holds no other link: a card that is a link is not a link inside a link", () => {
    const html = card({ entries: [entry()] });

    expect(count(html, /<a /g)).toBe(1);
    expect(html).not.toContain('data-testid="alert-whatmeans"');
  });

  it("sets an English text that stands in for a translation left to right in English on its own element", () => {
    const html = card({ entries: [fallbackEntry()] }, "ur");

    expect(html).toContain(`lang="en" dir="ltr" data-testid="alert-card-text-kbcdfghj" data-translation="unavailable">${ENGLISH}</p>`);
  });

  it("sets a translation in its own language", () => {
    expect(card({ entries: [entry()] }, "ur")).toContain(`lang="ur" dir="rtl" data-testid="alert-card-text-kbcdfghj">${URDU}</p>`);
  });
});

describe("what verified means (R-28)", () => {
  const explain = (t: Parameters<typeof thread>[0], lang: "en" | "ur" = "en") => {
    const translate = translatorFor(lang);
    const view = alertView(thread(t), { lang, serverNow: SERVER_NOW, t: translate });
    return renderToStaticMarkup(<VerifiedExplainer view={view} lang={lang} t={translate} />);
  };

  it("says who verified this alert and when, what the words mean and the words one will see, and links back to the alert", () => {
    const html = explain({ entries: [englishEntry({ published_at: "2026-10-01T14:40:00.000Z" })] });

    expect(html).toContain("What &quot;verified&quot; means");
    expect(html).toContain("The Hub verified this alert 20 minutes ago.");
    expect(html).toContain("Verified means someone at the Hub");
    expect(html).toContain("The words you will see on alerts");
    expect(html).toContain('data-testid="legend-verified" data-current="true"');
    expect(html).toContain('data-testid="legend-unverified" data-current="false"');
    expect(html).toContain('href="/en/alerts/kbcdfghj"');
    expect(html).toContain("Back to the alert");
  });

  it("says an alert that is not yet verified is not wrong, and that one can act on it", () => {
    const html = explain({ entries: [englishEntry({ verified: false })] });

    expect(html).toContain("Not yet verified does not mean it is wrong.");
    expect(html).toContain('data-testid="legend-unverified" data-current="true"');
    expect(html).not.toContain("verified this alert");
  });

  it("carries the 911 statement, in its short form as in the prototype", () => {
    const html = explain({ entries: [englishEntry()] });

    expect(count(html, /data-component="not-911"/g)).toBe(1);
    expect(html).toContain('data-variant="inline"');
  });

  it("is in the page language", () => {
    expect(explain({ entries: [entry()] }, "ur")).toContain('href="/ur/alerts/kbcdfghj"');
  });
});
