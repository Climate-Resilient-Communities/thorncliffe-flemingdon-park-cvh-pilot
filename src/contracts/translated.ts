// `Translated` (S04.02, AD-10, AD-20): one text in one language, as translation hands it to alerting (frozen with an entry
// at submit), to the SMS renderer (S04.06) and to the web feed. The shape is AD-20's `{lang, body, machine, model, status,
// source_hash}`; a `zh-Hant` text also names the conversion it came from, like a directory listing's text does
// (src/contracts/directory.ts). Pure and browser-safe.
//
// The status says what the body is:
//  - `source`: the English text itself (`lang` is `en`).
//  - `ok`: a model's translation that passed the language and script checks (`model` is the model that wrote it).
//  - `script_converted`: `zh-Hant`, converted from the passing `zh` text by OpenCC; `model` names the conversion and
//    `conversion` records the zh text it was made from, the OpenCC version and its configuration.
//  - `fallback_en`: no model in the route produced a passing text, so `body` is the English text, `lang` is the language
//    the reader asked for, and the client and the SMS renderer add the catalog string `translation.unavailable` beside it.
//    Nothing about a translation is claimed: no model, not machine.
// `source_hash` is the sha256 of the English text every status stands for.
import { z } from "zod";
import { ConversionSchema } from "./directory";
import { LangCodeSchema } from "./lang";

export const TRANSLATED_STATUSES = ["source", "ok", "fallback_en", "script_converted"] as const;
export type TranslatedStatus = (typeof TRANSLATED_STATUSES)[number];

export const TranslatedSchema = z
  .strictObject({
    lang: LangCodeSchema,
    body: z.string().min(1),
    /** True for text a model wrote and for text converted from it: the machine-translation label goes with it. */
    machine: z.boolean(),
    /** The translation model, or the conversion's name for `zh-Hant`; null for English and for the English fallback. */
    model: z.string().min(1).nullable(),
    status: z.enum(TRANSLATED_STATUSES),
    /** sha256 of the English text this one stands for. */
    source_hash: z.string().regex(/^[0-9a-f]{64}$/),
    /** `zh-Hant` only: the zh text that was converted, the OpenCC version and configuration (the cache key's other parts). */
    conversion: ConversionSchema.optional(),
  })
  .superRefine((text, context) => {
    const refuse = (message: string) => context.addIssue({ code: "custom", message });
    if (text.status === "source") {
      if (text.lang !== "en" || text.machine || text.model !== null) refuse("source is the English text: lang en, not machine, no model");
    } else if (text.lang === "en") {
      refuse("only the source is in English");
    }
    if (text.status === "ok" && (!text.machine || text.model === null)) refuse("a translation is machine text with the model that wrote it");
    if (text.status === "fallback_en" && (text.machine || text.model !== null)) refuse("the English fallback is not machine text and has no model");
    if (text.status === "script_converted") {
      if (text.lang !== "zh-Hant") refuse("only zh-Hant is converted");
      if (!text.machine || text.model === null) refuse("a conversion is machine text and names itself as the model");
      if (text.conversion === undefined) refuse("a conversion records what it converted");
    } else if (text.conversion !== undefined) {
      refuse("only a converted text has a conversion");
    }
  });

export type Translated = z.infer<typeof TranslatedSchema>;
