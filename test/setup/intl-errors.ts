// Every vitest file runs this first (vitest.config.mts, setupFiles). next-intl's default onError only logs a
// translation that could not be written (console.error): a missing `{placeholder}` value, a missing key, a message
// that is not a string. Under test that error fails the test instead, at the t() call that caused it, so a screen
// cannot quietly render "directory.checkedByHub" or a date in the wrong language and stay green.
// ENVIRONMENT_FALLBACK (no timeZone given to a test's NextIntlClientProvider) is advice, not a wrong text: it stays a log.
import { IntlErrorCode } from "next-intl";

const ALLOWED: ReadonlySet<string> = new Set([IntlErrorCode.ENVIRONMENT_FALLBACK]);
const CODES: ReadonlySet<string> = new Set(Object.values(IntlErrorCode));

/** next-intl's IntlError, told by its shape: "CODE: message" with a code next-intl defines. */
export const isTranslationError = (value: unknown): value is Error & { code: string } => {
  if (!(value instanceof Error)) return false;
  const code: unknown = (value as Error & { code?: unknown }).code;
  return typeof code === "string" && CODES.has(code) && !ALLOWED.has(code) && value.message.startsWith(`${code}:`);
};

const log = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const error = args.find(isTranslationError);
  if (error) throw error;
  log(...args);
};
