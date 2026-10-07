/** English and French lead display lists; other languages retain their supplied order. Never changes delivery order. */
export function orderedByLanguage<T>(items: readonly T[], codeOf: (item: T) => string): T[] {
  const rank = (code: string) => code === "en" ? 0 : code === "fr" ? 1 : 2;
  return [...items].sort((a, b) => rank(codeOf(a)) - rank(codeOf(b)));
}
export function orderedLanguages<T extends { code: string }>(languages: readonly T[]): T[] {
  return orderedByLanguage(languages, (language) => language.code);
}
