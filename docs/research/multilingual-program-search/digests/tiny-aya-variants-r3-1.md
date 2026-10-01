# Digest: Cohere Tiny Aya variants vs 15 launch languages (r3-1)

Accessed: 2026-10-01 (all sources). Decision served: can the Tiny Aya family translate/serve EN, FR, UR, TL, GU, Dari, SK, BN, TA, PS, HI, ZH-Hans, EL, ES, PA?

## Sources
| # | URL | Publisher | Pub date | Notes |
|---|-----|-----------|----------|-------|
| S1 | https://huggingface.co/CohereLabs/tiny-aya-global (also -earth, -fire, -water, -base) | Cohere Labs / Hugging Face | repos created 2026-02-13; last modified 2026-09-30 (HF API) | Model cards; weights gated (login + accept terms) |
| S2 | https://huggingface.co/api/models/CohereLabs/tiny-aya-{global,earth,fire,water,base} | Hugging Face API | same | `cardData.language` tags (67 ISO codes, identical for all 5) and `license: cc-by-nc-4.0` |
| S3 | https://docs.cohere.com/docs/tiny-aya | Cohere | undated | Variant purposes; API availability |
| S4 | https://arxiv.org/abs/2603.11510 (PDF) "Tiny Aya: Bridging Scale and Multilingual Depth" | Cohere / Cohere Labs (Salamanca et al.) | v1 2026-03-12 | Table 1 language/script list; Tables 21-22 per-language ChrF; quantization + iPhone results |
| S5 | https://cohere.com/pricing | Cohere | undated | Tiny Aya not listed; trial vs production key terms |
| S6 | https://techcrunch.com/2026/02/17/cohere-launches-a-family-of-open-multilingual-models/ | TechCrunch | 2026-02-17 | Launch coverage; distribution channels |
| S7 | https://creativecommons.org/licenses/by-nc/4.0/legalcode.en | Creative Commons | n/a | NonCommercial definition |
| S8 | WebSearch snippets (therundown.ai, toknow.ai etc.) | secondary | 2026 | Used only as pointers; not relied on |

## Claims
| # | Claim | Source | Publisher | Pub date | Confidence | Class |
|---|-------|--------|-----------|----------|------------|-------|
| C1 | Family = 5 models: tiny-aya-base (pretrained), tiny-aya-global ("Best balance across languages and regions"), tiny-aya-earth ("Best for West Asian and African languages"), tiny-aya-fire ("Best for South Asian languages"), tiny-aya-water ("Best for European and Asia Pacific languages"). | S1, S3 | Cohere | 2026-02-13 | High | fact (primary) |
| C2 | Tech report wording: "Tiny Aya Earth: Strongest for languages across Africa and West Asia regions; Fire: Strongest for South Asian languages; Water: Strongest for the Asia-Pacific and Europe regions." Elsewhere: "Earth for Africa, West Asia and Europe, Water for Asia-Pacific, Fire for South Asia". | S4 | Cohere | 2026-03-12 | High | fact (primary) |
| C3 | Training clusters: "The first cluster groups data from European, West Asian and Asia-Pacific languages, the second European, West Asian and African languages, and the third is focused solely on South Asian languages ... one cluster mixing data from all regions." (Mapping cluster->variant is implied: 1=Water, 2=Earth, 3=Fire, mixed=Global; not stated verbatim in the excerpt read.) | S4 | Cohere | 2026-03-12 | Medium (mapping inferred) | fact + inference |
| C4 | All five model cards carry the SAME verbatim language list (67 languages), see below; HF metadata tags are the same 67 codes on all five repos. | S1, S2 | Cohere/HF | 2026-09-30 | High | fact |
| C5 | Regional models are not recommended outside their focus: "We do not recommend using Tiny Aya regional models for languages that were not in focus in their training ... translation quality is significantly lower than for the Tiny Aya Global model." Also "Fire and Water models do not have support for [African] languages." | S4 | Cohere | 2026-03-12 | High | fact |
| C6 | Pashto is not in any list (model cards, HF tags, tech report Table 1); grep of the full report text for "Pashto" returned nothing. No "Dari"; "Persian (Perso-Arabic)" / code `fa` is listed. | S1, S2, S4 | Cohere | 2026 | High (for absence from published lists) | fact |
| C7 | Punjabi is listed as "Punjabi (Gurmukhi)" only; Shahmukhi is not listed. Urdu listed as "Urdu (Urdu)". Chinese listed as "Chinese (Traditional and Simplified Han)". Tagalog listed (HF tag `tl`); WMT24++ evaluation uses `fil_PH`. Slovak listed (`sk`). Greek listed "Greek (Greek)". | S4 Table 1, S2 | Cohere | 2026-03-12 | High | fact |
| C8 | Size 3.35B parameters; context 8K input / 8K output; text-only. | S1, S3 | Cohere | 2026-02-13 | High | fact |
| C9 | Licence: CC-BY-NC 4.0 (HF tag `cc-by-nc-4.0`), "requires also adhering to Cohere Lab's Acceptable Use Policy"; "If you are interested in commercial use, please contact Cohere's Sales team." Card's Terms of Use paragraph contains a copy-paste error referring to "a highly performant 111 billion parameter model". | S1, S2 | Cohere | 2026-02-13 | High | fact |
| C10 | CC BY-NC 4.0: "NonCommercial means not primarily intended for or directed towards commercial advantage or monetary compensation." A free non-profit community app plausibly fits, but this is an interpretation, not legal advice; Cohere AUP not read this run. | S7 | Creative Commons | n/a | Medium | interpretation |
| C11 | Hosted: docs say the instruction-tuned variants (global, earth, fire, water) are "available on the Cohere API via the Chat endpoint". Pricing page does not list Tiny Aya (lists Aya Expanse 8B/32B at $0.50/1M input, $1.50/1M output). Trial keys are free but "not permitted to be used for production or commercial purposes"; production keys are pay-as-you-go. | S3, S5 | Cohere | undated | High (availability) / Unknown (Tiny Aya price) | fact |
| C12 | Also distributed via Hugging Face, Kaggle, Ollama (TechCrunch); model card mentions HuggingChat/HF Space, GGUF for llama.cpp/Ollama/LM Studio, vLLM, SGLang. | S1, S6 | Cohere / TechCrunch | 2026-02-17 | High | fact |
| C13 | On-device: quantized to llama.cpp q4_0, q4_k_m, q8_0; MLX on iPhone 13 ~10 tok/s decode, iPhone 17 Pro 32 tok/s (3.4x). "Without quantization, we quickly run out of memory even on newer generation devices." Q4_K_M = "low memory footprint (2.14 GB), high throughput (32.4 tokens/s) and a minimal degradation of 1.4 points" (mDolly); Q4_0 -2.1; Q8_0 negligible. | S4 | Cohere | 2026-03-12 | High | fact (vendor-measured) |
| C14 | Trained on a single cluster of 64 H100 GPUs. | S6 | TechCrunch | 2026-02-17 | Medium | reported fact |
| C15 | TechCrunch describes Earth as "for African languages" and Water as "for Asia Pacific, West Asia, and Europe" - this conflicts with the model cards/docs (Earth = West Asia + Africa). Prefer primary sources. | S6 vs S1/S3 | - | - | High (that a conflict exists) | discrepancy |
| C16 | Model card limitations: weaker on chain-of-thought reasoning (MGSM); "lowest-resource languages ... may show greater variability"; factual errors more likely in lower-resource languages. | S1 | Cohere | 2026-02-13 | High | fact |

## Verbatim language list (identical on all five HF model cards: global, earth, fire, water, base)
> "Languages covered: The model has been trained on 70+ languages, with a focus on: English, Dutch, French, Italian, Portuguese, Romanian, Spanish, Czech, Polish, Ukrainian, Russian, Greek, German, Danish, Swedish, Norwegian, Catalan, Galician, Welsh, Irish, Basque, Croatian, Latvian, Lithuanian, Slovak, Slovenian, Estonian, Finnish, Hungarian, Serbian, Bulgarian, Arabic, Persian, Urdu, Turkish, Maltese, Hebrew, Hindi, Marathi, Bengali, Gujarati, Punjabi, Tamil, Telugu, Nepali, Tagalog, Malay, Indonesian, Vietnamese, Javanese, Khmer, Thai, Lao, Chinese, Burmese, Japanese, Korean, Amharic, Hausa, Igbo, Malagasy, Shona, Swahili, Wolof, Xhosa, Yoruba, and Zulu"

HF metadata tags (all 5 repos): en, nl, fr, it, pt, ro, es, cs, pl, uk, ru, el, de, da, sv, no, ca, gl, cy, ga, eu, hr, lv, lt, sk, sl, et, fi, hu, sr, bg, ar, fa, ur, tr, mt, he, hi, mr, bn, gu, pa, ta, te, ne, tl, ms, id, vi, jv, km, th, lo, zh, my, ja, ko, am, ha, ig, mg, sn, sw, wo, xh, yo, zu (67).

Tech report Table 1 (regions, scripts) verbatim:
- Europe: English, Dutch, French, Italian, Portuguese, Romanian, Spanish, Czech, Polish, Ukrainian (Cyrillic), Russian (Cyrillic), Greek (Greek), German, Danish, Swedish, Bokmål, Catalan, Galician, Welsh, Irish, Basque, Croatian, Latvian, Lithuanian, Slovak, Slovenian, Estonian, Finnish, Hungarian, Serbian (Cyrillic), Bulgarian (Cyrillic)
- West Asia: Arabic (Arabic), Persian (Perso-Arabic), Turkish, Maltese, Hebrew (Hebrew)
- South Asia: Hindi (Devanagari), Marathi (Devanagari), Bengali (Bengali), Gujarati (Gujarati), Punjabi (Gurmukhi), Tamil (Tamil), Telugu (Telugu), Nepali (Devanagari), Urdu (Urdu)
- Asia Pacific: Tagalog, Malay, Indonesian, Vietnamese, Javanese (Javanese), Khmer (Khmer), Thai (Thai), Lao (Lao), Chinese (Traditional and Simplified Han), Burmese (Mon-Burmese), Japanese (Japanese), Korean (Hangul)
- African: Amharic (Ge'ez), Hausa, Igbo, Malagasy, Shona, Swahili, Wolof, Xhosa, Yoruba, Zulu

Note: the card says "70+" and the report says "70 languages", but only 67 are enumerated. The report also says SFT translation data covers "98 different languages" - unenumerated in what was read, so Pashto/Dari may or may not appear there (unverified).

## Variant x launch-language table
"Listed" = in the shared 67-language list (all variants). "Focus" = the variant's stated regional specialization per S1/S3/S4. Recommended pick in last column.

| Launch language | Listed (all 5) | Global | Earth (W.Asia+Africa, +Europe in training) | Fire (South Asia) | Water (Europe+Asia-Pacific) | Best variant by Flores ChrF (S4 Table 21) |
|---|---|---|---|---|---|---|
| English | Yes | Yes | Yes | Yes | Yes | any (source language) |
| French | Yes | Yes | Yes (Europe) | Yes, not focus | Yes (focus) | Fire/Global 0.66 |
| Urdu | Yes (Urdu script) | Yes | Yes, not focus | Yes (focus) | Yes, not focus | Fire/Water 0.41 |
| Tagalog/Filipino | Yes ("Tagalog"; eval code fil_PH) | Yes | not focus | not focus | Yes (focus) | Fire/Global 0.56 |
| Gujarati | Yes | Yes | not focus | Yes (focus) | not focus | Fire/Global 0.44 |
| Dari | No - via related language (Persian, Perso-Arabic) | via Persian | via Persian (focus: West Asia) | via Persian, not focus | via Persian (West Asian in Water's training cluster per C3) | Persian: Earth/Water 0.49; Dari itself unevaluated |
| Slovak | Yes | Yes | Yes (Europe) | not focus | Yes (focus) | Water 0.54 |
| Bengali | Yes | Yes | not focus | Yes (focus) | not focus | Fire 0.32 (weak; Gemma3-4B 0.42) |
| Tamil | Yes | Yes | not focus | Yes (focus) | not focus | Global 0.37 (weak; TranslateGemma 0.53) |
| Pashto | No | No | No | No | No | not evaluated |
| Hindi | Yes (Devanagari) | Yes | not focus | Yes (focus) | not focus | Earth 0.52 / Fire 0.51 |
| Mandarin (Simplified) | Yes ("Chinese (Traditional and Simplified Han)") | Yes | not focus | not focus | Yes (focus) | Water 0.27 (low for all models on Flores ChrF) |
| Greek | Yes | Yes | Yes (Europe) | not focus | Yes (focus) | Earth 0.50 |
| Spanish | Yes | Yes | Yes (Europe) | not focus | Yes (focus) | 0.53 all |
| Punjabi | Yes - Gurmukhi only; Shahmukhi unclear/not listed | Yes | not focus | Yes (focus) | not focus | Fire/Global 0.42 |

Coverage headline: 13 of 15 explicitly listed; Dari only via Persian; Pashto absent. No single regional variant has all 15 in focus; Global is the only variant intended for balanced coverage (Fire+Water together would split South Asia vs Europe/APAC).

## Translation quality numbers (S4, English -> target, ChrF 0-1 scale, sacrebleu default)
Flores (Table 21): columns Gemma3-4B / Qwen3.5-4B / TA Earth / TA Fire / TA Global / TA Water / TranslateGemma-4B
- ur: 0.29 / 0.32 / 0.38 / 0.41 / 0.39 / 0.41 / 0.40
- pa: 0.16 / 0.27 / 0.40 / 0.42 / 0.42 / 0.38 / 0.01
- gu: 0.44 / 0.27 / 0.43 / 0.44 / 0.44 / 0.42 / 0.47
- ta: 0.47 / 0.28 / 0.26 / 0.30 / 0.37 / 0.31 / 0.53
- bn: 0.42 / 0.34 / 0.21 / 0.32 / 0.31 / 0.19 / 0.46
- tl: 0.58 / 0.41 / 0.50 / 0.56 / 0.56 / 0.55 / 0.57
- fa: 0.49 / 0.47 / 0.49 / 0.48 / 0.48 / 0.49 / 0.48
- hi: 0.51 / 0.43 / 0.52 / 0.51 / 0.50 / 0.49 / 0.51
- sk: 0.46 / 0.46 / 0.53 / 0.53 / 0.53 / 0.54 / 0.51
- el: 0.48 / 0.44 / 0.50 / 0.49 / 0.48 / 0.49 / 0.49
- zh: 0.26 / 0.30 / 0.25 / 0.26 / 0.21 / 0.27 / 0.33
- fr 0.64-0.66, es 0.53 across Tiny Aya variants
- Avg (66 langs): Tiny Aya 0.42-0.43 vs Gemma3-4B 0.38, TranslateGemma 0.43
WMT24++ (Table 22), TA Earth / Fire / Global / Water: ur_PK 0.48/0.48/0.46/0.47; pa_IN 0.46/0.48/0.46/0.42; gu_IN 0.46/0.46/0.45/0.46; ta_IN 0.37/0.40/0.40/0.34; bn_IN 0.29/0.39/0.37/0.25; fil_PH 0.51/0.53/0.56/0.55; fa_IR 0.47/0.48/0.47/0.47; hi_IN 0.35/0.36/0.36/0.35; sk_SK 0.46/0.46/0.45/0.45; zh_CN 0.26/0.29/0.27/0.28; el_GR 0.54 all.
- Regional specialization gain on Flores: "+5.5 ChrF points" South Asia, "+1.7" Africa (vs Global). Report states it wins vs Gemma on "46/55 languages" WMT24++ (context partially read).
- Pashto, Dari: no numbers published (not in eval set).
- Report deliberately avoids win rates ("Rubric-based absolute ratings in lieu of win rates"); no per-language win rates gathered.
- All quality numbers are vendor-reported automatic metrics; no human evaluation of these specific languages was found this run.

## Licence / hosting / hardware notes
- Licence: CC-BY-NC 4.0 + Cohere Labs Acceptable Use Policy (AUP text not retrieved). Commercial use -> contact Cohere Sales. A non-profit, non-monetized community app plausibly falls within "not primarily intended for or directed towards commercial advantage or monetary compensation" (interpretation; confirm with counsel/Cohere, esp. if any grant-funded service fees, sponsorship, or a commercial partner hosts it).
- Hosting: open weights on HF (gated - must log in and accept terms; raw README returned "Access ... is restricted"), Kaggle, Ollama; GGUF quantizations. Cohere API Chat endpoint lists global/earth/fire/water; no published Tiny Aya price; trial keys explicitly barred from production/commercial use, so production hosting via Cohere needs a production (paid) key - price unknown.
- Hardware: 3.35B params; Q4_K_M ~2.14 GB; runs on iPhone 13 (~10 tok/s decode) and iPhone 17 Pro (32 tok/s) via MLX; laptops/CPU via llama.cpp/Ollama (CPU throughput figures not retrieved); vLLM/SGLang for GPU serving. Unquantized BF16 weights ~6.7 GB (arithmetic estimate: 3.35B x 2 bytes; not from source).

## Gaps / unverified
- Pashto and Dari: not listed; the 98-language translation SFT set and the "70+" vs 67 discrepancy were not resolved - possible incidental capability is unverified and unevaluated.
- Punjabi Shahmukhi (Pakistan) script: not listed; quality unknown.
- Dari vs Iranian Persian: only `fa`/`fa_IR` evaluated; Afghan register/vocabulary quality unknown.
- Tiny Aya API price and rate limits not found; Cohere AUP not read.
- Cohere blog post (cohere.com/blog) not retrieved; regional-variant cluster mapping (C3) inferred.
- Weak spots vs competitors: Tamil and Bengali (TranslateGemma-4B / Gemma3-4B score higher), Chinese ChrF low across all.
