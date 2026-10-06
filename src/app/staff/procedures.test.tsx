// The written procedures (S09.03): every page the Hub links exists in docs/procedures with its owner and last-reviewed date, the index lists every page, the
// rehearsal log lists every procedure, and each Hub screen that starts a procedure draws the same link to it.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HealthBanner } from "./HealthBanner";
import { ProcedureLink } from "./ProcedureLink";
import { DrillsView } from "./drills/DrillsView";
import { drillsView } from "./drills/view";
import { RosterView } from "./drills/roster/RosterView";
import { PeopleHeading } from "./people/PeopleHeading";
import { PROCEDURES_BASE_URL, SCREEN_PROCEDURES, approvalProcedure, composerProcedure, procedureLink } from "./procedures";
import { SpendBody } from "./spend/SpendBody";
import { TextsView } from "./texts/TextsView";

const DIR = path.join(__dirname, "..", "..", "..", "docs", "procedures");
/** The procedures no Hub screen starts: their pages say where they start instead. */
const SCREENLESS = ["messaging-service-change", "access-request"];
const PAGES = [...SCREEN_PROCEDURES, ...SCREENLESS];
const read = (file: string) => readFileSync(path.join(DIR, file), "utf8");

describe("docs/procedures", () => {
  it("has a page for each procedure, and no procedure page the index and the rehearsal log do not know", () => {
    for (const id of PAGES) expect(existsSync(path.join(DIR, `${id}.md`)), id).toBe(true);
    const onDisk = readdirSync(DIR).filter((file) => file.endsWith(".md") && file !== "README.md" && file !== "rehearsals.md");
    expect(onDisk.map((file) => file.replace(/\.md$/, "")).sort()).toEqual([...PAGES].sort());
  });

  it.each(PAGES)("%s names its owner and its last-reviewed date, and is written in steps", (id) => {
    const page = read(`${id}.md`);
    expect(page).toMatch(/^# .+/);
    expect(page).toMatch(/^\*\*Owner:\*\* .+$/m);
    const reviewed = /^\*\*Last reviewed:\*\* (\d{4}-\d{2}-\d{2})$/m.exec(page);
    expect(reviewed, "a last-reviewed date written YYYY-MM-DD").not.toBeNull();
    expect(new Date(`${reviewed![1]}T00:00:00Z`).toISOString().slice(0, 10)).toBe(reviewed![1]);
    expect(page).toMatch(/^1\. /m);
  });

  it("lists every page in the index, with its owner, and the rehearsal log lists every procedure", () => {
    const index = read("README.md");
    const log = read("rehearsals.md");
    for (const id of PAGES) {
      expect(index, id).toContain(`(${id}.md)`);
      expect(log, id).toContain(`(${id}.md)`);
    }
    expect(index).toContain("(rehearsals.md)");
    expect(index).toContain("(weekly-notes/README.md)");
  });

  it("never holds a secret's value, a phone number or an email address", () => {
    for (const file of readdirSync(DIR).filter((name) => name.endsWith(".md"))) {
      const page = read(file);
      expect(page, file).not.toMatch(/sb_secret_[A-Za-z0-9]|sk_[A-Za-z0-9]{10}|SK[0-9a-f]{32}|AC[0-9a-f]{32}/);
      // Fictional 555 numbers only (none is needed; the pages name roles, not people).
      for (const match of page.matchAll(/\+?1?[\s(.-]*([2-9]\d{2})[\s).-]*(\d{3})[\s.-]*\d{4}\b/g)) expect(match[2], file).toBe("555");
      expect(page, file).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/);
    }
  });
});

describe("the link to a procedure", () => {
  it("goes to the page on GitHub's main branch, in a new tab, with no referrer, in the same words everywhere", () => {
    const out = renderToStaticMarkup(<ProcedureLink link={procedureLink("pause-and-resume-texts")} />);
    expect(out).toBe(
      `<a class="tap hub-link hub-wrap" href="${PROCEDURES_BASE_URL}/pause-and-resume-texts.md" target="_blank" rel="noreferrer" data-testid="procedure-link" data-procedure="pause-and-resume-texts">Procedure: pausing and resuming texts (opens in a new tab)</a>`,
    );
    expect(PROCEDURES_BASE_URL).toBe("https://github.com/Climate-Resilient-Communities/thorncliffe-flemingdon-park-cvh-pilot/blob/main/docs/procedures");
    for (const id of SCREEN_PROCEDURES) expect(procedureLink(id).text, id).toMatch(/^Procedure: [a-z].+ \(opens in a new tab\)$/);
  });

  it("is chosen by what a composer or an approval is for", () => {
    expect(composerProcedure("ack", false)).toBe("write-and-approve-an-alert");
    expect(composerProcedure("compose", false)).toBe("write-and-approve-an-alert");
    expect(composerProcedure("update", false)).toBe("write-and-approve-an-alert");
    expect(composerProcedure("promote", false)).toBe("write-and-approve-an-alert");
    expect(composerProcedure("correct", false)).toBe("correct-or-withdraw");
    expect(composerProcedure("withdraw", false)).toBe("correct-or-withdraw");
    expect(composerProcedure("resolve", false)).toBe("close-an-alert");
    expect(composerProcedure("correct", true)).toBe("run-a-drill");
    expect(approvalProcedure("ack", false)).toBe("write-and-approve-an-alert");
    expect(approvalProcedure("update", false)).toBe("write-and-approve-an-alert");
    expect(approvalProcedure("correction", false)).toBe("correct-or-withdraw");
    expect(approvalProcedure("withdrawal", false)).toBe("correct-or-withdraw");
    expect(approvalProcedure("final", false)).toBe("close-an-alert");
    expect(approvalProcedure("final", true)).toBe("run-a-drill");
  });

  it.each([
    ["Pause or resume texts", () => <TextsView paused={null} form={null} />, "pause-and-resume-texts"],
    ["the drill roster", () => <RosterView count={2} forms={null} />, "run-a-drill"],
    ["Spend", () => <SpendBody screen={null} form={null} />, "cap-overrun"],
    ["the health banner", () => <HealthBanner view={{ heading: "Sending is failing", lines: ["Texts have waited more than 5 minutes to be sent."] }} />, "health-alert"],
    [
      "Drills",
      () => <DrillsView view={drillsView({ rosterSize: 2, drills: [] })} />,
      "run-a-drill",
    ],
    ["People (someone leaving)", () => <PeopleHeading />, "rotate-secrets"],
  ] as const)("is drawn on %s", (_, draw, id) => {
    const out = renderToStaticMarkup(draw());
    expect(out.match(/data-testid="procedure-link"/g)).toHaveLength(1);
    expect(out).toContain(`data-procedure="${id}"`);
  });
});
