/**
 * The content of an entry as the lifecycle sees it (S04.03): what a draft holds and a submit
 * freezes, and the rules about it that are the thread's, not the composer's. The audience's own
 * type and its matcher are S04.04's (src/contracts/audience.ts); here it is a value with a
 * `scope` and, for buildings, each building's `rsn`.
 */

export const PHASES = ["problem", "in_progress"] as const;
export type Phase = (typeof PHASES)[number];

/** At most 600 characters of English text (epic E04, "Alert text limit"). */
export const ALERT_TEXT_MAX = 600;

/** Heat, smoke and winter storm: neighbourhood audience only, authored by Coordinators and Admins only. */
export const NEIGHBOURHOOD_ONLY_TYPES = ["heat", "smoke", "winter"] as const;

/** Valid-until is at most 7 days ahead (proposed engineering budget, epic E04). */
export const VALID_UNTIL_MAX_MS = 7 * 24 * 60 * 60 * 1000;

export type AudienceValue = Record<string, unknown> & { scope: "neighbourhood" | "buildings" };

export interface EntryContent {
  /** English, the authoring language. */
  text: string;
  /** Disruption type ids, no repeats. */
  types: readonly string[];
  audience: AudienceValue;
  phase: Phase;
  validUntil: Date;
}

export type ContentRefusal =
  | "TEXT_EMPTY"
  | "TEXT_TOO_LONG"
  | "TYPES_EMPTY"
  | "TYPES_REPEATED"
  | "PHASE_INVALID"
  | "AUDIENCE_INVALID"
  | "NEIGHBOURHOOD_ONLY_TYPE"
  | "VALID_UNTIL_INVALID";

/** The buildings an audience names, by rsn; null when a `buildings` audience does not name them properly. */
export function audienceBuildings(audience: AudienceValue): string[] | null {
  if (audience.scope !== "buildings") return [];
  const listed = audience.buildings;
  if (!Array.isArray(listed) || listed.length === 0) return null;
  const rsns: string[] = [];
  for (const building of listed) {
    const rsn = (building as { rsn?: unknown } | null)?.rsn;
    if (typeof rsn !== "string" || !/^[0-9]{1,9}$/.test(rsn)) return null;
    rsns.push(rsn);
  }
  return [...new Set(rsns)];
}

/** Whether the content is neighbourhood-wide: a neighbourhood audience, or a type only that scope may use. */
export function isWideContent(content: Pick<EntryContent, "types" | "audience">): boolean {
  return content.audience.scope === "neighbourhood" || content.types.some((type) => (NEIGHBOURHOOD_ONLY_TYPES as readonly string[]).includes(type));
}

/** The first rule the content breaks, or null. Whether the types exist is the database's (disruption_type). */
export function contentRefusal(content: EntryContent): ContentRefusal | null {
  if (content.text.trim() === "") return "TEXT_EMPTY";
  if (content.text.length > ALERT_TEXT_MAX) return "TEXT_TOO_LONG";
  if (content.types.length === 0) return "TYPES_EMPTY";
  if (new Set(content.types).size !== content.types.length) return "TYPES_REPEATED";
  if (!(PHASES as readonly string[]).includes(content.phase)) return "PHASE_INVALID";
  const scope = (content.audience as { scope?: unknown } | null)?.scope;
  if (scope !== "neighbourhood" && scope !== "buildings") return "AUDIENCE_INVALID";
  if (audienceBuildings(content.audience) === null) return "AUDIENCE_INVALID";
  if (content.audience.scope !== "neighbourhood" && content.types.some((type) => (NEIGHBOURHOOD_ONLY_TYPES as readonly string[]).includes(type))) {
    return "NEIGHBOURHOOD_ONLY_TYPE";
  }
  if (Number.isNaN(content.validUntil.getTime())) return "VALID_UNTIL_INVALID";
  return null;
}

/** True when two contents are the same (a submit checks the draft is still what was prepared). */
export function sameContent(a: EntryContent, b: EntryContent): boolean {
  return (
    a.text === b.text &&
    a.phase === b.phase &&
    a.validUntil.getTime() === b.validUntil.getTime() &&
    a.types.length === b.types.length &&
    [...a.types].sort().join("\n") === [...b.types].sort().join("\n") &&
    stableJson(a.audience) === stableJson(b.audience)
  );
}

/** JSON with object keys sorted, so equal values compare equal whatever their key order (jsonb reorders keys). */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export type ValidUntilRefusal = "VALID_UNTIL_PAST" | "VALID_UNTIL_TOO_FAR";

/** Required in the future at submit and again at approval, and at most 7 days ahead. */
export function validUntilRefusal(validUntil: Date, now: Date): ValidUntilRefusal | null {
  const ahead = validUntil.getTime() - now.getTime();
  if (ahead <= 0) return "VALID_UNTIL_PAST";
  if (ahead > VALID_UNTIL_MAX_MS) return "VALID_UNTIL_TOO_FAR";
  return null;
}
