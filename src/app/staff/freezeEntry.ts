// Composition root of an entry's frozen content for the staff surface (AD-2, AD-21, S04.06): the text messages
// rendered once, counted and hashed (alerting's freezeContent, which uses messaging's renderer), with the public
// origin from the validated environment, the one way PUBLIC_BASE_URL is read (src/platform/config/env.ts, never
// process.env). S04.05's submit calls this with the translations S04.02 returned. Server only.
import { freezeContent, type FreezeInput, type FreezeResult } from "@/modules/alerting";
import { getEnv } from "@/platform/config/env";

/** What the entry's links need from the environment. */
export interface FreezeEnv {
  publicBaseUrl: string;
}

/** The text messages, web texts and content hash of a draft, linking to `/a/{slug}` under PUBLIC_BASE_URL. */
export function freezeEntryContent(input: Omit<FreezeInput, "publicBaseUrl">, env: FreezeEnv = getEnv()): FreezeResult {
  return freezeContent({ ...input, publicBaseUrl: env.publicBaseUrl });
}
