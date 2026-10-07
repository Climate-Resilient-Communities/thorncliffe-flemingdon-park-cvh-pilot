/** English and French lead every resident picker; the remaining languages keep their supplied order. */
export function orderedLanguages<T extends { code: string }>(languages: readonly T[]): T[] {
  const rank = (code: string) => code === "en" ? 0 : code === "fr" ? 1 : 2;
  return [...languages].sort((a, b) => rank(a.code) - rank(b.code));
}
