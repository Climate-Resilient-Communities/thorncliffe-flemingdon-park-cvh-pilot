// The Canadian area-code list (E07 definitions, "Canadian number"; AD-22: sign-up accepts only Canadian +1 numbers). Configuration, kept in
// the repository so the server and the sign-up form (which checks a number as it is typed) read the same list; docs/config.md says how to
// change it. The geographic area codes of the North American Numbering Plan assigned to Canada (CNAC), overlays included; Canada's
// non-geographic codes (600, 622, 633, 644, 655, 677, 688) are left out, because a text alert goes to a phone a person carries. A new overlay
// is added here, with its province, before it is in service. Pure and browser-safe.

/** By province or territory, as the numbering administrator lists them. */
export const CANADIAN_AREA_CODES_BY_REGION: Readonly<Record<string, readonly string[]>> = {
  AB: ["368", "403", "587", "780", "825"],
  BC: ["236", "250", "257", "604", "672", "778"],
  MB: ["204", "431", "584"],
  NB: ["428", "506"],
  NL: ["709", "879"],
  "NS-PE": ["782", "902"],
  ON: ["226", "249", "289", "343", "365", "382", "416", "437", "519", "548", "613", "647", "683", "705", "742", "753", "807", "905", "942"],
  QC: ["263", "354", "367", "418", "438", "450", "468", "514", "579", "581", "819", "873"],
  SK: ["306", "474", "639"],
  "NT-NU-YT": ["867"],
};

/** Every Canadian geographic area code, as a set. */
export const CANADIAN_AREA_CODES: ReadonlySet<string> = new Set(Object.values(CANADIAN_AREA_CODES_BY_REGION).flat());

/** Whether a three-digit area code is on the Canadian list. */
export function isCanadianAreaCode(code: string): boolean {
  return CANADIAN_AREA_CODES.has(code);
}
