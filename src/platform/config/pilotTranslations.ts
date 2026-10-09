// CATALOGUE_PILOT_MACHINE_TRANSLATIONS (product owner's pilot decision, 2026-10-09): residents see everything in their
// chosen language, in all 15 languages, with no "not yet available in this language" or "machine-translated, not reviewed"
// warning. With the setting on (the default), the provider seed, the guides and numbers seed, the directory release and
// the terms load every current machine translation (category, subcategory, description, emergency role, guide, number,
// terms text), safety-critical ones included. Two safeguards stay whatever the setting says: the facts check (numbers,
// phone numbers, times, weekdays, postal codes, emails and web addresses must match the English, else the translation is
// not loaded) and the 911 rules (a translation of a text with 911 must keep 911; a blank 911 text refuses the guides seed).
// A translation of English that has changed since (stale) never loads either. `off` goes back to the earlier rules
// (AD-11: reviewed-only, except ordinary provider descriptions; decision 42 for safety-critical ones).
//
// Read by the seed scripts (from their own environment: the "Seed production" workflow passes the repository variable of
// the same name) and by the app (src/platform/config/env.ts, for the publish job and the terms). Pure: no I/O.

export const PILOT_MACHINE_TRANSLATIONS_VAR = "CATALOGUE_PILOT_MACHINE_TRANSLATIONS";

/** The default when the variable is unset or blank: on (the product owner's pilot decision). */
export const PILOT_MACHINE_TRANSLATIONS_DEFAULT = true;

/** `on` or `off` (any case, surrounding space ignored); unset or blank is the default. Anything else is an error message. */
export function parsePilotMachineTranslations(value: string | undefined): { ok: boolean } | { problem: string } {
  const text = (value ?? "").trim().toLowerCase();
  if (text === "") return { ok: PILOT_MACHINE_TRANSLATIONS_DEFAULT };
  if (text === "on") return { ok: true };
  if (text === "off") return { ok: false };
  return { problem: `${PILOT_MACHINE_TRANSLATIONS_VAR}: must be \`on\` or \`off\`` };
}

/** The setting from an environment (the seed scripts'). Throws, naming the variable, when it is set to anything but on or off. */
export function pilotMachineTranslations(env: Readonly<Record<string, string | undefined>>): boolean {
  const parsed = parsePilotMachineTranslations(env[PILOT_MACHINE_TRANSLATIONS_VAR]);
  if ("problem" in parsed) throw new Error(parsed.problem);
  return parsed.ok;
}
