// The name of a resident's language as the staff surface writes it (English, the staff language of the pilot): "English", "Urdu", "Chinese (Traditional)". The
// check-in round and an escalation's page say it beside the resident's number (UAT note 9), so the person who calls or texts them does it in their language.
import { englishText } from "@/i18n/text";

export function staffLanguageName(lang: string): string {
  return lang === "en" ? englishText("staff.approve.languageEnglish") : englishText(`staff.compose.languageNames.${lang}`);
}
