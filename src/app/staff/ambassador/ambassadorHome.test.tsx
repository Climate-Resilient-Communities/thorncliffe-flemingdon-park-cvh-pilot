import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AMBASSADOR_POST_STATES, type AmbassadorAlert, type AmbassadorPost } from "@/modules/alerting";
import { AmbassadorHomeBody } from "./AmbassadorHomeBody";
import { ambassadorHomeView, type AmbassadorHomeData } from "./view";

const ALERT = "01900000-0000-7000-8000-00000000a1e7";
const ENTRY = "01900000-0000-7000-8000-00000000e17a";
const BUILDING = { rsn: "7001", address: "4 Milepost Pl", floorLabels: ["3", "4", "5"] as readonly string[] | null };

const alert = (over: Partial<AmbassadorAlert> = {}): AmbassadorAlert => ({
  alertId: ALERT,
  slug: "abcd2345",
  types: ["power", "elevator"],
  headline: "Power is out in 4 Milepost Pl.",
  verified: true,
  publishedAt: new Date("2026-10-04T14:00:00.000Z"),
  validUntil: new Date("2026-10-05T14:00:00.000Z"),
  buildings: ["7001"],
  ...over,
});
const post = (over: Partial<AmbassadorPost> = {}): AmbassadorPost => ({
  entryId: ENTRY,
  alertId: ALERT,
  types: ["water"],
  text: "No water on floors 3 to 5.",
  state: "live",
  note: null,
  postedAt: new Date("2026-10-04T14:30:00.000Z"),
  buildings: ["7001"],
  ...over,
});
const data = (over: Partial<AmbassadorHomeData> = {}): AmbassadorHomeData => ({ buildings: [BUILDING], alerts: [], posts: [], round: null, ...over });

describe("the Ambassador's home (A-01)", () => {
  it("says which building and floors are theirs, in words, whole building or listed floors", () => {
    expect(ambassadorHomeView(data()).assigned).toEqual(["You are the ambassador for 4 Milepost Pl, floors 3, 4, 5."]);
    expect(ambassadorHomeView(data({ buildings: [{ ...BUILDING, floorLabels: null }] })).assigned).toEqual(["You are the ambassador for 4 Milepost Pl, all floors."]);
    expect(ambassadorHomeView(data({ buildings: [BUILDING, { rsn: "7002", address: "6 Milepost Pl", floorLabels: null }] })).title).toBe("My buildings");
    expect(ambassadorHomeView(data()).title).toBe("My building");
  });

  it("lists the open alerts about their buildings, newest first, with who said it, whether it is verified, the text residents read and the page residents read it on", () => {
    const view = ambassadorHomeView(
      data({
        alerts: [
          alert(),
          alert({ alertId: "01900000-0000-7000-8000-00000000a1e8", slug: "zzzz9999", types: ["water"], verified: false, headline: "Water is off.", publishedAt: new Date("2026-10-04T15:00:00.000Z") }),
        ],
      }),
    );
    expect(view.active.items.map((item) => item.title)).toEqual(["Water", "Power, Elevator"]);
    expect(view.active.items[0]).toMatchObject({
      headline: "Water is off.",
      meta: expect.stringMatching(/^From the Hub · Not yet verified · Posted /),
      about: "About 4 Milepost Pl",
      link: { href: "/en/alerts/zzzz9999", label: "See what residents read" },
    });
    expect(view.active.items[1].meta).toMatch(/^From the Hub · Verified · Posted /);
  });

  it("says nothing is active, and that nothing was posted, when there is nothing", () => {
    const view = ambassadorHomeView(data());
    expect(view.active.none).toBe("Nothing active in your buildings.");
    expect(view.active.items).toEqual([]);
    expect(view.posts.none).toBe("You have not posted an update yet.");
  });

  it("lists their own posts newest first, each with its state in the prototype's words, and the note of a post the Hub sent back", () => {
    const view = ambassadorHomeView(
      data({
        posts: [
          post({ state: "waiting" }),
          post({ entryId: "01900000-0000-7000-8000-00000000e17b", state: "returned", note: "Which floors?", postedAt: new Date("2026-10-04T16:00:00.000Z") }),
          post({ entryId: "01900000-0000-7000-8000-00000000e17c", state: "verified", postedAt: new Date("2026-10-04T12:00:00.000Z") }),
        ],
      }),
    );
    expect(view.posts.title).toBe("Your updates");
    expect(view.posts.items.map((item) => item.state)).toEqual(["Sent back to you by the Hub", "Waiting for the Hub", "Verified by the Hub"]);
    expect(view.posts.items[0].note).toBe("Note from the Hub: Which floors?");
    expect(view.posts.items[1].note).toBeNull();
    expect(view.posts.items[1].title).toMatch(/^Water · Posted /);
  });

  it("words every state an own post can be in", () => {
    for (const state of AMBASSADOR_POST_STATES) {
      const words = ambassadorHomeView(data({ posts: [post({ state })] })).posts.items[0].state;
      expect(words, state).not.toBe("");
      expect(words, state).not.toMatch(/^A03\.|^staff\./);
    }
    // S08.02: a post its alert's close discarded is not "Not sent by the Hub".
    expect(ambassadorHomeView(data({ posts: [post({ state: "ended" })] })).posts.items[0].state).toBe("Not sent: the alert ended before the Hub checked it");
    expect(ambassadorHomeView(data({ posts: [post({ state: "declined" })] })).posts.items[0].state).toBe("Not sent by the Hub");
    expect(ambassadorHomeView(data({ posts: [post({ state: "live" })] })).posts.items[0].state).toBe("Live. Not yet verified");
  });

  it("shows 'Your round' with the count of requests while a round is open, and says no round is open otherwise", () => {
    expect(ambassadorHomeView(data({ round: { requests: 7 } })).round).toEqual({ title: "Your round", line: "7 check-in requests on your floors", none: null });
    expect(ambassadorHomeView(data({ round: { requests: 1 } })).round.line).toBe("1 check-in request on your floors");
    expect(ambassadorHomeView(data({ round: { requests: 0 } })).round.line).toBe("0 check-in requests on your floors");
    expect(ambassadorHomeView(data()).round).toEqual({ title: "Your round", line: null, none: expect.stringMatching(/^No check-in round right now/) });
  });

  it("tells a person with no assignment so, and lists nothing about buildings", () => {
    const view = ambassadorHomeView(data({ buildings: [] }));
    expect(view.notAssigned).toMatch(/^You are not assigned to a building/);
    expect(view.assigned).toEqual([]);
    expect(renderToStaticMarkup(<AmbassadorHomeBody view={view} />)).toContain('data-testid="not-assigned"');
  });
});

describe("the Ambassador's home as drawn", () => {
  const html = renderToStaticMarkup(
    <AmbassadorHomeBody view={ambassadorHomeView(data({ alerts: [alert()], posts: [post(), post({ entryId: "01900000-0000-7000-8000-00000000e17b", state: "returned", note: "Which floors?" })], round: { requests: 3 } }))} />,
  );

  it("has the four parts in the order a phone needs them: the buildings, what is happening, their own posts, their round", () => {
    const order = ["<h1", 'data-testid="amb-active"', 'data-testid="amb-posts"', 'data-testid="amb-round"'].map((marker) => html.indexOf(marker));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("draws each alert and post once, with the round's count and a link to the page residents read", () => {
    expect(html.match(/data-testid="amb-alert"/g)).toHaveLength(1);
    expect(html.match(/data-testid="amb-post"/g)).toHaveLength(2);
    expect(html).toContain("3 check-in requests on your floors");
    expect(html).toContain('href="/en/alerts/abcd2345"');
    expect(html).toContain("Note from the Hub: Which floors?");
  });

  it("links to posting (S08.02): a new building update, and an update about each alert of the types an Ambassador posts; no link to a round yet", () => {
    expect(html).toContain('<a class="tap hub-link" href="/staff/ambassador/post" data-testid="amb-post-link">Post a building update</a>');
    expect(html).toContain(`href="/staff/ambassador/post?alert=${ALERT}" data-testid="amb-alert-post">Post an update about this</a>`);
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html).not.toContain("<button");
  });

  it("offers no update link on a neighbourhood-wide alert (heat), whose updates are the Hub's, and none to a person assigned to no building", () => {
    const heat = renderToStaticMarkup(<AmbassadorHomeBody view={ambassadorHomeView(data({ alerts: [alert({ types: ["heat"] })] }))} />);
    expect(heat).not.toContain('data-testid="amb-alert-post"');
    expect(ambassadorHomeView(data({ buildings: [] })).post).toBeNull();
  });

  it("says when the alert residents read is a building ambassador's post, not the Hub's", () => {
    expect(ambassadorHomeView(data({ alerts: [alert({ fromAmbassador: true })] })).active.items[0].meta).toMatch(/^From a building ambassador · /);
    expect(ambassadorHomeView(data({ alerts: [alert()] })).active.items[0].meta).toMatch(/^From the Hub · /);
  });

  it("lists the open drills about their buildings apart (S08.02), each with a practice post link, and no drills section without one", () => {
    const view = ambassadorHomeView(data({ drills: [{ alertId: ALERT, types: ["elevator"], headline: "Drill: the elevator is out.", buildings: ["7001"] }] }));
    expect(view.drills).toMatchObject({ title: "Exercises in your buildings", items: [{ title: "Elevator", about: "About 4 Milepost Pl", link: { href: `/staff/ambassador/post?alert=${ALERT}`, label: "Post a practice update" } }] });
    expect(renderToStaticMarkup(<AmbassadorHomeBody view={view} />)).toContain('data-testid="amb-drills"');
    expect(ambassadorHomeView(data()).drills).toBeNull();
  });
});
