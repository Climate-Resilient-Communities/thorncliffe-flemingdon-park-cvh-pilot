import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SubmissionRecord } from "@/modules/directory";
import { fromResidentView } from "../providers/residents";
import { acceptFromForm, declineFromForm, type DecideDeps } from "./review/decide";
import { DecideView } from "./review/DecideView";
import { decideLabels } from "./review/labels";
import { QueueBody } from "./QueueBody";
import { correctionLine, queueScreen, reviewHref, reviewScreen, whereRow } from "./view";

const NOW = new Date("2026-11-07T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const base: SubmissionRecord = {
  id: "01900000-0000-7000-8000-000000000001",
  ref: "SEED-2A2A",
  kind: "add",
  lang: "ur",
  type: "offer",
  name: "Thursday food bank",
  what: "Free groceries on Thursday evenings.",
  location: { kind: "building", rsn: "4154159", text: "the community room" },
  category: null,
  phone: null,
  web: null,
  cost: "notSure",
  idRequired: "no",
  stepFree: null,
  languages: ["ur", "en"],
  providerId: null,
  changes: null,
  status: "pending",
  declineReason: null,
  declineNote: null,
  decidedAt: null,
  appliedAt: null,
  createdAt: daysAgo(9),
};
const correction: SubmissionRecord = {
  ...base,
  id: "01900000-0000-7000-8000-000000000002",
  ref: "SEED-3C3C",
  kind: "correct",
  lang: "en",
  type: null,
  name: "Overlea Clinic",
  what: null,
  location: null,
  cost: null,
  idRequired: null,
  languages: null,
  providerId: "M014",
  changes: { where: "Second floor", cost: "free", phone: "416-555-0142" },
  createdAt: daysAgo(0),
};
const BUILDINGS = new Map([["4154159", "85 Thorncliffe Park Dr"]]);

describe("the moderation queue (O-08)", () => {
  it("counts what waits, says how old the oldest is and how many are past the week, and lists each with its type, language and flags", () => {
    const screen = queueScreen({ waiting: [base, correction], decided: [] }, NOW);
    expect(screen).toMatchObject({ waitingCount: 2, oldest: "9 days", overdueCount: 1, decided: [] });
    expect(screen.rows[0]).toMatchObject({
      href: `/staff/moderation/review?id=${base.id}`,
      name: "Thursday food bank",
      gloss: "Free groceries on Thursday evenings.",
      typeLabel: "Community offer",
      language: "Urdu",
      waited: "9 days",
      due: "Overdue by 2 days",
      overdue: true,
      flags: ["No category"],
      ref: "Reference SEED-2A2A",
    });
    expect(screen.rows[1]).toMatchObject({ typeLabel: "Correction", gloss: "Changes the place, cost and details of a place already on the map.", waited: "Sent today", due: "Due in 7 days", overdue: false, flags: [] });
  });

  it("lists what was decided with its decision and date", () => {
    const declined: SubmissionRecord = { ...base, status: "declined", declineReason: "advert", decidedAt: new Date("2026-11-05T15:00:00Z") };
    expect(queueScreen({ waiting: [], decided: [declined] }, NOW)).toMatchObject({ waitingCount: 0, oldest: "None", decided: [{ decision: "Declined: Selling or advertising on November 5, 2026", declined: true }] });
  });

  it("draws an empty queue as Nothing waiting, a Director's as read-only, and an unreadable one as an error", () => {
    const empty = renderToStaticMarkup(<QueueBody screen={queueScreen({ waiting: [], decided: [] }, NOW)} readOnly />);
    expect(empty).toContain("Nothing waiting");
    expect(empty).toContain("Only a Coordinator or an Admin can accept or decline.");
    expect(renderToStaticMarkup(<QueueBody screen={null} readOnly={false} />)).toContain("The queue could not be read.");
  });

  it("names what a correction changes in words", () => {
    expect(correctionLine({ name: "New name" })).toBe("Changes the name of a place already on the map.");
    expect(correctionLine({ idRequired: "no", stepFree: "yes" })).toBe("Changes the details of a place already on the map.");
  });
});

describe("a suggestion's review (O-09)", () => {
  it("shows a new place's answers in R-19's order, a missing kind flagged and Not sure marked, and the building's address", () => {
    const screen = reviewScreen({ submission: base, provider: null, waitingCount: 2, position: 1, next: { id: correction.id, name: "Overlea Clinic" } }, BUILDINGS, NOW);
    expect(screen).toMatchObject({ typeLabel: "Community offer", position: "1 of 2 waiting", wrote: { text: base.what, lang: "ur", english: false }, listed: null, decision: null });
    expect(screen.next).toEqual({ href: reviewHref(correction.id), label: "Next: Overlea Clinic" });
    expect(screen.rows.map((row) => [row.label, row.value, row.tone])).toEqual([
      ["Type", "Community offer", "plain"],
      ["Name", "Thursday food bank", "plain"],
      ["Category", "Not chosen", "missing"],
      ["Where", "Building 85 Thorncliffe Park Dr. the community room", "plain"],
      ["Phone", "Not given", "plain"],
      ["Website", "Not given", "plain"],
      ["Cost", "Not sure", "notSure"],
      ["Asks for ID or status", "No", "plain"],
      ["Step-free entrance", "Not given", "plain"],
      ["Languages spoken", "Urdu, English", "plain"],
    ]);
    expect(screen.checks).toEqual(["No category chosen. It still shows on the map and in search by name, but not under a topic.", "1 answer is Not sure. That is allowed. Residents see Not known."]);
  });

  it("shows a correction's changes beside the place as the Hub lists it now, or says the place is gone", () => {
    const listed = { id: "M014", name: "Overlea Clinic", street: "1 Overlea Blvd", phone: null, web: "https://example.org", published: false };
    const screen = reviewScreen({ submission: correction, provider: listed, waitingCount: 1, position: 1, next: null }, new Map(), NOW);
    expect(screen.rows.map((row) => `${row.label}: ${row.value}`)).toEqual(["Where: Second floor", "Phone: 416-555-0142", "Cost: Free"]);
    expect(screen.listed).toEqual({
      rows: [
        { label: "Name", value: "Overlea Clinic (M014)", tone: "plain" },
        { label: "Where", value: "1 Overlea Blvd", tone: "plain" },
        { label: "Phone", value: "Not given", tone: "plain" },
        { label: "Website", value: "https://example.org", tone: "plain" },
      ],
      note: "Not published to residents now.",
    });
    expect(screen.checks).toEqual(["Only the place, cost and details changes. Everything else about the place stays as it is."]);
    expect(reviewScreen({ submission: correction, provider: null, waitingCount: 1, position: 1, next: null }, new Map(), NOW).listed).toEqual({ rows: [], note: "This place is no longer in the directory." });
  });

  it("gives a pin a link to see it on a map, and an address as typed", () => {
    expect(whereRow({ kind: "pin", lat: 43.71723, lng: -79.33641 }, new Map())).toEqual({
      label: "Where",
      value: "Pin at 43.71723, -79.33641",
      tone: "plain",
      link: { href: "https://www.openstreetmap.org/?mlat=43.71723&mlon=-79.33641#map=18/43.71723/-79.33641", label: "Open the pin on OpenStreetMap" },
    });
    expect(whereRow({ kind: "address", text: "45 Overlea Blvd" }, new Map()).value).toBe("Address: 45 Overlea Blvd");
    expect(whereRow({ kind: "building", rsn: "999", text: null }, new Map()).value).toBe("A building that is no longer listed (register number 999)");
  });

  it("suggests the advert reason when the words or the cost read as selling, and says what the resident reads for each reason", () => {
    const selling = reviewScreen({ submission: { ...base, name: "Phone cases, 20% off" }, provider: null, waitingCount: 1, position: 1, next: null }, BUILDINGS, NOW);
    expect(selling.reasons.filter((r) => r.suggested).map((r) => r.id)).toEqual(["advert"]);
    expect(selling.reasons.find((r) => r.id === "noLocation")?.line).toBe("They read: We could not tell where it is.");
    expect(reviewScreen({ submission: base, provider: null, waitingCount: 1, position: 1, next: null }, BUILDINGS, NOW).reasons.some((r) => r.suggested)).toBe(false);
  });

  it("draws Accept with what accepting does, and on ?decline=1 the six reasons, the note and Send", () => {
    const screen = reviewScreen({ submission: base, provider: null, waitingCount: 1, position: 1, next: null }, BUILDINGS, NOW);
    const hrefs = { decline: reviewHref(base.id, true), review: reviewHref(base.id), queue: "/staff/moderation", next: null };
    const view = (declining: boolean) =>
      renderToStaticMarkup(<DecideView id={base.id} waiting declining={declining} reasons={screen.reasons} labels={decideLabels(base.name, "add")} hrefs={hrefs} answer={{ status: "idle" }} />);
    expect(view(false)).toContain("Accepting does not publish it.");
    expect(view(false)).toContain(`href="/staff/moderation/review?id=${base.id}&amp;decline=1"`);
    const decline = view(true);
    expect(decline.match(/type="radio"/g)).toHaveLength(6);
    expect(decline).toContain('maxLength="300"');
    expect(decline).toContain("Send the reason and decline");
    expect(decline).not.toContain("Accepting does not publish it.");
  });
});

describe("deciding from the forms", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };
  const deps = (result: Awaited<ReturnType<DecideDeps["accept"]>>, seen: unknown[] = []): DecideDeps => ({
    accept: async (...args) => (seen.push(["accept", ...args]), result),
    decline: async (...args) => (seen.push(["decline", ...args]), result),
  });
  const session = { staffId: "01900000-0000-7000-8000-0000000000aa" };

  it("accepts and says where it waits now", async () => {
    const seen: unknown[] = [];
    expect(await acceptFromForm(deps({ ok: true, name: "Thursday food bank", kind: "add" }, seen), session, form({ id: base.id }))).toEqual({
      status: "done",
      message: "“Thursday food bank” now waits on the Providers page for an Admin to add it to the catalogue.",
    });
    expect(seen).toEqual([["accept", session.staffId, base.id]]);
  });

  it("declines with a known reason and the note, and refuses an unknown reason before calling anything", async () => {
    const seen: unknown[] = [];
    const done = await declineFromForm(deps({ ok: true, name: "Thursday food bank", kind: "add" }, seen), session, form({ id: base.id, reason: "advert", note: "  Sells cases.  " }));
    expect(done).toEqual({ status: "done", message: "“Thursday food bank” was declined: Selling or advertising. The person who sent it reads the reason in their language with their reference." });
    expect(seen).toEqual([["decline", session.staffId, base.id, "advert", "Sells cases."]]);
    expect(await declineFromForm(deps({ ok: true, name: "x", kind: "add" }, seen), session, form({ id: base.id, reason: "rude" }))).toEqual({ status: "refused", message: "Choose a reason first." });
    expect(seen).toHaveLength(1);
  });

  it("says when someone else decided first, and when the save failed", async () => {
    expect(await acceptFromForm(deps({ ok: false, error: "already_decided" }), session, form({ id: base.id }))).toEqual({ status: "refused", message: "Someone already decided this one. Reload the page to see the decision." });
    const failing: DecideDeps = { accept: async () => Promise.reject(new Error("db down")), decline: async () => Promise.reject(new Error("db down")) };
    expect(await acceptFromForm(failing, session, form({ id: base.id }))).toEqual({ status: "refused", message: "That did not save. Try again." });
  });
});

describe("From residents on the Providers page", () => {
  it("names a new place with its type and where it is, and a correction with the provider and its changes", () => {
    const accepted = { ...base, status: "accepted" as const, decidedAt: new Date("2026-11-06T15:00:00Z") };
    expect(fromResidentView(accepted, BUILDINGS)).toMatchObject({
      kind: "New place · Community offer",
      accepted: "Accepted on November 6, 2026",
      rows: [{ label: "Where", value: "Building 85 Thorncliffe Park Dr. the community room" }],
      doneLabel: "Mark “Thursday food bank” as done",
    });
    expect(fromResidentView({ ...correction, status: "accepted" }, new Map())).toMatchObject({ kind: "Correction of M014", gloss: "Changes the place, cost and details of a place already on the map." });
  });
});
