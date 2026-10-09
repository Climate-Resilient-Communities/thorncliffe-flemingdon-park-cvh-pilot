"use client";

import { useEffect } from "react";
import { DEVICE_CHOICES_KEY, parseDeviceChoices } from "@/contracts/deviceChoices";
import { DEFAULT_LANGUAGE, isLaunchCode, type LaunchCode } from "@/i18n/languages";

/** The language the resident chose on this phone (`cvh.choices`), or null: none, unreadable, or storage blocked. */
export function savedLanguage(read: () => string | null): LaunchCode | null {
  try {
    const lang = parseDeviceChoices(read())?.lang;
    return isLaunchCode(lang) ? lang : null;
  } catch {
    return null;
  }
}

/**
 * Where the bare address `/` goes: the resident's own language when the phone has one, otherwise English, whose home sends a
 * first visit to the language choice (R-01, the first-run gate). The page itself is the same for everyone (it is static and may
 * be cached anywhere); only the phone decides, after it has loaded.
 */
export function rootTarget(saved: LaunchCode | null): string {
  return `/${saved ?? DEFAULT_LANGUAGE}`;
}

/**
 * Where an address with no language in it (`/nope`, answered by the English 404 behind the same address) goes: the same path
 * under the saved language, when the phone has one other than English. Null when it stays: a language already in the path, or
 * no saved language, or English.
 */
export function unprefixedTarget(pathname: string, search: string, saved: LaunchCode | null): string | null {
  const first = pathname.split("/")[1] ?? "";
  if (isLaunchCode(first) || saved === null || saved === DEFAULT_LANGUAGE) return null;
  return `/${saved}${pathname}${search}`;
}

const readChoices = () => window.localStorage.getItem(DEVICE_CHOICES_KEY);

/** On `/`: sends the resident on to their language (rootTarget), replacing the entry so Back does not return to `/`. */
export function RootEntry() {
  useEffect(() => {
    window.location.replace(rootTarget(savedLanguage(readChoices)));
  }, []);
  return null;
}

/** On a 404 drawn for an address with no language (unprefixedTarget): shows it again in the resident's own language. */
export function SavedLanguageNotFound() {
  useEffect(() => {
    const target = unprefixedTarget(window.location.pathname, window.location.search, savedLanguage(readChoices));
    if (target !== null) window.location.replace(target);
  }, []);
  return null;
}
