import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PostForm } from "./PostForm";
import { fill, postScreen, type PostData } from "./view";

const FLOORS = Array.from({ length: 24 }, (_, index) => ({ id: `01900000-0000-7000-8000-0000000f${String(index + 1).padStart(4, "0")}`, label: String(index + 1) }));
const data = (over: Partial<PostData> = {}): PostData => ({
  buildings: [{ rsn: "7001", address: "4 Milepost Pl", floors: FLOORS }],
  thread: null,
  ids: { alertId: "01900000-0000-7000-8000-00000000a1e7", entryId: "01900000-0000-7000-8000-00000000e17a" },
  ...over,
});
/** A sender that never sends: the markup is drawn before any press. */
const quiet = () => ({ press: () => undefined, state: () => ({ kind: "idle" as const }), stop: () => undefined });

describe("the post screen (A-02, S08.02)", () => {
  const screen = postScreen(data());

  it("is the prototype's A-02 in words: the title, the one building they post for, and every type an Ambassador may post, heat and smoke not offered", () => {
    expect(screen.title).toBe("Post a building update");
    expect(screen.lead).toBe("You can post updates for any floor of 4 Milepost Pl.");
    expect(screen.types?.items.map((item) => item.id)).toEqual(["power", "water", "elevator", "fire", "flood", "other"]);
    expect(screen.types?.items.find((item) => item.id === "fire")).toMatchObject({ label: "Fire alarm or evacuation", more: null });
    expect(screen.types?.items.find((item) => item.id === "water")).toMatchObject({ label: "Water", more: "or plumbing" });
    expect(screen.types?.items.map((item) => item.id)).not.toContain("heat");
    expect(screen.types?.notOffered).toBe("Heat and smoke come from the Hub for the whole neighbourhood.");
  });

  it("shows the attribution residents will read before Submit, a building ambassador of the building, never a person's name", () => {
    expect(fill(screen.bar.appearsAs, { building: "4 Milepost Pl" })).toBe("This will appear as: Building ambassador, 4 Milepost Pl");
    const html = renderToStaticMarkup(<PostForm screen={screen} sender={quiet} />);
    expect(html).toContain('data-testid="post-appears-as">This will appear as: Building ambassador, 4 Milepost Pl</p>');
    expect(html).toContain("The Hub will check this before it goes out.");
    expect(html).toContain("Post update: whole building");
  });

  it("asks for the floors as the whole building, some floors or a range, where things stand, until when, and the English text", () => {
    const html = renderToStaticMarkup(<PostForm screen={screen} sender={quiet} />);
    for (const words of ["Which floors?", "Whole building · All 24 floors", "Some floors · Tick each floor", "A range of floors · From one floor to another", "Where things stand", "There is a problem", "Work is under way", "Until when?", "Until it is fixed (24 hours from now)", "Until a date and time", "What is happening, in English"]) {
      expect(html, words).toContain(words);
    }
    // No 911 block until Other is chosen: it is placed first for Other, with its own words.
    expect(html).not.toContain('data-component="not-911"');
  });

  it("names the refusals in words, and an unknown code falls back to a general one", () => {
    expect(screen.errors.OUT_OF_SCOPE).toBe("You are not assigned to this building now, so you cannot post for it.");
    expect(screen.errors.AUTHOR_NOT_ALLOWED).toBe(screen.errors.OUT_OF_SCOPE);
    expect(screen.errors.VALID_UNTIL_SKIPPED).toMatch(/clocks change/);
    expect(screen.errors.fallback).toBe("This was not sent. Try again. If it keeps happening, call the Hub.");
    expect(screen.status.unsent).toBe("Not sent yet. Keep this page open; it sends when you have signal.");
    expect(screen.status.unsentClose).toBe("If you close this page, this update is lost.");
  });

  it("offers the quick phrases, and the Other phrases with the line Other requires", () => {
    expect(screen.text.phrases).toEqual(["Building staff have been told.", "Use the stairs with care.", "Please check on neighbours who may need help."]);
    expect(screen.other.phrases).toHaveLength(3);
    expect(screen.other.textLabel).toBe("Say what is happening, in one line");
    expect(screen.other.error).toBe("Other needs one line: say what is happening.");
  });

  it("asks which building when the person has several, and has no lead naming one", () => {
    const two = postScreen(data({ buildings: [...data().buildings, { rsn: "7002", address: "6 Milepost Pl", floors: FLOORS }] }));
    expect(two.lead).toBeNull();
    const html = renderToStaticMarkup(<PostForm screen={two} sender={quiet} />);
    expect(html).toContain("Which building?");
    expect(html).toContain("6 Milepost Pl");
  });

  it("in a drill, is a practice post with the exercise marker, going to the Hub only, and keeps the drill's types", () => {
    const drill = postScreen(data({ thread: { id: "01900000-0000-7000-8000-00000000d111", isDrill: true, headline: "Drill: the elevator is out.", types: ["elevator"] } }));
    expect(drill.exercise).toBe("Exercise: this post is practice. It goes to the Hub only, never to residents.");
    expect(drill.bar.outcome).toBe("Practice: this goes to the Hub only. Nothing is sent to residents.");
    expect(drill.types).toBeNull();
    expect(drill.fixedTypes).toEqual(["elevator"]);
    expect(drill.done).toMatchObject({ title: "Practice post saved", line: "This is an exercise. Nothing was sent to residents.", anotherHref: "/staff/ambassador/post?alert=01900000-0000-7000-8000-00000000d111" });
    const html = renderToStaticMarkup(<PostForm screen={drill} sender={quiet} />);
    expect(html).toContain('data-testid="post-exercise"');
    expect(html).toContain("This update goes in the alert: Drill: the elevator is out.");
  });

  it("once sent, says 'Live. Not yet verified' for a post residents already read (S08.04), 'Waiting for the Hub' for one they do not, and links to where it stands", () => {
    const live = renderToStaticMarkup(<PostForm screen={screen} sender={quiet} initial={{ state: { kind: "done", live: true } }} />);
    expect(live).toContain('data-testid="post-done-title">Live. Not yet verified</h1>');
    expect(live).toContain('Residents can read this on the web now, marked &quot;Not yet verified&quot;. Text messages go out only after the Hub approves it.');
    expect(live).toContain('href="/staff/ambassador/status?entry=01900000-0000-7000-8000-00000000e17a" data-testid="post-done-status">Where it stands</a>');
    const waiting = renderToStaticMarkup(<PostForm screen={screen} sender={quiet} initial={{ state: { kind: "done" } }} />);
    expect(waiting).toContain('data-testid="post-done-title">Waiting for the Hub</h1>');
    expect(waiting).not.toContain("Live. Not yet verified");
    // A practice post has no status page and is never live.
    const drill = postScreen(data({ thread: { id: "01900000-0000-7000-8000-00000000d111", isDrill: true, headline: "Drill.", types: ["elevator"] } }));
    expect(drill.done.status).toBeNull();
    expect(drill.done.live).toBeNull();
    const practice = renderToStaticMarkup(<PostForm screen={drill} sender={quiet} initial={{ state: { kind: "done", live: true } }} />);
    expect(practice).toContain("Practice post saved");
    expect(practice).not.toContain("Live. Not yet verified");
  });

  it("for an update to a real alert, waits for the Hub and says which alert it goes in", () => {
    const update = postScreen(data({ thread: { id: "01900000-0000-7000-8000-00000000a222", isDrill: false, headline: "Power is out.", types: ["power"] } }));
    expect(update.exercise).toBeNull();
    expect(update.bar.outcome).toBe("The Hub will check this before it goes out.");
    expect(update.thread?.typesLine).toBe("What is happening: Power");
    expect(update.done.title).toBe("Waiting for the Hub");
  });
});
