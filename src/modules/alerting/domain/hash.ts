// The content hash of an entry (AD-21, AD-5, S04.06): the one value an approval binds to. Computed only here.
//
//   content_hash = sha256( RFC 8785 canonical JSON of
//     {kind, alert_id, supersedes_id, types, phase, audience, channels, is_drill, valid_until, sms_bodies, web_texts} )
//
// as lower-case hex. The canonical JSON is RFC 8785 (JCS): members in UTF-16 code unit order, numbers as
// ECMAScript writes them, strings with the minimal escapes, no white space. It is made by `canonicalize`
// (5.1.0, exact-pinned, in the spine's dependency table), which test/RFC examples in hash.test.ts exercise.
//
// Lists are sorted so the same content hashes the same whatever order it was assembled in: `sms_bodies` and
// `web_texts` by language, `types` and `channels` by code unit. `web_texts` holds the English original
// (`status: "source"`) and every translated language; `sms_bodies` holds each language's frozen body with its
// encoding and segment count, so an approval binds to the bytes that will be sent. Pure, no clock.
import { createHash } from "node:crypto";
import canonicalize from "canonicalize";
import type { Audience } from "../../../contracts/audience";
import type { EntryKind } from "./lifecycle";
import type { Phase } from "./content";

/** One language's frozen text message (the shape stored in `alert_entry.sms_bodies`, S04.06). */
export interface HashedSmsBody {
  body: string;
  encoding: "gsm7" | "ucs2";
  segments: number;
}

/** One language's web text (alerting's FrozenTranslation fits this). */
export interface HashedWebText {
  lang: string;
  body: string;
  machine: boolean;
  model: string | null;
  status: "source" | "ok" | "translated" | "fallback_en" | "script_converted";
  sourceHash: string;
}

/** What is frozen at submit, as the hash sees it. */
export interface HashedEntry {
  kind: EntryKind;
  alertId: string;
  /** The entry a correction or withdrawal replaces; null for every other entry. */
  supersedesId: string | null;
  types: readonly string[];
  phase: Phase;
  audience: Audience;
  /** The channels the entry goes out on, such as `web` and `sms`. */
  channels: readonly string[];
  isDrill: boolean;
  validUntil: Date;
  /** The English text as written: the web text of the authoring language. */
  text: string;
  /** Each language's frozen text message, keyed by language (`en` included). */
  smsBodies: Readonly<Record<string, HashedSmsBody>>;
  /** The translated web texts (the English original is added from `text`). */
  webTexts: readonly HashedWebText[];
}

/** The hashed object: exactly the spine's eleven members. */
export interface ContentHashInput {
  kind: string;
  alert_id: string;
  supersedes_id: string | null;
  types: string[];
  phase: string;
  audience: Audience;
  channels: string[];
  is_drill: boolean;
  valid_until: string;
  sms_bodies: { lang: string; body: string; encoding: string; segments: number }[];
  web_texts: { lang: string; body: string; machine: boolean; model: string | null; status: string; source_hash: string }[];
}

/** Code-unit order: the same on every machine and in every locale. */
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byLang = (a: { lang: string }, b: { lang: string }) => byText(a.lang, b.lang);

/** SHA-256 of a UTF-8 string, as lower-case hex. */
function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The object that is hashed, with its lists sorted. Throws when the content cannot be hashed (an invalid date, a repeated language). */
export function contentHashInput(entry: HashedEntry): ContentHashInput {
  if (Number.isNaN(entry.validUntil.getTime())) throw new RangeError("valid_until is not a date");
  const original: HashedWebText = { lang: "en", body: entry.text, machine: false, model: null, status: "source", sourceHash: sha256Hex(entry.text) };
  const webTexts = [original, ...entry.webTexts].map((text) => ({
    lang: text.lang,
    body: text.body,
    machine: text.machine,
    model: text.model,
    status: text.status,
    source_hash: text.sourceHash,
  }));
  const smsBodies = Object.entries(entry.smsBodies).map(([lang, sms]) => ({ lang, body: sms.body, encoding: sms.encoding, segments: sms.segments }));
  for (const list of [webTexts, smsBodies]) {
    if (new Set(list.map(({ lang }) => lang)).size !== list.length) throw new RangeError("A language appears twice in the content to hash");
  }
  return {
    kind: entry.kind,
    alert_id: entry.alertId,
    supersedes_id: entry.supersedesId,
    types: [...entry.types].sort(byText),
    phase: entry.phase,
    audience: entry.audience,
    channels: [...entry.channels].sort(byText),
    is_drill: entry.isDrill,
    valid_until: entry.validUntil.toISOString(),
    sms_bodies: smsBodies.sort(byLang),
    web_texts: webTexts.sort(byLang),
  };
}

/** The RFC 8785 canonical JSON of the hashed object. */
export function canonicalContent(entry: HashedEntry): string {
  const json = canonicalize(contentHashInput(entry));
  if (json === undefined) throw new Error("The content has no canonical JSON");
  return json;
}

/** The content hash: sha256 of the canonical JSON, 64 lower-case hex digits. */
export function contentHash(entry: HashedEntry): string {
  return sha256Hex(canonicalContent(entry));
}

/** The canonical JSON of any value (RFC 8785), for the one place that needs it: the hash and its RFC 8785 tests. */
export function canonicalJson(value: unknown): string {
  const json = canonicalize(value);
  if (json === undefined) throw new Error("The value has no canonical JSON");
  return json;
}
