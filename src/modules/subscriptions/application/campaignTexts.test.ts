// The end-of-pilot texts (S09.07): the campaign text, the confirmation after YES, the answer after the deadline and the answer while sign-ups are paused, built from
// the catalog in the resident's language, normalised and counted as every outbound text is (AD-21). Each fits one text message in every language with the real
// encoder (GSM-7 or UCS-2, SmartEncoded=false); the campaign text with the longest date the deadline can be, in every month.
import { describe, expect, it } from "vitest";
import { LAUNCH_CODES } from "../../../i18n/languages";
import { residentText } from "../../../i18n/residentTexts";
import { deadlineInText } from "../domain/campaign";
import { renderCampaignText } from "./campaign";
import { residentSms } from "./inbound";

/** The 28th of every month of a year: the longest day number with every month name. */
const DAYS = Array.from({ length: 12 }, (_, month) => `2027-${String(month + 1).padStart(2, "0")}-28`);

describe("the end-of-pilot texts", () => {
  it("fit one text message in every language: the campaign text with every month's longest date", () => {
    for (const lang of LAUNCH_CODES) {
      for (const day of DAYS) {
        const text = renderCampaignText(lang, deadlineInText(day, lang));
        expect(text.segments, `reconsent ${lang} ${day}: ${text.body}`).toBe(1);
      }
      for (const name of ["reconsentKept", "pilotEnded", "signupsPaused"] as const) expect(residentSms(lang, name).segments, `${name} ${lang}`).toBe(1);
    }
  });

  it("keep YES and CVH in English and name the deadline in the campaign text, in every language", () => {
    for (const lang of LAUNCH_CODES) {
      const catalog = residentText(lang, "reconsent");
      expect(catalog, lang).toMatch(/\bYES\b/u);
      expect(catalog, lang).toContain("CVH");
      expect(catalog, lang).toContain("{date}");
      const text = renderCampaignText(lang, deadlineInText("2026-12-05", lang));
      expect(text.body, lang).not.toContain("{date}");
      expect(text.body, lang).toContain(deadlineInText("2026-12-05", lang));
      for (const name of ["reconsentKept", "pilotEnded", "signupsPaused"] as const) expect(residentText(lang, name), `${name} ${lang}`).toContain("CVH");
    }
  });

  it("say the deadline day is included (YES is taken until the end of it), never 'before' it", () => {
    // The words around {date} in the languages a review found saying "before": until (tl), until the end of (es), before the end of (zh).
    expect(residentText("tl", "reconsent")).toContain("hanggang {date}");
    expect(residentText("es", "reconsent")).toContain("hasta el final del {date}");
    expect(residentText("zh", "reconsent")).toContain("{date}结束前");
    for (const [lang, before] of [["tl", "bago ang {date}"], ["es", "antes del {date}"], ["zh", "{date}前"]] as const) expect(residentText(lang, "reconsent"), lang).not.toContain(before);
  });

  it("say in English what the story says", () => {
    expect(renderCampaignText("en", "December 5").body).toBe("The CVH pilot is ending. Reply YES to keep getting alerts. If you do not reply by December 5, your number will be deleted.");
    expect(residentSms("en", "pilotEnded").body).toBe("The CVH pilot has ended; your number was not kept.");
    expect(residentSms("en", "signupsPaused").body).toBe("CVH text sign-ups are paused while the pilot ends.");
    expect(residentSms("en", "reconsentKept").body).toBe("Thank you. You will keep getting CVH alerts.");
  });
});
