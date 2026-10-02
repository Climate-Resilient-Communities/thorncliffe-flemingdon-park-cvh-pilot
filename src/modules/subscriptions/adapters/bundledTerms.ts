// The terms read from the committed files, bundled into the build: the JSON is imported, so a page prerendered at
// build time and a route that runs later (the web sign-up, S07.02) read the same text and need no file access at
// run time. A language without reviewed text has null entries and shows English with translation.unavailable.
import type { LangCode } from "@/contracts/lang";
import type { TranslationFile } from "@/contracts/contentReview";
import { sha256Hex } from "@/platform/hash";
import { createTermsService } from "../application/termsService";
import type { TermsInput, TermsSource } from "../domain/terms";
import terms from "../../../../data/catalogue/terms.json";
import bn from "../../../../data/catalogue/translations/content/bn.json";
import el from "../../../../data/catalogue/translations/content/el.json";
import es from "../../../../data/catalogue/translations/content/es.json";
import fr from "../../../../data/catalogue/translations/content/fr.json";
import gu from "../../../../data/catalogue/translations/content/gu.json";
import hi from "../../../../data/catalogue/translations/content/hi.json";
import pa from "../../../../data/catalogue/translations/content/pa.json";
import prs from "../../../../data/catalogue/translations/content/prs.json";
import ps from "../../../../data/catalogue/translations/content/ps.json";
import sk from "../../../../data/catalogue/translations/content/sk.json";
import ta from "../../../../data/catalogue/translations/content/ta.json";
import tl from "../../../../data/catalogue/translations/content/tl.json";
import ur from "../../../../data/catalogue/translations/content/ur.json";
import zh from "../../../../data/catalogue/translations/content/zh.json";
import zhHant from "../../../../data/catalogue/translations/content/zh-Hant.json";

const translations = { bn, el, es, fr, gu, hi, pa, prs, ps, sk, ta, tl, ur, zh, "zh-Hant": zhHant } as unknown as Partial<
  Record<LangCode, TranslationFile>
>;

export const bundledTermsInput = (): TermsInput => ({ terms: terms as unknown as TermsSource, translations });

/** The terms as committed, checked against today's date in UTC. */
export const termsService = createTermsService({
  load: bundledTermsInput,
  hash: sha256Hex,
  today: () => new Date().toISOString().slice(0, 10),
});
