import { describe, expect, it } from "vitest";
import type { ReleaseSummary } from "@/modules/directory";
import { directoryReleaseView } from "./view";

const NOW = new Date("2026-10-02T15:00:00Z");
const day = (date: Date) => date.toISOString().slice(0, 10);
const PROVIDERS = { published: 91, total: 99 };

const release = (change: Partial<ReleaseSummary> = {}): ReleaseSummary => ({
  number: 4,
  status: "complete",
  isCurrent: true,
  startedAt: new Date("2026-10-02T14:59:00Z"),
  publishedAt: new Date("2026-10-02T15:00:00Z"),
  failure: null,
  attempts: 1,
  leaseUntil: null,
  counts: { providers: 91, categories: 8, languages: 16, files: 16, translations: 1180, fallbacks: 262, stale: 2 },
  report: {
    stale: [
      { subject: "M014", name: "Legal Aid Ontario", text: "services", lang: "ur" },
      { subject: "M014", name: "Legal Aid Ontario", text: "emergency_role", lang: "ur" },
    ],
    unavailable: [],
  },
  ...change,
});
const building = (change: Partial<ReleaseSummary> = {}) => release({ number: 5, status: "building", isCurrent: false, publishedAt: null, ...change });

describe("the Directory release screen's words", () => {
  it("lists each stale text once, as the provider's name, the field and the language in English", () => {
    const view = directoryReleaseView(release(), release(), PROVIDERS, day, NOW);

    expect(view.stale?.items).toEqual(["Legal Aid Ontario: Services, Urdu", "Legal Aid Ontario: Emergency role, Urdu"]);
    expect(view.stale?.heading).toBe("Translations not published because the English changed after they were made: 2. Residents see the English for these.");
  });

  it("says how many descriptions of the current release are unreviewed machine translations (AD-11 pilot change), and nothing for a release from before it", () => {
    const counts = { providers: 91, categories: 8, languages: 16, files: 16, translations: 1180, machine: 656, fallbacks: 262, stale: 2 };
    expect(directoryReleaseView(release({ counts }), release({ counts }), PROVIDERS, day, NOW).current?.machine).toBe(
      "Descriptions in the current release that are machine translations no person has reviewed, labelled for residents: 656. The next publish sends out about as many unless reviews are recorded first.",
    );
    expect(directoryReleaseView(release(), release(), PROVIDERS, day, NOW).current?.machine).toBeNull();
  });

  it("shows no publish state while nothing is being built", () => {
    expect(directoryReleaseView(release(), release(), PROVIDERS, day, NOW).building).toBeNull();
    expect(directoryReleaseView(null, null, { published: 0, total: 99 }, day, NOW).building).toBeNull();
  });

  it("says a publish is in progress while its run holds a live lease", () => {
    const latest = building({ leaseUntil: new Date("2026-10-02T15:01:30Z") });

    expect(directoryReleaseView(release(), latest, PROVIDERS, day, NOW).building).toEqual({
      stalled: false,
      text: "A publish is in progress: release 5. Reload this page in a minute to see whether it finished.",
    });
  });

  it.each([
    ["has let go of its lease", null],
    ["lost its lease a while ago", new Date("2026-10-02T14:58:00Z")],
    ["lost its lease just now", NOW],
  ])("says a publish stalled when its run %s, and that pressing Publish continues it", (_name, leaseUntil) => {
    const view = directoryReleaseView(release(), building({ leaseUntil }), PROVIDERS, day, NOW);

    expect(view.building).toEqual({
      stalled: true,
      text: "A publish stopped before it finished: release 5. Press Publish directory to continue it; the files already stored are kept.",
    });
    // Not a failure: no alert text, and the current release is still shown.
    expect(view.lastFailed).toBeNull();
    expect(view.current?.headline).toBe("Current release: 4, published 2026-10-02.");
  });

  it("shows a stalled first publish too, before any release is current", () => {
    expect(directoryReleaseView(null, building({ number: 1 }), PROVIDERS, day, NOW).building?.stalled).toBe(true);
  });

  it("shows the last failure only when it is the newest release and not a build the next press closed as too old", () => {
    const failed = release({ number: 5, status: "failed", isCurrent: false, publishedAt: null, failure: "gave_up" });

    expect(directoryReleaseView(release(), failed, PROVIDERS, day, NOW).lastFailed).toBe("The last publish failed: an earlier publish stopped three times. The previous release is still current.");
    expect(directoryReleaseView(release(), { ...failed, failure: "abandoned" }, PROVIDERS, day, NOW).lastFailed).toBeNull();
  });
});
