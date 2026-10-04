// The texts the inbound router sends (S07.04): built from the catalog in the resident's language, normalised and counted as every outbound
// text is. The deletion's prompt and "already signed up" are prompts, so they fit one text in every language (S07.05's fixture checks every
// menu and prompt with the real encoder; these two are checked here already).
import { describe, expect, it } from "vitest";
import { LAUNCH_CODES } from "../../../i18n/languages";
import { residentSms, signupLink } from "./inbound";

describe("the inbound router's texts", () => {
  it("fit one text (segment) in every language for the prompts", () => {
    for (const lang of LAUNCH_CODES) {
      expect(residentSms(lang, "deletePrompt").segments, `deletePrompt ${lang}`).toBe(1);
      expect(residentSms(lang, "alreadySignedUp").segments, `alreadySignedUp ${lang}`).toBe(1);
    }
  });

  it("fill the sign-up link in the language of the reply", () => {
    const link = signupLink("https://cvh.example/", "ur");
    expect(link).toBe("https://cvh.example/ur/text-alerts");
    const { body } = residentSms("ur", "signupInfo", { link });
    expect(body).toContain(link);
    expect(body).not.toContain("{link}");
    expect(residentSms("en", "signupInfo", { link: signupLink("https://cvh.example", "en") }).body).toBe("To get CVH alerts by text, sign up here: https://cvh.example/en/text-alerts Reply STOP to stop.");
  });

  it("tell a new subscriber about replies 1, 2, 3 and 0, STOP and the overnight notice", () => {
    const { body } = residentSms("en", "welcome");
    expect(body).toMatch(/Reply 1 .*building or floor, 2 .*language, 3 .*check-in request, 0 .*delete/u);
    expect(body).toContain("Reply STOP");
    expect(body).toMatch(/Hub staff check every message, so alerts may not be sent overnight/u);
  });
});
