// The resident's side of a place suggestion (PRD §6.3, D9/E4; R-17 to R-23), without React: the draft of R-19 and R-20, what is still missing
// before it can be sent, the body POST /api/places/submissions takes (built from the draft and nothing else: AD-3, the device's saved choices
// are never part of it), the correction of R-22, the places nearest a point for R-17's picker, and the draft a declined suggestion hands back
// to R-19 through the phone's own session storage (R-23 "Change it and send again").
import type { ListingProvider } from "@/contracts/directory";
import {
  PLACE_SUBMISSION_CONTRACT_VERSION,
  PLACE_SUBMISSION_ERROR_CODES,
  PlaceSubmissionReceivedSchema,
  type CorrectionField,
  type CostAnswer,
  type DeclineReason,
  type PlaceSubmissionErrorCode,
  type PlaceSubmissionRequestBody,
  type PlaceType,
  type WhereRecord,
  type YesNoAnswer,
} from "@/contracts/placeSubmission";

export const SUBMISSIONS_URL = "/api/places/submissions";

/** R-19 and R-20 as the resident fills them in. Empty strings for what is not answered yet. */
export interface AddDraft {
  type: PlaceType | "";
  name: string;
  what: string;
  where: WhereRecord | null;
  /** The English name of a subcategory of the release (the value the Hub reads), "" when not chosen, CATEGORY_NOT_SURE for "Not sure". */
  category: string;
  phone: string;
  web: string;
  cost: CostAnswer | "";
  idRequired: YesNoAnswer | "";
  stepFree: YesNoAnswer | "";
  languages: string[];
  /** The honeypot: hidden from people; a script that fills it in is answered like anyone and stored nowhere. */
  nickname: string;
}

/** R-19's "Not sure" in the kind-of-help list: an answer of its own on the screen, sent as no category. */
export const CATEGORY_NOT_SURE = "notSure";

export const EMPTY_DRAFT: AddDraft = {
  type: "",
  name: "",
  what: "",
  where: null,
  category: "",
  phone: "",
  web: "",
  cost: "",
  idRequired: "",
  stepFree: "",
  languages: [],
  nickname: "",
};

/** The four answers R-19 needs before "Send to the Hub", in its order (R19.missingTitle lists them by their labels). */
export type MissingField = "type" | "name" | "what" | "where";

export function missingFields(draft: AddDraft): MissingField[] {
  const missing: MissingField[] = [];
  if (!draft.type) missing.push("type");
  if (!draft.name.trim()) missing.push("name");
  if (!draft.what.trim()) missing.push("what");
  if (!draft.where) missing.push("where");
  return missing;
}

/** The body of a new place: only what the form asked, an unanswered optional question left out. */
export function addBody(draft: AddDraft, lang: string): PlaceSubmissionRequestBody {
  if (!draft.type || !draft.where) throw new Error("addBody needs a complete draft (missingFields is empty)");
  const where = draft.where.kind === "building" ? { kind: "building" as const, rsn: draft.where.rsn, ...(draft.where.text ? { text: draft.where.text } : {}) } : draft.where;
  return {
    v: PLACE_SUBMISSION_CONTRACT_VERSION,
    lang: lang as PlaceSubmissionRequestBody["lang"],
    kind: "add",
    type: draft.type,
    name: draft.name,
    what: draft.what,
    where,
    ...(draft.category && draft.category !== CATEGORY_NOT_SURE ? { category: draft.category } : {}),
    ...(draft.phone.trim() ? { phone: draft.phone } : {}),
    ...(draft.web.trim() ? { web: draft.web } : {}),
    ...(draft.cost ? { cost: draft.cost } : {}),
    ...(draft.idRequired ? { idRequired: draft.idRequired } : {}),
    ...(draft.stepFree ? { stepFree: draft.stepFree } : {}),
    ...(draft.languages.length > 0 ? { languages: draft.languages as NonNullable<Extract<PlaceSubmissionRequestBody, { kind: "add" }>["languages"]> } : {}),
    ...(draft.nickname ? { nickname: draft.nickname } : {}),
  };
}

/** R-22's changes, by field: a text field's new words, or a choice's value. Only a changed row is here. */
export type CorrectionDraft = Partial<Record<CorrectionField, string>>;

export function correctionBody(provider: { id: string; name: string }, changes: CorrectionDraft, lang: string, nickname = ""): PlaceSubmissionRequestBody {
  return {
    v: PLACE_SUBMISSION_CONTRACT_VERSION,
    lang: lang as PlaceSubmissionRequestBody["lang"],
    kind: "correct",
    providerId: provider.id,
    providerName: provider.name,
    changes: changes as Extract<PlaceSubmissionRequestBody, { kind: "correct" }>["changes"],
    ...(nickname ? { nickname } : {}),
  };
}

export type SendOutcome = { kind: "sent"; ref: string } | { kind: "refused"; code: PlaceSubmissionErrorCode };

const isErrorCode = (value: unknown): value is PlaceSubmissionErrorCode => typeof value === "string" && (PLACE_SUBMISSION_ERROR_CODES as readonly string[]).includes(value);

/** Sends a suggestion. A failure without the server's answer (no signal) reads as `submissions_unavailable`: "check your signal". */
export async function sendSuggestion(body: PlaceSubmissionRequestBody, fetcher: typeof fetch = fetch): Promise<SendOutcome> {
  try {
    const response = await fetcher(SUBMISSIONS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const json: unknown = await response.json().catch(() => null);
    if (response.status === 202) {
      const received = PlaceSubmissionReceivedSchema.safeParse(json);
      if (received.success) return { kind: "sent", ref: received.data.ref };
    }
    const code = (json as { error?: { code?: unknown } } | null)?.error?.code;
    return { kind: "refused", code: isErrorCode(code) ? code : "submissions_unavailable" };
  } catch {
    return { kind: "refused", code: "submissions_unavailable" };
  }
}

/** Kilometres between two points (the haversine formula): R-17's "Nearest to you first" and R-20's "The pin is near {place}". */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The `limit` providers nearest `from`, with how far each is: a provider with no location is left out. */
export function nearestProviders(providers: readonly ListingProvider[], from: { lat: number; lng: number }, limit = 5): { provider: ListingProvider; km: number }[] {
  return providers
    .flatMap((provider) => (provider.locations[0] ? [{ provider, km: kmBetween(from, provider.locations[0]) }] : []))
    .sort((a, b) => a.km - b.km || a.provider.name.localeCompare(b.provider.name))
    .slice(0, limit);
}

/** The building nearest a pin, for "The pin is near {place}"; null when no building has a point. */
export function nearestBuilding<B extends { address: string; lat?: number; lng?: number }>(buildings: readonly B[], at: { lat: number; lng: number }): B | null {
  let best: { building: B; km: number } | null = null;
  for (const building of buildings) {
    if (building.lat === undefined || building.lng === undefined) continue;
    const km = kmBetween(at, { lat: building.lat, lng: building.lng });
    if (!best || km < best.km) best = { building, km };
  }
  return best?.building ?? null;
}

/** Where R-20 starts and where "nearest to you" is measured from without a saved building: the middle of the two neighbourhoods. */
export const AREA_CENTRE = { lat: 43.71, lng: -79.3385 } as const;

// ---------------------------------------------------------------- R-23 "Change it and send again"

/** The phone's session storage key: what a declined suggestion hands back to R-19, read once and removed. */
export const RESUBMIT_KEY = "cvh.places.resubmit";

export interface Resubmit {
  reason: DeclineReason;
  draft: Pick<AddDraft, "type" | "name" | "what" | "where">;
}

type SessionStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function writeResubmit(storage: SessionStore | null, value: Resubmit): void {
  try {
    storage?.setItem(RESUBMIT_KEY, JSON.stringify(value));
  } catch {
    // A phone that keeps nothing still opens the form, empty.
  }
}

/** The handed-back draft, once: it is removed as it is read, so a later visit to R-19 starts empty. */
export function takeResubmit(storage: SessionStore | null): Resubmit | null {
  try {
    const text = storage?.getItem(RESUBMIT_KEY);
    storage?.removeItem(RESUBMIT_KEY);
    if (!text) return null;
    const value = JSON.parse(text) as Resubmit;
    if (typeof value?.reason !== "string" || typeof value?.draft?.name !== "string") return null;
    return value;
  } catch {
    return null;
  }
}
