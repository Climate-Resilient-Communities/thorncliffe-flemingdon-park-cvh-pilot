// The Hub's list of which neighbourhood each provider is in (S02.06): data/catalogue/provider-neighbourhoods.json. The
// directory's neighbourhood filter on the phone shows exactly this list, through the `neighbourhood_ids` of each provider
// in the release files. Pure: the adapter reads the file, this checks it.
//
// The file is {reviewed, note, rule, providers: {<provider id>: ["TP"] | ["FP"] | ["TP","FP"] | []}}. It is made once by
// npm run derive:neighbourhoods and says "reviewed": false until the Hub has reviewed it. It ships with the app like the
// other catalogue files, so `catalogue_hash` (which covers all of data/catalogue/) changes when it does, and no migration
// is needed.
import { z } from "zod";
import { NEIGHBOURHOOD_IDS, NeighbourhoodIdSchema, type NeighbourhoodId } from "@/contracts/directory";

const FileSchema = z.strictObject({
  reviewed: z.boolean(),
  note: z.string().min(1),
  rule: z.string().min(1),
  providers: z.record(z.string().regex(/^[A-Z][0-9]{3,6}$/), z.array(NeighbourhoodIdSchema)),
});

export interface ProviderNeighbourhoods {
  /** True once the Hub has reviewed the list. */
  reviewed: boolean;
  /** provider id -> neighbourhoods, each once, in the order TP, FP. */
  byProvider: Readonly<Record<string, readonly NeighbourhoodId[]>>;
}

/** The file as the release uses it. Throws an Error naming what is wrong when the file is not in the shape above. */
export function parseProviderNeighbourhoods(raw: unknown): ProviderNeighbourhoods {
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`provider-neighbourhoods.json: ${parsed.error.issues.map((i) => `${i.path.join(".") || "(file)"}: ${i.message}`).join("; ")}`);
  }
  const byProvider: Record<string, readonly NeighbourhoodId[]> = {};
  for (const [id, ids] of Object.entries(parsed.data.providers)) byProvider[id] = NEIGHBOURHOOD_IDS.filter((n) => ids.includes(n));
  return { reviewed: parsed.data.reviewed, byProvider };
}
