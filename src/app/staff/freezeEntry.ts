// Composition root of an entry's frozen content for the staff surface (AD-2, AD-21, S04.06): the text messages
// rendered once, counted and hashed (alerting's freezeContent, which uses messaging's renderer), with the public
// origin from the validated environment, the one way PUBLIC_BASE_URL is read (src/platform/config/env.ts, never
// process.env). S04.05's submit calls this with the translations S04.02 returned. Server only.
import { freezeContent, previewSms, type FreezeInput, type FreezeResult, type PreviewContext } from "@/modules/alerting";
import type { RenderedSms } from "@/modules/messaging";
import { getEnv } from "@/platform/config/env";

/** What the entry's links need from the environment. */
export interface FreezeEnv {
  publicBaseUrl: string;
}

/** The text messages, web texts and content hash of a draft, linking to `/a/{slug}` under PUBLIC_BASE_URL. */
export function freezeEntryContent(input: Omit<FreezeInput, "publicBaseUrl">, env: FreezeEnv = getEnv()): FreezeResult {
  return freezeContent({ ...input, publicBaseUrl: env.publicBaseUrl });
}

/** The English text message of a draft as a submit will render it, for the composer's preview (S04.05); the origin is read the same way. */
export function previewEntrySms(content: Parameters<typeof previewSms>[0], context: PreviewContext, env: FreezeEnv = getEnv()): RenderedSms {
  return previewSms(content, context, env.publicBaseUrl);
}
