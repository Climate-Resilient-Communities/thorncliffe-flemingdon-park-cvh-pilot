# Digest: Translation service coverage, pricing, region, Cohere Embed 5 (r2-1)

Accessed: 2026-10-01. Tool calls: 12 (incl. this write). Sources fetched: 9 (1 Google redirect, 1 search).
Classes: P = primary vendor doc; S = summarizer extraction of a primary page (fetch tool used a small model; treat cells as extraction, not verbatim).

## Language x service table (text translation, EN -> target)

| Language | Google Cloud Translation (NMT) | Google Translation LLM | Azure Translator (NMT cloud) | Azure LLM translation | Amazon Translate | DeepL API |
|---|---|---|---|---|---|---|
| Urdu | Yes `ur` | Yes | Yes `ur` | Yes | Yes `ur` | Claimed yes (LOW conf.) |
| Tagalog/Filipino | Yes `fil`/`tl` | Yes | Yes `fil` | Yes | Yes `tl` | Claimed yes (LOW) |
| Gujarati | Yes `gu` | Yes | Yes `gu` | Yes | Yes `gu` | Claimed yes (LOW) |
| Slovak | Yes `sk` | Yes | Yes `sk` | Yes | Yes `sk` | Yes (MED) |
| Bengali | Yes `bn` | Yes | Yes `bn` (Bangla) | Yes | Yes `bn` | Claimed yes (LOW) |
| Tamil | Yes `ta` | Yes | Yes `ta` | Yes | Yes `ta` | Claimed yes (LOW) |
| Pashto | Yes `ps` | No (NMT only) | Yes `ps` | No | Yes `ps` | Claimed yes (LOW) |
| Punjabi (Gurmukhi) | Yes `pa` (+ `pa-Arab` Shahmukhi) | Yes | Yes `pa` (Gurmukhi script per transliteration table) | Yes | Yes `pa` | Claimed yes (LOW) |
| Dari | NOT separate; only Persian `fa` | n/a | Yes, separate `prs` | No | Yes, separate `fa-AF` | Claimed yes (VERY LOW - likely extraction error) |
| Persian (Iranian) | Yes `fa` | Yes | Yes `fa` | Yes | Yes `fa` | Claimed yes (LOW) |
| French | Yes | Yes | Yes `fr` (+`fr-ca`) | Yes | Yes `fr` (+`fr-CA`) | Yes |
| Spanish | Yes | Yes | Yes `es` | Yes | Yes `es` (+`es-MX`) | Yes |
| Hindi | Yes | Yes | Yes `hi` | Yes | Yes `hi` | Claimed yes (LOW) |
| Chinese Simplified | Yes `zh-CN` | Yes | Yes `zh-Hans` | Yes | Yes `zh` | Yes |
| Greek | Yes `el` | Yes | Yes `el` | Yes | Yes `el` | Yes |

Bottom line: Azure Translator and Amazon Translate are the only two verified to cover all 14 targets INCLUDING a distinct Dari code. Google covers all except a distinct Dari.

## Claims

1. Azure Translator lists Dari `prs`, Pashto `ps`, Punjabi `pa`, Urdu `ur`, Filipino `fil`, Gujarati `gu`, Slovak `sk`, Bangla `bn`, Tamil `ta`, Persian `fa` (separate), plus fr/es/hi/zh-Hans/el, all with cloud text translation. Dari and Pashto lack Custom Translator and LLM translation. — https://learn.microsoft.com/en-us/azure/ai-services/translator/language-support — Microsoft — ms.date 2026-06-06 (updated_at 2026-08-23) — accessed 2026-10-01 — HIGH — P (table returned verbatim)
2. Azure document translation of scanned PDFs/images: Dari, Pashto, Urdu, Gujarati, Persian NOT supported as target; Bangla, Greek not supported at all (irrelevant for plain text alerts). — same source — HIGH — P
3. Amazon Translate lists Dari `fa-AF` separately from Farsi `fa`, Pashto `ps`, Punjabi `pa`, "Filipino, Tagalog" `tl`, Urdu, Gujarati, Slovak, Bengali, Tamil, fr, es, hi, zh, el. — https://docs.aws.amazon.com/translate/latest/dg/what-is-languages.html — AWS — no page date shown — HIGH — P (verbatim table)
4. Google Cloud Translation lists ur, fil/tl, gu, sk, bn, ta, ps, pa (+pa-Arab), fa, fr, es, hi, zh-CN, el; Dari is NOT a separate entry; Pashto is NMT-only (not Translation LLM). — https://docs.cloud.google.com/translate/docs/languages (cloud.google.com 301-redirects here) — Google — "Last updated 2026-09-24 UTC" — MED — S
5. DeepL API supported-languages page: summarizer claimed all 15 incl. Dari, Pashto, Punjabi, Urdu supported as target. Not verified verbatim; Dari claim is implausible and must be rechecked. — https://developers.deepl.com/docs/getting-started/supported-languages — DeepL — no date — LOW — S
6. Amazon Translate: $15.00 per million characters standard real-time text; free tier 2M chars/month for 12 months; Active Custom Translation $60/M; >1B chars/month contact for discount. — https://aws.amazon.com/translate/pricing/ — AWS — no date — HIGH — S (quoted strings)
7. Azure Translator: Free F0 = 2M characters/month (standard + custom training); S1 PAYG per-million price NOT rendered (JS-loaded "$-"); Canada Central and Canada East appear in the region dropdown. — https://azure.microsoft.com/en-us/pricing/details/cognitive-services/translator/ — Microsoft — no date — MED (free tier) / price UNKNOWN — S
8. Google Cloud Translation pricing: page fetch truncated; no figures obtained. Summarizer's numbers were guesses and are DISCARDED. — https://cloud.google.com/translate/pricing — GAP
9. Cohere Embed 5 (Pro and Fast variants) "Supports over 100 languages"; 128K context; no per-language list in the changelog; largest gains vs Embed 4 reported for Farsi (+13), Telugu (+12), Hindi (+12). None of Pashto, Dari, Urdu, Tagalog, Gujarati, Punjabi, Tamil, Bengali, Slovak named. — https://docs.cohere.com/changelog/embed-v5 (changelog) and https://cohere.com/blog/embed-5 (via search snippet only) — Cohere — date not visible (launch ~2026-09-30 per brief) — MED — P/S

## Pricing table (per million characters, text translation)

| Service | Standard price | Free tier | Notes |
|---|---|---|---|
| Amazon Translate | $15.00 | 2M chars/month for 12 months | Custom (ACT) $60/M; volume discount >1B/mo |
| Azure Translator | NOT RETRIEVED (JS-rendered) | 2M chars/month (F0), no stated expiry | Commitment tiers exist; Canada regions selectable |
| Google Cloud Translation | NOT RETRIEVED | NOT RETRIEVED | Page truncated |
| DeepL API | not researched | not researched | |

Scale note (own arithmetic, not sourced): ~100 descriptions x ~500 chars x 14 languages ≈ 0.7M chars per full refresh, inside either 2M/month free tier.

## Q3 Canada region
- Only evidence: Azure pricing page region dropdown includes Canada Central and Canada East (claim 7). Whether Translator has a Canada regional/data-residency endpoint was NOT verified. AWS/Google Canada region availability for Translate NOT verified. -> GAP.

## Leads
- Azure Translator regional endpoints / data residency doc: learn.microsoft.com "translator reference v3 ... base URLs" (look for api-nam / Canada processing).
- AWS Regional services list for Amazon Translate in ca-central-1: https://aws.amazon.com/about-aws/global-infrastructure/regional-product-services/
- Google Translation v3 regional endpoints (us-central1, europe-west1 only, unverified belief) - check docs.cloud.google.com/translate/docs/advanced/endpoints.
- Cohere per-language list: https://docs.cohere.com/docs/cohere-embed and the GitHub supported-languages.mdx (cohere-ai/cohere-developer-experience, fern/pages/text-embeddings/multilingual-language-models/supported-languages.mdx) - may be the Embed v3 list; check whether Embed 5 references it.
- DeepL: re-fetch supported-languages page asking for verbatim table rows with codes; check if newer languages are "beta"/no formality.

## Gaps
- Azure and Google per-million prices; Google free tier.
- Canada-region processing for all three.
- Cohere Embed 5 explicit per-language list (none found in changelog).
- DeepL coverage unverified (summarizer output looks unreliable).
- Quality of Dari vs Persian output not assessed (no evidence collected).
