// What each provider helps with, in a resident's words (resident testing, session 2, #3): data/catalogue/provider-problems.json.
// Residents search by their problem ("I can't pay my rent"), listings describe services ("rent bank access"). Each provider's lines
// reach the release as `helps_with` and are part of the English text search embeds and the keyword match reads; residents never see
// them. Pure: the adapter reads the file, this checks it.
//
// The file is {reviewed, note, notes: {<provider id>: why unsure}, providers: {<provider id>: [line, ...]}}. It was drafted by AI from
// each provider's own catalogue text and says "reviewed": false until the Hub has read it. It ships with the app like the other
// catalogue files, so `catalogue_hash` changes when it does: production re-seeds the providers, then publishes.
import { z } from "zod";

const ID = /^[A-Z][0-9]{3,6}$/;
const FileSchema = z.strictObject({
  reviewed: z.boolean(),
  note: z.string().min(1),
  notes: z.record(z.string().regex(ID), z.string().min(1)),
  providers: z.record(z.string().regex(ID), z.array(z.string().trim().min(1).max(120)).max(20)),
});

export interface ProviderProblems {
  /** True once the Hub has reviewed the lines. */
  reviewed: boolean;
  /** provider id -> what it helps with. */
  byProvider: Readonly<Record<string, readonly string[]>>;
}

/** The file as the release uses it. Throws an Error naming what is wrong when the file is not in the shape above. */
export function parseProviderProblems(raw: unknown): ProviderProblems {
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`provider-problems.json: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; ")}`);
  }
  return { reviewed: parsed.data.reviewed, byProvider: parsed.data.providers };
}
