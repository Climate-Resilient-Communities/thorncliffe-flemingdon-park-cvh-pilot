import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BuildingFloorPlan } from "@/modules/places";
import { LogBody, type LogAction } from "./LogBody";
import type { LogState } from "./logDisruption";
import { logScreen } from "./view";

const PLANS: BuildingFloorPlan[] = [
  { rsn: "7001", address: "45 Thorncliffe Park Dr", neighbourhoodId: "TP", neighbourhoodName: "Thorncliffe Park", floors: [{ id: "01900000-0000-7000-8000-000000000f01", label: "G", sortOrder: 0 }] },
  { rsn: "7002", address: "4 Milepost Pl", neighbourhoodId: "FP", neighbourhoodName: "Flemingdon Park", floors: [] },
];
const NOW = new Date("2026-10-04T13:30:00.000Z");
const noop: LogAction = async () => ({ status: "idle" });

const html = (kind: "ack" | "update" = "ack", initialState?: LogState, typed?: Parameters<typeof logScreen>[2]["typed"]) =>
  renderToStaticMarkup(<LogBody screen={logScreen(PLANS, NOW, { kind, typed })} action={noop} initialState={initialState} />);

const tags = (out: string, name: string) => (out.match(/<input [^>]*>/g) ?? []).filter((tag) => tag.includes(` name="${name}"`));

describe("O-11, log a disruption", () => {
  const out = html();

  it("has its heading, the aim that is not a promise, and one form with one Continue button", () => {
    expect(out).toContain("<h1>Log a disruption</h1>");
    expect(out).toContain("Aim: the acknowledgement out within 5 to 10 minutes of the first report.");
    expect(out.match(/<form /g)).toHaveLength(1);
    expect(out.match(/type="submit"/g)).toHaveLength(1);
    expect(out).toContain('name="kind" value="ack"');
  });

  it("links the procedure for writing and approving an alert under its lead, and a drill's start to the drill's (S09.03)", () => {
    expect(out).toContain('href="https://github.com/Climate-Resilient-Communities/thorncliffe-flemingdon-park-cvh-pilot/blob/main/docs/procedures/write-and-approve-an-alert.md"');
    expect(out).toContain(">Procedure: writing and approving an alert (opens in a new tab)</a>");
    expect(out.indexOf('data-testid="procedure-link"')).toBeLessThan(out.indexOf("<form "));
    const drill = renderToStaticMarkup(<LogBody screen={logScreen(PLANS, NOW, { kind: "ack", drill: true })} action={noop} />);
    expect(drill).toContain('data-procedure="run-a-drill"');
  });

  it("lists every type as a checkbox in its own label, the building ones and then the neighbourhood-wide ones, none ticked", () => {
    const boxes = tags(out, "type");
    expect(boxes.map((tag) => /value="([^"]+)"/.exec(tag)?.[1])).toEqual(["power", "water", "elevator", "fire", "flood", "other", "heat", "smoke", "winter"]);
    expect(boxes.every((tag) => !tag.includes('checked=""'))).toBe(true);
    expect(out.match(/<label class="hub-choice"><input type="checkbox" name="type"/g)).toHaveLength(9);
  });

  it("has the place picker of the place page with nothing chosen", () => {
    expect(out).toContain('name="scope"');
    expect(out.match(/data-testid="building-\d+"/g)).toHaveLength(2);
    expect(tags(out, "scope").every((tag) => !tag.includes('checked=""'))).toBe(true);
    expect(tags(out, "building").every((tag) => !tag.includes('checked=""'))).toBe(true);
  });

  it("sets the time of the first report to now, in Toronto time, as a date and a time that are required", () => {
    const [date] = tags(out, "reported-date");
    const [time] = tags(out, "reported-time");
    for (const [tag, value] of [[date, "2026-10-04"], [time, "09:30"]] as const) {
      expect(tag).toContain(`value="${value}"`);
      expect(tag).toContain('required=""');
    }
    expect(out).toContain("Time (Toronto time)");
  });

  it("uses the Hub's controls only", () => {
    const controls = out.match(/<input type="(?:checkbox|radio)"/g)?.length ?? 0;
    expect(out.match(/<label class="hub-choice"><input type="(?:checkbox|radio)"/g)?.length ?? 0).toBe(controls);
    for (const tag of (out.match(/<input [^>]*type="(?:date|time)"[^>]*>/g) ?? [])) expect(tag).toContain('class="hub-input"');
    expect(out).toContain('class="hub-button hub-button--primary"');
  });

  it("is the alert composer's first step, with its own words, for an update", () => {
    const update = html("update");
    expect(update).toContain("<h1>Compose an alert</h1>");
    expect(update).toContain('name="kind" value="update"');
  });
});

describe("a refusal", () => {
  it("says why next to the form and keeps the types typed before it", () => {
    const out = html("ack", { status: "refused", message: "Choose at least one type." }, { types: ["power", "heat"] });
    expect(out).toContain('id="log-error"');
    expect(out).toContain("Choose at least one type.");
    expect(out).toContain('role="alert"');
    const ticked = tags(out, "type").filter((tag) => tag.includes('checked=""')).map((tag) => /value="([^"]+)"/.exec(tag)?.[1]);
    expect(ticked).toEqual(["power", "heat"]);
    expect(out).toContain('aria-describedby="log-error"');
  });

  it("asks before or after, with both readings as radios, none chosen, when the time is in the repeated hour", () => {
    const out = html("ack", { status: "ask", question: "1:30 a.m. happens twice on Sunday, November 1.", before: "Before the clock change (1:30 a.m. EDT)", after: "After the clock change (1:30 a.m. EST)" });
    const radios = tags(out, "reported-fold");
    expect(radios).toHaveLength(2);
    expect(radios.every((tag) => !tag.includes('checked=""'))).toBe(true);
    expect(out).toContain("happens twice");
    expect(out).toContain("Before the clock change (1:30 a.m. EDT)");
    expect(out).toContain("After the clock change (1:30 a.m. EST)");
  });

  it("shows no error and no question when nothing was refused", () => {
    const out = html();
    expect(out).not.toContain('role="alert"');
    expect(tags(out, "reported-fold")).toHaveLength(0);
  });
});
