// Who runs each provider (resident testing, session 2, #4 and #11): data/catalogue/provider-run-by.json. Residents asked to tell
// an established service (a public body, an agency with staff, an institution) from a community group run by residents or
// volunteers, on the list and on the map. The release carries it as `run_by` on each provider. Pure: the adapter reads the file,
// this checks it.
//
// The file is {reviewed, note, rule, ambiguous: {<provider id>: why}, providers: {<provider id>: "formal" | "grassroots"}}. It was
// labelled from the catalogue's own descriptions and says "reviewed": false until the Hub has reviewed it. It ships with the app
// like the other catalogue files, so `catalogue_hash` (all of data/catalogue/) changes when it does, and no migration is needed.
import { z } from "zod";
import { RunBySchema, type RunBy } from "@/contracts/directory";

const FileSchema = z.strictObject({
  reviewed: z.boolean(),
  note: z.string().min(1),
  rule: z.string().min(1),
  ambiguous: z.record(z.string().regex(/^[A-Z][0-9]{3,6}$/), z.string().min(1)),
  providers: z.record(z.string().regex(/^[A-Z][0-9]{3,6}$/), RunBySchema),
});

export interface ProviderRunBy {
  /** True once the Hub has reviewed the list. */
  reviewed: boolean;
  /** provider id -> who runs it. */
  byProvider: Readonly<Record<string, RunBy>>;
}

/** The file as the release uses it. Throws an Error naming what is wrong when the file is not in the shape above. */
export function parseProviderRunBy(raw: unknown): ProviderRunBy {
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`provider-run-by.json: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; ")}`);
  }
  return { reviewed: parsed.data.reviewed, byProvider: parsed.data.providers };
}
