import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUDIENCE_GROUPS,
  AudienceSchema,
  audienceRsns,
  canonicalAudience,
  matches,
  normaliseAudience,
  type Audience,
  type AudienceProfile,
} from "./audience";

// ---- a small seeded generator: the same thousands of cases on every run, on every machine ----------------

/** mulberry32: a 32-bit seeded generator. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Next = () => number;
const int = (next: Next, below: number) => Math.floor(next() * below);
const pick = <T,>(next: Next, from: readonly T[]) => from[int(next, from.length)];
/** Some of the items (each with probability `p`), in a random order, sometimes with a repeat. */
function some<T>(next: Next, from: readonly T[], p: number): T[] {
  const chosen = from.filter(() => next() < p);
  for (let i = chosen.length - 1; i > 0; i -= 1) {
    const j = int(next, i + 1);
    [chosen[i], chosen[j]] = [chosen[j], chosen[i]];
  }
  if (chosen.length > 0 && next() < 0.2) chosen.push(pick(next, chosen));
  return chosen;
}

const NEIGHBOURHOODS = ["TP", "FP", "NE"] as const;
const RSNS = ["4154146", "4154159", "4154169", "4154175", "4154763"] as const;
const floorId = (rsn: string, index: number) => `01900000-0000-7000-8000-${rsn.padStart(8, "0")}${String(index).padStart(4, "0")}`;
const FLOORS = RSNS.flatMap((rsn) => [0, 1, 2, 3].map((index) => floorId(rsn, index)));
const TYPES = ["power", "water", "fire", "heat", "other", "elevator"] as const;

/** An audience as a Coordinator could build it, not necessarily normalised (the matcher must not depend on order or repeats). */
function randomAudience(next: Next): Audience {
  const types = some(next, TYPES, 0.3);
  if (types.length === 0) types.push(pick(next, TYPES));
  const groups = some(next, AUDIENCE_GROUPS, 0.25);
  if (next() < 0.4) {
    const ids = some(next, NEIGHBOURHOODS, 0.5);
    if (ids.length === 0) ids.push(pick(next, NEIGHBOURHOODS));
    return { scope: "neighbourhood", neighbourhood_ids: ids, groups, types };
  }
  const rsns = some(next, RSNS, 0.4);
  if (rsns.length === 0) rsns.push(pick(next, RSNS));
  const buildings = rsns.map((rsn) => {
    if (next() < 0.4) return { rsn, floors: null };
    // Mostly the building's own floors, sometimes a floor of another building (the matcher only compares ids).
    const floors = some(next, next() < 0.9 ? FLOORS.filter((id) => id.includes(rsn.padStart(8, "0"))) : FLOORS, 0.4);
    if (floors.length === 0) floors.push(floorId(rsn, int(next, 4)));
    return { rsn, floors };
  });
  return { scope: "buildings", buildings, groups, types };
}

function randomProfile(next: Next): AudienceProfile {
  const rsns = some(next, RSNS, 0.3);
  return {
    neighbourhoodId: next() < 0.1 ? null : pick(next, NEIGHBOURHOODS),
    places: rsns.map((rsn) => ({ rsn, floors: next() < 0.4 ? [] : some(next, FLOORS.filter((id) => id.includes(rsn.padStart(8, "0"))), 0.4) })),
    groups: some(next, AUDIENCE_GROUPS, 0.3),
    mutedTopics: some(next, TYPES, 0.35),
  };
}

/**
 * The AD-7 rules written a second way, from the sets they talk about, so that the matcher is compared with an
 * independent statement of them and not with itself.
 */
function reference(audience: Audience, profile: AudienceProfile): boolean {
  // Topics.
  const unmuted = audience.types.filter((type) => !profile.mutedTopics.includes(type));
  const safety = audience.types.includes("fire");
  if (!safety && unmuted.length === 0) return false;
  // Groups.
  const shared = AUDIENCE_GROUPS.filter((group) => audience.groups.includes(group) && profile.groups.includes(group));
  if (audience.groups.length > 0 && shared.length === 0) return false;
  // Place.
  if (audience.scope === "neighbourhood") return NEIGHBOURHOODS.some((id) => id === profile.neighbourhoodId && audience.neighbourhood_ids.includes(id));
  const recorded = new Set(profile.places.flatMap((place) => (place.floors.length === 0 ? [`${place.rsn}:none`] : place.floors.map((floor) => `${place.rsn}:${floor}`))));
  return audience.buildings.some((building) => {
    if (building.floors === null) return profile.places.some((place) => place.rsn === building.rsn);
    return recorded.has(`${building.rsn}:none`) || building.floors.some((floor) => recorded.has(`${building.rsn}:${floor}`));
  });
}

const CASES = 6000;

describe("matches: the AD-7 rules, over thousands of generated audiences and profiles", () => {
  it("agrees with an independent statement of the rules", () => {
    const next = random(0x5eed04);
    let yes = 0;
    for (let i = 0; i < CASES; i += 1) {
      const audience = randomAudience(next);
      const profile = randomProfile(next);
      const expected = reference(audience, profile);
      if (expected) yes += 1;
      expect(matches(audience, profile), JSON.stringify({ audience, profile })).toBe(expected);
    }
    // The generator reaches both answers often, so the comparison is not vacuous.
    expect(yes).toBeGreaterThan(CASES * 0.1);
    expect(yes).toBeLessThan(CASES * 0.7);
  });

  it("is pure: it changes nothing it is given, and the same arguments give the same answer", () => {
    const next = random(0x0b5e55);
    const freeze = <T,>(value: T): T => {
      if (value && typeof value === "object") Object.values(value).forEach(freeze);
      return Object.freeze(value);
    };
    for (let i = 0; i < 1500; i += 1) {
      const audience = freeze(randomAudience(next));
      const profile = freeze(randomProfile(next));
      const before = JSON.stringify({ audience, profile });
      const first = matches(audience, profile);
      expect(matches(audience, profile)).toBe(first);
      expect(JSON.stringify({ audience, profile })).toBe(before);
    }
  });

  it("does not depend on the order or repeats of any list, in the audience or the profile", () => {
    const next = random(0x0dd0ff);
    for (let i = 0; i < CASES; i += 1) {
      const audience = randomAudience(next);
      const profile = randomProfile(next);
      const reversed: AudienceProfile = {
        neighbourhoodId: profile.neighbourhoodId,
        places: [...profile.places, ...profile.places].reverse().map((place) => ({ rsn: place.rsn, floors: [...place.floors, ...place.floors].reverse() })),
        groups: [...profile.groups, ...profile.groups].reverse(),
        mutedTopics: [...profile.mutedTopics, ...profile.mutedTopics].reverse(),
      };
      expect(matches(audience, reversed)).toBe(matches(audience, profile));
      expect(matches(normaliseAudience(audience), profile)).toBe(matches(audience, profile));
    }
  });

  it("a neighbourhood audience is for everyone living there, whatever buildings, floors or groups-free profile they have", () => {
    const next = random(0x4eb0);
    for (let i = 0; i < CASES; i += 1) {
      const audience = randomAudience(next);
      if (audience.scope !== "neighbourhood") continue;
      const profile = { ...randomProfile(next), mutedTopics: [], groups: [...AUDIENCE_GROUPS] };
      expect(matches(audience, profile), "lives there").toBe(profile.neighbourhoodId !== null && audience.neighbourhood_ids.includes(profile.neighbourhoodId));
      // Places make no difference to a neighbourhood alert.
      expect(matches(audience, { ...profile, places: [] })).toBe(matches(audience, profile));
    }
  });

  it("a profile with no building recorded is reached by neighbourhood alerts only", () => {
    const next = random(0xc0ffee);
    for (let i = 0; i < CASES; i += 1) {
      const audience = randomAudience(next);
      const profile = { ...randomProfile(next), places: [] };
      if (audience.scope === "buildings") expect(matches(audience, profile)).toBe(false);
    }
  });

  it("a building audience matches that building: the whole building, or those floors, or a profile with no floor recorded there", () => {
    const [a, b] = ["4154146", "4154159"];
    const audience: Audience = { scope: "buildings", buildings: [{ rsn: a, floors: [floorId(a, 1), floorId(a, 2)] }, { rsn: b, floors: null }], groups: [], types: ["power"] };
    const person = (places: AudienceProfile["places"]): AudienceProfile => ({ neighbourhoodId: "TP", places, groups: [], mutedTopics: [] });
    expect(matches(audience, person([{ rsn: a, floors: [floorId(a, 2)] }]))).toBe(true);
    expect(matches(audience, person([{ rsn: a, floors: [floorId(a, 3)] }]))).toBe(false);
    expect(matches(audience, person([{ rsn: a, floors: [] }]))).toBe(true);
    expect(matches(audience, person([{ rsn: b, floors: [floorId(b, 3)] }]))).toBe(true);
    expect(matches(audience, person([{ rsn: "4154175", floors: [] }]))).toBe(false);
    // Floor ids of another building never count for this one.
    expect(matches(audience, person([{ rsn: a, floors: [floorId(b, 1)] }]))).toBe(false);
  });

  it("groups intersect: any one shared group is enough; none named means no narrowing", () => {
    const base = { scope: "neighbourhood" as const, neighbourhood_ids: ["TP"], types: ["power"] };
    const person = (groups: string[]): AudienceProfile => ({ neighbourhoodId: "TP", places: [], groups, mutedTopics: [] });
    expect(matches({ ...base, groups: ["seniors", "families"] }, person(["families", "newcomers"]))).toBe(true);
    expect(matches({ ...base, groups: ["seniors"] }, person(["families"]))).toBe(false);
    expect(matches({ ...base, groups: ["seniors"] }, person([]))).toBe(false);
    expect(matches({ ...base, groups: [] }, person([]))).toBe(true);
  });

  it("several matching places are one match: more places never turn a yes into a second yes or a no", () => {
    const next = random(0x0771);
    for (let i = 0; i < CASES; i += 1) {
      const audience = randomAudience(next);
      const profile = randomProfile(next);
      const answer = matches(audience, profile);
      expect(typeof answer).toBe("boolean");
      if (answer) {
        // Adding places and groups can never remove a match (only muting a topic does).
        const wider = { ...profile, places: [...profile.places, { rsn: pick(next, RSNS), floors: [] }], groups: [...AUDIENCE_GROUPS] };
        expect(matches(audience, wider)).toBe(true);
      }
    }
  });

  it("applies topic opt-outs, except for fire and evacuation alerts", () => {
    const next = random(0x70b1c);
    for (let i = 0; i < CASES; i += 1) {
      const audience = randomAudience(next);
      const profile = randomProfile(next);
      const unmuted: AudienceProfile = { ...profile, mutedTopics: [] };
      const mutedAll: AudienceProfile = { ...profile, mutedTopics: [...TYPES] };
      // Muting nothing never hides an alert from someone it is otherwise for.
      if (matches(audience, profile)) expect(matches(audience, unmuted)).toBe(true);
      if (audience.types.includes("fire")) {
        // The override: muting everything changes nothing for an alert that includes a fire or evacuation.
        expect(matches(audience, mutedAll)).toBe(matches(audience, unmuted));
        expect(matches(audience, profile)).toBe(matches(audience, unmuted));
      } else {
        expect(matches(audience, mutedAll), "everything muted hides an alert with no fire type").toBe(false);
        // An alert on several types still reaches someone who muted only some of them.
        const muteFirst: AudienceProfile = { ...unmuted, mutedTopics: [audience.types[0]] };
        if (audience.types.length > 1 && !audience.types.every((type) => type === audience.types[0])) {
          expect(matches(audience, muteFirst)).toBe(matches(audience, unmuted));
        } else expect(matches(audience, muteFirst)).toBe(false);
      }
    }
  });
});

describe("the Audience value: one stored form", () => {
  const base = { groups: [], types: ["power"] };

  it("normalises: sorted, without repeats, a building named twice is one", () => {
    const messy: Audience = {
      scope: "buildings",
      buildings: [
        { rsn: "4154159", floors: [floorId("4154159", 2), floorId("4154159", 0), floorId("4154159", 2)] },
        { rsn: "4154146", floors: null },
        { rsn: "4154159", floors: [floorId("4154159", 1)] },
        { rsn: "4154146", floors: [floorId("4154146", 1)] },
      ],
      groups: ["seniors", "checkin", "seniors"],
      types: ["water", "power", "water"],
    };
    const tidy = normaliseAudience(messy);
    expect(tidy).toEqual({
      scope: "buildings",
      buildings: [
        { rsn: "4154146", floors: null },
        { rsn: "4154159", floors: [floorId("4154159", 0), floorId("4154159", 1), floorId("4154159", 2)] },
      ],
      groups: ["checkin", "seniors"],
      types: ["power", "water"],
    });
    expect(normaliseAudience(tidy)).toEqual(tidy);
    expect(audienceRsns(tidy)).toEqual(["4154146", "4154159"]);
  });

  it("normalising is idempotent and never changes who is reached", () => {
    const next = random(0x1de);
    for (let i = 0; i < 2000; i += 1) {
      const audience = randomAudience(next);
      const once = normaliseAudience(audience);
      expect(normaliseAudience(once)).toEqual(once);
      expect(canonicalAudience(once)).toEqual(once);
      const profile = randomProfile(next);
      expect(matches(once, profile)).toBe(matches(audience, profile));
    }
  });

  it("accepts only the stored form: unsorted or repeated lists, extra keys, empty selections and unknown groups are refused", () => {
    const good: Audience = { scope: "neighbourhood", neighbourhood_ids: ["FP", "TP"], ...base };
    expect(canonicalAudience(good)).toEqual(good);
    expect(canonicalAudience({ ...good, neighbourhood_ids: ["TP", "FP"] })).toBeNull();
    expect(canonicalAudience({ ...good, neighbourhood_ids: ["TP", "TP"] })).toBeNull();
    expect(canonicalAudience({ ...good, neighbourhood_ids: [] })).toBeNull();
    expect(canonicalAudience({ ...good, extra: 1 })).toBeNull();
    expect(canonicalAudience({ ...good, groups: ["pensioners"] })).toBeNull();
    expect(canonicalAudience({ ...good, types: [] })).toBeNull();
    expect(canonicalAudience({ scope: "buildings", buildings: [], ...base })).toBeNull();
    expect(canonicalAudience({ scope: "buildings", buildings: [{ rsn: "4154146", floors: [] }], ...base })).toBeNull();
    expect(canonicalAudience({ scope: "buildings", buildings: [{ rsn: "4154146", floors: ["4"] }], ...base })).toBeNull();
    expect(canonicalAudience({ scope: "buildings", buildings: [{ rsn: "not-an-rsn", floors: null }], ...base })).toBeNull();
    expect(canonicalAudience({ scope: "city", ...base })).toBeNull();
    expect(canonicalAudience(null)).toBeNull();
    expect(AudienceSchema.safeParse({ scope: "buildings", buildings: [{ rsn: "4154146", floors: null }], ...base }).success).toBe(true);
  });
});

describe("one matcher, no copy", () => {
  const SRC = path.join(__dirname, "..");

  it("the contract imports nothing but zod, so the server and the phone can both load it unchanged", () => {
    const source = readFileSync(path.join(__dirname, "audience.ts"), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)"/gm)].map((match) => match[1]);
    expect(imports).toEqual(["zod"]);
    expect(source).not.toMatch(/\b(Date|Math\.random|fetch|process|localStorage|window)\b/);
  });

  it("no other file declares a matcher of its own: the rule is imported from src/contracts/audience", async () => {
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = path.join(dir, name);
        if (name === "node_modules" || name === ".next") return [];
        return statSync(full).isDirectory() ? walk(full) : /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
      });
    const declares = /(function\s+matches\s*\(|const\s+matches\s*=|matchesAudience|audienceMatches)/;
    const offenders = walk(SRC)
      .filter((file) => path.relative(SRC, file) !== path.join("contracts", "audience.ts"))
      .filter((file) => declares.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
