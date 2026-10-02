import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AudienceSchema,
  audienceRsns,
  canonicalAudience,
  matches,
  normaliseAudience,
  profileFromDevice,
  type Audience,
  type AudienceProfile,
} from "./audience";
import type { BuildingList } from "./buildingList";
import type { DeviceChoices } from "./deviceChoices";
import { GROUPS, type Group } from "./groups";

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
  const groups = some(next, GROUPS, 0.25);
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
    // Empty is "not known" (a phone with no building saved): reached by the neighbourhood alerts of every neighbourhood.
    neighbourhoodIds: next() < 0.15 ? [] : some(next, NEIGHBOURHOODS, 0.5).concat(pick(next, NEIGHBOURHOODS)),
    places: rsns.map((rsn) => ({ rsn, floors: next() < 0.4 ? [] : some(next, FLOORS.filter((id) => id.includes(rsn.padStart(8, "0"))), 0.4) })),
    groups: some(next, GROUPS, 0.3),
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
  const shared = GROUPS.filter((group) => audience.groups.includes(group) && profile.groups.includes(group));
  if (audience.groups.length > 0 && shared.length === 0) return false;
  // Place.
  if (audience.scope === "neighbourhood") return profile.neighbourhoodIds.length === 0 || NEIGHBOURHOODS.some((id) => profile.neighbourhoodIds.includes(id) && audience.neighbourhood_ids.includes(id));
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
        neighbourhoodIds: [...profile.neighbourhoodIds, ...profile.neighbourhoodIds].reverse(),
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
      const profile = { ...randomProfile(next), mutedTopics: [], groups: [...GROUPS] };
      const reached = profile.neighbourhoodIds.length === 0 || profile.neighbourhoodIds.some((id) => audience.neighbourhood_ids.includes(id));
      expect(matches(audience, profile), "lives there, or is not known to live anywhere").toBe(reached);
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

  it("a phone with no building saved is reached by the neighbourhood alerts of every neighbourhood (AD-7, decided default)", () => {
    const next = random(0x0a11);
    for (let i = 0; i < CASES; i += 1) {
      const audience = randomAudience(next);
      if (audience.scope !== "neighbourhood") continue;
      const profile: AudienceProfile = { neighbourhoodIds: [], places: [], groups: [...GROUPS], mutedTopics: [] };
      expect(matches(audience, profile), JSON.stringify(audience)).toBe(true);
    }
    // ... but it is still a person: groups and muted topics apply as for anyone.
    const only: Audience = { scope: "neighbourhood", neighbourhood_ids: ["FP"], groups: ["seniors"], types: ["power"] };
    expect(matches(only, { neighbourhoodIds: [], places: [], groups: ["families"], mutedTopics: [] })).toBe(false);
    expect(matches(only, { neighbourhoodIds: [], places: [], groups: ["seniors"], mutedTopics: ["power"] })).toBe(false);
    // A person who does live somewhere is reached by their own neighbourhood's alerts only.
    expect(matches({ ...only, groups: [] }, { neighbourhoodIds: ["TP"], places: [], groups: [], mutedTopics: [] })).toBe(false);
    expect(matches({ ...only, groups: [] }, { neighbourhoodIds: ["TP", "FP"], places: [], groups: [], mutedTopics: [] })).toBe(true);
  });

  it("a building audience matches that building: the whole building, or those floors, or a profile with no floor recorded there", () => {
    const [a, b] = ["4154146", "4154159"];
    const audience: Audience = { scope: "buildings", buildings: [{ rsn: a, floors: [floorId(a, 1), floorId(a, 2)] }, { rsn: b, floors: null }], groups: [], types: ["power"] };
    const person = (places: AudienceProfile["places"]): AudienceProfile => ({ neighbourhoodIds: ["TP"], places, groups: [], mutedTopics: [] });
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
    const person = (groups: string[]): AudienceProfile => ({ neighbourhoodIds: ["TP"], places: [], groups, mutedTopics: [] });
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
        const wider = { ...profile, places: [...profile.places, { rsn: pick(next, RSNS), floors: [] }], groups: [...GROUPS] };
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

// ---- profileFromDevice: the phone's saved choices and building list become the profile -------------------

/** A building list as S02.03 serves it (`BuildingList`): every building has a neighbourhood and its floors. */
const BUILDING_LIST: BuildingList = {
  v: 1,
  generated_at: "2026-10-01T12:00:00.000Z",
  buildings: RSNS.map((rsn, index) => ({
    rsn,
    address: `${rsn} Test Rd`,
    neighbourhoodId: index % 2 === 0 ? "TP" : "FP",
    neighbourhood: index % 2 === 0 ? "Thorncliffe Park" : "Flemingdon Park",
    floors: [0, 1, 2, 3].map((n) => ({ id: floorId(rsn, n), label: String(n) })),
  })),
};
/** Saved choices as S02.03 stores them (`DeviceChoices`). */
const choicesOf = (fields: Omit<DeviceChoices, "v">): DeviceChoices => ({ v: 1, ...fields });
const neighbourhoodOf = (rsn: string) => BUILDING_LIST.buildings.find((building) => building.rsn === rsn)!.neighbourhoodId;

/** Saved choices as the phone could hold them: any buildings, floors of those buildings and of others, groups. */
function randomChoices(next: Next): DeviceChoices & { buildings: string[]; floors: string[]; groups: Group[] } {
  const buildings = some(next, RSNS, 0.35);
  const floors = some(next, FLOORS, 0.3);
  return { v: 1, buildings, floors, groups: some(next, GROUPS, 0.4) };
}

describe("profileFromDevice: what the phone's choices say about its owner", () => {
  it("groups the saved floors under their building, and a building with no floor chosen gets []", () => {
    const [a, b, c] = ["4154146", "4154159", "4154169"];
    const profile = profileFromDevice(choicesOf({ buildings: [a, b, c], floors: [floorId(a, 2), floorId(a, 1), floorId(b, 3)], groups: ["families"] }), BUILDING_LIST);
    expect(profile.places).toEqual([
      { rsn: a, floors: [floorId(a, 1), floorId(a, 2)] },
      { rsn: b, floors: [floorId(b, 3)] },
      { rsn: c, floors: [] },
    ]);
    expect(profile.groups).toEqual(["families"]);
    expect(profile.mutedTopics).toEqual([]);
  });

  it("derives the neighbourhoods from the saved buildings, sorted and without repeats", () => {
    const [a, b, c] = ["4154146", "4154159", "4154169"];
    expect([neighbourhoodOf(a), neighbourhoodOf(b), neighbourhoodOf(c)]).toEqual(["TP", "FP", "TP"]);
    expect(profileFromDevice(choicesOf({ buildings: [a, c] }), BUILDING_LIST).neighbourhoodIds).toEqual(["TP"]);
    expect(profileFromDevice(choicesOf({ buildings: [c, b, a] }), BUILDING_LIST).neighbourhoodIds).toEqual(["FP", "TP"]);
    // A saved building the list no longer has is still a place (the matcher names it by rsn) but tells nothing about the neighbourhood.
    expect(profileFromDevice(choicesOf({ buildings: ["999"] }), BUILDING_LIST)).toMatchObject({ neighbourhoodIds: [], places: [{ rsn: "999", floors: [] }] });
  });

  it("a phone with no building saved has no place and no neighbourhood; floors saved without their building are not used", () => {
    expect(profileFromDevice(choicesOf({}), BUILDING_LIST)).toEqual({ neighbourhoodIds: [], places: [], groups: [], mutedTopics: [] });
    const orphan = profileFromDevice(choicesOf({ floors: [floorId("4154146", 1)], groups: ["seniors"] }), BUILDING_LIST);
    expect(orphan).toEqual({ neighbourhoodIds: [], places: [], groups: ["seniors"], mutedTopics: [] });
  });

  it("agrees with a statement of it made from sets, for thousands of generated choices", () => {
    const next = random(0xde71ce);
    for (let i = 0; i < CASES; i += 1) {
      const choices = randomChoices(next);
      const profile = profileFromDevice(choices, BUILDING_LIST);
      const saved = new Set(choices.buildings);
      expect(profile.places.map((place) => place.rsn)).toEqual([...saved].sort());
      for (const place of profile.places) {
        const own = BUILDING_LIST.buildings.find((building) => building.rsn === place.rsn)!.floors.map((floor) => floor.id);
        expect(place.floors, `floors of ${place.rsn}`).toEqual(own.filter((id) => choices.floors!.includes(id)).sort());
      }
      expect(profile.neighbourhoodIds).toEqual([...new Set([...saved].map(neighbourhoodOf))].sort());
      // Nothing outside the saved buildings is ever a place or a floor.
      const placed = new Set(profile.places.flatMap((place) => place.floors));
      for (const id of placed) expect(choices.floors).toContain(id);
    }
  });

  it("reads no muted topics from the device: a field the phone may hold under any name leaves the matcher's list empty", () => {
    const profile = profileFromDevice({ ...choicesOf({ buildings: ["4154146"] }), mutedTopics: ["power"], muted: ["heat"] }, BUILDING_LIST);
    expect(profile.mutedTopics).toEqual([]);
  });

  it("is pure and does not depend on the order or repeats of the saved lists", () => {
    const next = random(0xfeed);
    const freeze = <T,>(value: T): T => {
      if (value && typeof value === "object") Object.values(value).forEach(freeze);
      return Object.freeze(value);
    };
    const list = freeze(structuredClone(BUILDING_LIST));
    for (let i = 0; i < 1500; i += 1) {
      const choices = freeze(randomChoices(next));
      const again: DeviceChoices = {
        v: 1,
        buildings: [...choices.buildings!, ...choices.buildings!].reverse(),
        floors: [...choices.floors!].reverse(),
        groups: [...choices.groups!, ...choices.groups!],
      };
      expect(profileFromDevice(again, list)).toEqual(profileFromDevice(choices, list));
    }
  });

  it("decides the same as the matcher would from the sets: alerts reach a phone by its saved buildings, floors and groups", () => {
    const next = random(0x0badf00d);
    for (let i = 0; i < CASES; i += 1) {
      const audience = randomAudience(next);
      const choices = randomChoices(next);
      const saved = new Set(choices.buildings);
      const floorsSaved = (rsn: string) => BUILDING_LIST.buildings.find((b) => b.rsn === rsn)!.floors.map((f) => f.id).filter((id) => choices.floors!.includes(id));
      // The device holds no muted topics yet (see the TODO in `profileFromDevice`), so no topic is muted.
      const unmuted = true;
      const grouped = audience.groups.length === 0 || audience.groups.some((group) => choices.groups!.includes(group));
      let place: boolean;
      if (audience.scope === "neighbourhood") place = saved.size === 0 || [...saved].some((rsn) => audience.neighbourhood_ids.includes(neighbourhoodOf(rsn)));
      else
        place = audience.buildings.some(
          (wanted) => saved.has(wanted.rsn) && (wanted.floors === null || floorsSaved(wanted.rsn).length === 0 || floorsSaved(wanted.rsn).some((id) => wanted.floors!.includes(id))),
        );
      expect(matches(audience, profileFromDevice(choices, BUILDING_LIST)), JSON.stringify({ audience, choices })).toBe(unmuted && grouped && place);
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

  it("the contract imports nothing but zod and the contract files beside it, so the server and the phone can both load it unchanged", () => {
    const source = readFileSync(path.join(__dirname, "audience.ts"), "utf8");
    const imports = [...source.matchAll(/^import .* from "([^"]+)"/gm)].map((match) => match[1]);
    expect(imports).toEqual(["zod", "./buildingList", "./deviceChoices", "./groups", "./places"]);
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
