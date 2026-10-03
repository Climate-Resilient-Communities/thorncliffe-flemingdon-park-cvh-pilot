import fs from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Audience } from "@/contracts/audience";
import type { BuildingList } from "@/contracts/buildingList";
import en from "@/i18n/messages/en.json";
import ur from "@/i18n/messages/ur.json";
import { AlertCard } from "../alert/alert-card";
import { alertView } from "../alert/alert-view";
import { SERVER_NOW, thread, translatorFor } from "../alert/alert-test-helpers";
import { adviceFor, deviceProfile, tailorThreads } from "./tailoring";

const FLOOR_A = "0198a000-0000-7000-8000-0000000000a1";
const FLOOR_B = "0198a000-0000-7000-8000-0000000000a2";
const list: BuildingList = {
  v: 1,
  generated_at: "2026-10-01T12:00:00.000Z",
  buildings: [
    {
      rsn: "100",
      address: "1 Test St",
      neighbourhoodId: "TP",
      neighbourhood: "Thorncliffe Park",
      floors: [
        { id: FLOOR_A, label: "1" },
        { id: FLOOR_B, label: "2" },
      ],
    },
    {
      rsn: "200",
      address: "2 Test St",
      neighbourhoodId: "FP",
      neighbourhood: "Flemingdon Park",
      floors: [],
    },
  ],
};

const building = (
  rsn: string,
  floors: string[] | null = null,
  groups: Audience["groups"] = [],
): Audience => ({
  scope: "buildings",
  buildings: [{ rsn, floors }],
  groups,
  types: ["heat"],
});
const area = (id: string, groups: Audience["groups"] = []): Audience => ({
  scope: "neighbourhood",
  neighbourhood_ids: [id],
  groups,
  types: ["heat"],
});
const slugs = (rows: { thread: { slug: string } }[]) =>
  rows.map((row) => row.thread.slug);

const feedThreads = [
  { slug: "far", audience: building("200") },
  { slug: "area-fp", audience: area("FP") },
  { slug: "mine-b", audience: building("100") },
  { slug: "area-tp", audience: area("TP") },
  { slug: "seniors", audience: area("TP", ["seniors"]) },
];

describe("tailorThreads (S04.09)", () => {
  it("puts the alerts that match the profile first, the rest after, each in the feed's order, and drops none", () => {
    const profile = deviceProfile(
      { v: 1, buildings: ["100"], floors: [FLOOR_A], groups: ["families"] },
      list,
    );

    const rows = tailorThreads(feedThreads, profile);

    expect(slugs(rows)).toEqual([
      "mine-b",
      "area-tp",
      "far",
      "area-fp",
      "seniors",
    ]);
    expect(rows.map((row) => row.matched)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(rows.map((row) => row.highlighted)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect([...slugs(rows)].sort()).toEqual(
      feedThreads.map((t) => t.slug).sort(),
    );
  });

  it("decides with the shared matcher: a group alert is for those who chose the group, a floor alert for those on that floor or on none", () => {
    const profile = deviceProfile(
      { v: 1, buildings: ["100"], floors: [FLOOR_B], groups: ["seniors"] },
      list,
    );
    const rows = tailorThreads(
      [
        { slug: "floor-a", audience: building("100", [FLOOR_A]) },
        { slug: "floor-b", audience: building("100", [FLOOR_B]) },
        { slug: "seniors", audience: area("TP", ["seniors"]) },
        { slug: "families", audience: area("TP", ["families"]) },
      ],
      profile,
    );

    expect(rows.map((row) => [row.thread.slug, row.matched])).toEqual([
      ["floor-b", true],
      ["seniors", true],
      ["floor-a", false],
      ["families", false],
    ]);
  });

  it("marks nothing when every alert matches or none does, and keeps the feed's order", () => {
    const everyone = tailorThreads(
      [
        { slug: "a", audience: area("TP") },
        { slug: "b", audience: area("TP") },
      ],
      deviceProfile({ v: 1, buildings: ["100"] }, list),
    );
    expect(
      everyone.map((row) => [row.thread.slug, row.matched, row.highlighted]),
    ).toEqual([
      ["a", true, false],
      ["b", true, false],
    ]);

    const none = tailorThreads(
      [
        { slug: "a", audience: building("200") },
        { slug: "b", audience: area("FP") },
      ],
      deviceProfile({ v: 1, buildings: ["100"] }, list),
    );
    expect(
      none.map((row) => [row.thread.slug, row.matched, row.highlighted]),
    ).toEqual([
      ["a", false, false],
      ["b", false, false],
    ]);
  });

  it("is the feed's order, unmarked and unmatched, for a phone with nothing saved, with groups but no building, or while the building list is not ready", () => {
    const plain = (
      rows: ReturnType<typeof tailorThreads<(typeof feedThreads)[number]>>,
    ) => {
      expect(slugs(rows)).toEqual(feedThreads.map((t) => t.slug));
      expect(rows.some((row) => row.highlighted || row.matched)).toBe(false);
    };
    plain(tailorThreads(feedThreads, deviceProfile(null, null)));
    plain(
      tailorThreads(feedThreads, deviceProfile({ v: 1, welcomed: true }, list)),
    );
    plain(
      tailorThreads(
        feedThreads,
        deviceProfile({ v: 1, groups: ["seniors"] }, list),
      ),
    );
    expect(
      deviceProfile({ v: 1, buildings: ["100"], floors: [FLOOR_A] }, null),
    ).toBeNull();
    plain(
      tailorThreads(
        feedThreads,
        deviceProfile({ v: 1, buildings: ["100"], groups: ["seniors"] }, null),
      ),
    );
  });

  it("does not change the threads it is given", () => {
    const copy = JSON.stringify(feedThreads);
    tailorThreads(
      feedThreads,
      deviceProfile({ v: 1, buildings: ["100"] }, list),
    );
    expect(JSON.stringify(feedThreads)).toBe(copy);
  });
});

describe("adviceFor (S04.09)", () => {
  const catalog = (type: string, group: string) =>
    (en.tailored as Record<string, Record<string, string[]>>)[type]?.[group];

  it("gives the first line of the catalog for a type of the alert and a chosen group, in R-26's order of groups", () => {
    expect(adviceFor(["heat"], ["families", "seniors"], catalog)).toBe(
      en.tailored.heat.seniors[0],
    );
    expect(adviceFor(["heat"], ["families"], catalog)).toBe(
      en.tailored.heat.families[0],
    );
  });

  it("tries the alert's types in order and gives one line only", () => {
    expect(adviceFor(["other", "flood", "heat"], ["newcomers"], catalog)).toBe(
      en.tailored.flood.newcomers[0],
    );
    expect(
      typeof adviceFor(
        ["power", "heat"],
        ["seniors", "newcomers", "families"],
        catalog,
      ),
    ).toBe("string");
  });

  it("is null without a chosen group, for a group that is only a check-in, and for a type the catalog has no advice for", () => {
    expect(adviceFor(["heat"], [], catalog)).toBeNull();
    expect(adviceFor(["heat"], ["checkin"], catalog)).toBeNull();
    expect(adviceFor(["water", "other"], ["seniors"], catalog)).toBeNull();
  });

  it("never carries the name of a group: no line of the catalog says who it is for", () => {
    for (const [type, groups] of Object.entries(en.tailored)) {
      for (const group of Object.keys(groups)) {
        const line = adviceFor([type], [group], catalog)!;
        expect(line, `${type}.${group}`).toBeTruthy();
        expect(line, `${type}.${group}`).not.toMatch(
          /senior|newcomer|famil|older|elderly/i,
        );
      }
    }
  });
});

describe("the catalog of advice", () => {
  it("has advice for every group in the order R-26 offers, for every type that has any, and no empty line", () => {
    for (const [type, groups] of Object.entries(en.tailored)) {
      expect(Object.keys(groups), type).toEqual([
        "seniors",
        "newcomers",
        "families",
      ]);
      for (const lines of Object.values(groups))
        for (const line of lines) expect(line.trim()).not.toBe("");
    }
  });

  it("reaches every language with the same shape: translated, or English behind the [EN] marker", () => {
    const dir = path.join(__dirname, "../../i18n/messages");
    const english = en.tailored as Record<string, Record<string, string[]>>;
    for (const file of fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))) {
      const tailored = (
        JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as {
          tailored: Record<string, Record<string, string[]>>;
        }
      ).tailored;
      expect(Object.keys(tailored), file).toEqual(Object.keys(english));
      for (const [type, groups] of Object.entries(english)) {
        expect(Object.keys(tailored[type]), `${file} ${type}`).toEqual(
          Object.keys(groups),
        );
        for (const [group, lines] of Object.entries(groups)) {
          expect(tailored[type][group].length, `${file} ${type}.${group}`).toBe(
            lines.length,
          );
          tailored[type][group].forEach((line, i) => {
            expect(line.trim(), `${file} ${type}.${group}`).not.toBe("");
            if (line.startsWith("[EN] ")) expect(line).toBe(`[EN] ${lines[i]}`);
          });
        }
      }
    }
  });
});

describe("the card (S04.09)", () => {
  const t = translatorFor("en");
  const view = alertView(thread({ slug: "abcdefgh", types: ["heat"] }), {
    lang: "en",
    serverNow: SERVER_NOW,
    t,
  });

  it("is unchanged for an alert that is not tailored", () => {
    const html = renderToStaticMarkup(
      <AlertCard view={view} lang="en" t={t} />,
    );
    expect(html).not.toContain("alert-card--mine");
    expect(html).not.toContain("alert-advice");
    expect(html).not.toContain("data-highlighted");
  });

  it("is highlighted without a word about why, and adds the X-12 block with the one line, outside the link", () => {
    const line = en.tailored.heat.seniors[0];
    const html = renderToStaticMarkup(
      <AlertCard view={view} lang="en" t={t} highlighted advice={line} />,
    );

    expect(html).toContain("alert-card--mine");
    expect(html).toContain('data-highlighted="true"');
    expect(html).toContain('data-testid="alert-advice-abcdefgh"');
    expect(html).toContain("What this means for you");
    expect(html).toContain(line);
    const link = html.slice(html.indexOf("<a "), html.indexOf("</a>"));
    expect(link).not.toContain(line);
    for (const word of [
      "seniors",
      "Seniors",
      "newcomers",
      "families",
      "Tailored",
      "your choices",
      "chose",
    ])
      expect(html).not.toContain(word);
  });

  it("sets an English advice line behind the [EN] marker left to right in English, without the marker", () => {
    const html = renderToStaticMarkup(
      <AlertCard
        view={view}
        lang="en"
        t={t}
        advice={"[EN] Keep medicines close."}
      />,
    );

    expect(html).toContain(
      'lang="en" dir="ltr" data-translation="unavailable"',
    );
    expect(html).toContain("Keep medicines close.");
    expect(html).not.toContain("[EN] Keep");
  });
});
