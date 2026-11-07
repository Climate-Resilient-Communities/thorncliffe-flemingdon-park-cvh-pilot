// The shape of the partner space's dummy data (data/partners/seed.json, product owner's decision of 2026-11-07), checked before anything is
// written: the seed refuses the whole file on the first problem, so a typo never leaves half a coordination space. The database's own checks are
// the second line. Times are minutes before the seed runs ("minsAgo"), so the data reads as current whenever it is loaded.
import { z } from "zod";
import { STATEMENT_KINDS } from "./coverage";
import { SPACE_PURPOSES, SPACE_STATUSES } from "./space";

export const HAZARDS = ["power", "elevator", "heat", "smoke", "flood", "fire", "water", "winter", "other"] as const;
export type Hazard = (typeof HAZARDS)[number];

export const ORG_KINDS = ["hub", "health", "library", "faith", "tenants", "settlement", "city", "relief"] as const;
export const ORG_CAPACITIES = ["available", "stretched", "at_capacity"] as const;
export type OrgCapacity = (typeof ORG_CAPACITIES)[number];
export const SHARED_SPACE_PURPOSES = ["coordinate", "shelter", "welfare", "recovery"] as const;
export const COMMITMENT_MODES = ["everyday", "during", "recovery"] as const;
export const SUPPLY_ITEMS = ["water", "masks", "power_banks", "cots", "blankets", "interpreters", "box_fans", "flashlights", "other"] as const;
export const SUPPLY_QUANTITIES = ["few", "some", "plenty"] as const;
export const PLAYBOOK_STATES = ["agreed", "proposed", "placeholder"] as const;
export const AMBASSADOR_POSTING = ["direct", "hub", "none"] as const;

const words = z.string().trim().min(1).max(400);
const minsAgo = z.number().int().min(0).max(60 * 24 * 365);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const orgId = z.string().regex(/^[A-Z][A-Z0-9]{1,9}$/);
const level = z.union([z.literal(1), z.literal(2)]);
const time = z.string().regex(/^[0-2][0-9]:[0-5][0-9]$/);

const org = z.strictObject({
  id: orgId,
  name: words,
  shortName: words,
  kind: z.enum(ORG_KINDS),
  contactRole: words,
  // Fictional on purpose (the brief: "keep all people and phone numbers fictional"): the database refuses anything else too.
  contactPhone: z.string().regex(/^\(\d{3}\) 555-01\d{2}$/, "must be a fictional 555-01xx number"),
  contactEmail: z.string().regex(/^[a-z0-9.-]+@[a-z0-9.-]*example\.org$/, "must be an example.org address"),
  capacity: z.enum(ORG_CAPACITIES).nullable(),
  capacityMinsAgo: minsAgo.optional(),
});

const space = z.strictObject({
  id: z.string().regex(/^SP[0-9]{2,4}$/),
  org: orgId,
  providerId: z.string().regex(/^[A-Z][0-9]{3,6}$/).nullable(),
  name: words,
  room: words.nullable(),
  street: words,
  purpose: z.enum(SPACE_PURPOSES),
  status: z.enum(SPACE_STATUSES),
  capacityMax: z.number().int().min(1).max(2000),
  capacityNow: z.number().int().min(0).nullable(),
  opensAt: time.nullable(),
  closesAt: time.nullable(),
  confirmedMinsAgo: minsAgo.nullable(),
  confirmedBy: words.nullable(),
});

const sharedSpace = z.strictObject({
  id: z.string().regex(/^SH[0-9]{2}$/),
  hazard: z.enum(HAZARDS),
  level,
  location: words,
  purpose: z.enum(SHARED_SPACE_PURPOSES),
  openedMinsAgo: minsAgo,
  openedBy: words,
  closedMinsAgo: minsAgo.nullable(),
});

const statement = z.strictObject({
  id: z.string().regex(/^ST[0-9]{2,3}$/),
  space: z.string(),
  org: orgId,
  person: words,
  kind: z.enum(STATEMENT_KINDS),
  body: words,
  minsAgo,
  claimedBy: orgId.optional(),
  answers: z.string().optional(),
});

const commitment = z.strictObject({
  id: z.string().regex(/^COM[0-9]{2}$/),
  org: orgId,
  hazard: z.enum(HAZARDS),
  mode: z.enum(COMMITMENT_MODES),
  body: words,
  role: words,
  agreement: words.nullable(),
  reviewDue: isoDate,
  forDisruption: z.enum(["confirmed", "declined"]).nullable(),
});

const supply = z.strictObject({
  id: z.string().regex(/^SUP[0-9]{2}$/),
  org: orgId,
  item: z.enum(SUPPLY_ITEMS),
  qty: z.enum(SUPPLY_QUANTITIES),
  qtyNum: z.number().int().min(0).nullable(),
  unit: words,
  location: words,
  minsAgo,
});

const decision = z.strictObject({ id: z.string().regex(/^DEC[0-9]{2}$/), space: z.string(), org: orgId, person: words, minsAgo, body: words, why: words });

const handover = z.strictObject({
  id: z.string().regex(/^HO[0-9]{2}$/),
  space: z.string(),
  org: orgId,
  from: words,
  to: words.nullable(),
  minsAgo,
  note: words,
  open: z.array(z.string()),
});

const playbook = z.strictObject({
  hazard: z.enum(HAZARDS),
  state: z.enum(PLAYBOOK_STATES),
  version: z.string().nullable(),
  agreedOn: isoDate.nullable(),
  staleAfterMins: z.number().int().min(1),
  ambassadorPosting: z.enum(AMBASSADOR_POSTING),
  activated: z.array(words),
  spaces: z.array(words),
  templates: z.array(z.string()),
  asks: z.record(orgId, words),
  steps: z.array(words),
  history: z.array(z.strictObject({ version: z.string(), date: isoDate, by: words, change: words })),
});

const team = z.strictObject({ hazard: z.enum(HAZARDS), level, team: words.nullable(), channels: z.array(z.enum(["text", "email"])), trigger: words.nullable() });

const exercise = z.strictObject({
  id: z.string().regex(/^EX[0-9]{2}$/),
  hazard: z.enum(HAZARDS),
  level,
  title: words,
  kind: z.enum(["scheduled", "past"]),
  onDate: isoDate,
  repeats: z.enum(["none", "q", "h", "y"]),
  tookPart: z.number().int().min(0).nullable(),
});

const indicator = z.strictObject({ id: z.string().regex(/^[a-zA-Z]+$/), real: words.nullable(), exercise: words.nullable(), everyday: words.nullable() });

const record = z.strictObject({
  id: z.string().regex(/^REC[0-9]{1,2}$/),
  kind: z.enum(["real", "exercise"]),
  hazard: z.enum(HAZARDS),
  place: words,
  period: z.string().regex(/^\d{4}-\d{2}$/),
  title: words,
  lessons: z.array(words),
});

const action = z.strictObject({
  id: z.string().regex(/^ACT[0-9]{1,2}$/),
  lesson: words,
  body: words,
  ownerRole: words,
  due: isoDate,
  status: z.enum(["open", "done"]),
  changed: words.nullable(),
});

export const PartnerSeedSchema = z
  .strictObject({
    meta: z.record(z.string(), z.string()),
    orgs: z.array(org).min(1),
    spaces: z.array(space),
    sharedSpaces: z.array(sharedSpace),
    statements: z.array(statement),
    commitments: z.array(commitment),
    supplies: z.array(supply),
    decisions: z.array(decision),
    handovers: z.array(handover),
    playbooks: z.array(playbook),
    teams: z.array(team),
    exercises: z.array(exercise),
    indicators: z.array(indicator),
    records: z.array(record),
    actions: z.array(action),
  })
  .superRefine((data, ctx) => {
    // The references inside the file resolve, so the database's foreign keys never refuse a row half-way through.
    const orgs = new Set(data.orgs.map((o) => o.id));
    const spaces = new Set(data.sharedSpaces.map((s) => s.id));
    const statements = new Set(data.statements.map((s) => s.id));
    const problem = (message: string) => ctx.addIssue({ code: "custom", message });
    const unique = (what: string, ids: readonly string[]) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) problem(`${what} ${id} is listed twice`);
        seen.add(id);
      }
    };
    unique("organisation", data.orgs.map((o) => o.id));
    unique("space", data.spaces.map((s) => s.id));
    unique("space for provider", data.spaces.flatMap((s) => (s.providerId ? [s.providerId] : [])));
    unique("statement", data.statements.map((s) => s.id));
    for (const s of data.spaces) {
      if (!orgs.has(s.org)) problem(`space ${s.id} names organisation ${s.org}, which is not listed`);
      const shown = s.status === "open" || s.status === "full";
      if (shown && (s.confirmedMinsAgo === null || s.confirmedBy === null)) problem(`space ${s.id} is ${s.status} but nobody confirmed it`);
      if (!shown && s.capacityNow !== null) problem(`space ${s.id} is ${s.status} but has people counted in it`);
      if (s.capacityNow !== null && s.capacityNow > s.capacityMax) problem(`space ${s.id} has more people than its limit`);
    }
    for (const s of data.statements) {
      if (!spaces.has(s.space)) problem(`statement ${s.id} is in shared space ${s.space}, which is not listed`);
      if (!orgs.has(s.org) || (s.claimedBy && !orgs.has(s.claimedBy))) problem(`statement ${s.id} names an organisation that is not listed`);
      if (s.answers && !statements.has(s.answers)) problem(`statement ${s.id} answers ${s.answers}, which is not listed`);
    }
    for (const row of [...data.commitments, ...data.supplies]) if (!orgs.has(row.org)) problem(`${row.id} names organisation ${row.org}, which is not listed`);
    for (const row of [...data.decisions, ...data.handovers]) {
      if (!orgs.has(row.org)) problem(`${row.id} names organisation ${row.org}, which is not listed`);
      if (!spaces.has(row.space)) problem(`${row.id} is in shared space ${row.space}, which is not listed`);
    }
    for (const p of data.playbooks) if ((p.state === "agreed") !== (p.agreedOn !== null)) problem(`playbook ${p.hazard} must have an agreed date exactly when it is agreed`);
  });

export type PartnerSeed = z.infer<typeof PartnerSeedSchema>;

/** Reads the seed file's JSON; throws a message naming every problem when it is not usable. */
export function parsePartnerSeed(json: unknown): PartnerSeed {
  const parsed = PartnerSeedSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`data/partners/seed.json is not usable:\n${parsed.error.issues.map((issue) => `  - ${issue.path.join(".") || "(file)"}: ${issue.message}`).join("\n")}`);
  }
  return parsed.data;
}
