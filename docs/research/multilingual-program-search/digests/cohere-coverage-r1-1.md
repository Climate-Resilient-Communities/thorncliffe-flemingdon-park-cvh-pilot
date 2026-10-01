# Digest: Cohere multilingual model coverage, pricing, residency (r1-1)

Accessed: 2026-10-01 (all sources). Budget used: 14 tool calls, 9 sources (8 fetched or searched pages plus 1 search-result set).
Decision served: matching resident questions in 15 languages to an English program catalogue, and which Cohere models can serve it.

Classes: P = primary (Cohere docs, pricing page, blog, model card); S = secondary (press or third-party blog).

## Findings (claims)

| # | Claim | Source URL | Publisher | Pub date | Conf. | Class |
|---|---|---|---|---|---|---|
| F1 | The docs "Supported Languages" page is titled "A list of languages that Cohere's multilingual embedding model provides". It has about 100 rows, including en, fr, ur, tl (Tagalog), gu, fa (Persian), sk, bn, ta, hi, zh (Chinese), el, es, pa (Punjabi). **Pashto (ps) and Dari (prs) are not listed.** The page does not name a script for Punjabi. | https://docs.cohere.com/docs/supported-languages | Cohere | undated | High | P |
| F2 | `embed-multilingual-v3.0`: "Provides multilingual classification and embedding support", 512-token context, links to the supported-languages list. `rerank-multilingual-v3.0`: "Language coverage matches embed-multilingual-v3.0", 4k context. | https://docs.cohere.com/docs/models | Cohere | undated (live 2026-10-01) | High | P |
| F3 | `rerank-v3.5` is described on the current models page as "re-ranking English Language documents and semi-structured data (JSON)". `rerank-v4.0-pro` is "A multilingual model that allows for re-ranking English and non-english documents" (32k context). `rerank-v4.0-fast` is "a light version... multilingual". No per-language list was found for Rerank 4. | https://docs.cohere.com/docs/models | Cohere | undated | High (descriptions); Low (exact coverage) | P |
| F4 | The `embed-v4.0` docs entry gives no language list: "A model that allows for text and images to be classified or turned into embeddings", 128k context, dimensions 256/512/1024/1536. Newer models are `embed-v5.0-pro` and `embed-v5.0-fast` (128k context, up to 2048 dimensions). | https://docs.cohere.com/docs/cohere-embed | Cohere | undated | High | P |
| F5 | Embed 5 was announced 2026-09-30: "supports multimodal inputs and retrieval, 100+ languages, and a 128K-token context window". The blog gives per-language scores for Pro (benchmark name not captured): Farsi 81, Hindi 80, Bengali 83, Chinese 82, Arabic 83, European average 77. The search snippet reported the largest gains over Embed 4 as Farsi +13, Telugu +12, Hindi +12. | https://cohere.com/blog/embed-5 ; https://docs.cohere.com/changelog/embed-v5 | Cohere | 2026-09-30 | High (launch, 100+ claim); Medium (scores, read through a summarizer) | P |
| F6 | Command A (`command-a-03-2025`) "is trained to perform well in 23 languages: English, French, Spanish, Italian, German, Portuguese, Japanese, Korean, Chinese, Arabic, Russian, Polish, Turkish, Vietnamese, Dutch, Czech, Indonesian, Ukrainian, Romanian, Greek, Hindi, Hebrew, Persian." | https://docs.cohere.com/docs/command-a | Cohere | undated (model 03-2025) | High | P |
| F7 | `command-a-translate-08-2025` exists: "state of the art machine translation model... on 23 languages", the same 23 as Command A. Context is 8k in and 8k out. `command-a-reasoning-08-2025` covers the same 23 languages. `command-a-vision-07-2025` "Officially supports English, Portuguese, Italian, French, German, and Spanish". | https://docs.cohere.com/docs/models | Cohere | undated (08-2025 IDs) | High | P |
| F8 | `c4ai-aya-expanse-32b` covers 23 languages and `c4ai-aya-vision-32b` "Serves 23 languages". The docs page did not list them. My unverified belief is that the list is the same as Command A's. | https://docs.cohere.com/docs/models | Cohere | undated | Medium | P |
| F9 | Newer Aya: `tiny-aya-global`, `-earth`, `-fire` and `-water` (3.35B, "Supports 70 languages"; fire is "best for South Asian languages"). The Hugging Face card lists Urdu, Persian, Hindi, Marathi, Bengali, Gujarati, Punjabi, Tamil, Telugu, Nepali, Tagalog, Slovak, Greek, Chinese, Spanish and French. **Pashto is not listed.** Licence is CC-BY-NC, and commercial use needs a sales contact. The arXiv ID 2603.11510 suggests a March 2026 release. | https://huggingface.co/CohereLabs/tiny-aya-global ; https://docs.cohere.com/docs/models | Cohere Labs | ~2026-03 | High (list); Medium (date) | P |
| F10 | Pricing page, as accessed: "API calls made from a Trial API key are free" but trial keys are "rate limited and are not permitted to be used for production or commercial purposes"; production keys are pay-as-you-go. Model Vault dedicated instances: Embed 5 Fast $3/hr ($2,000/mo), Embed 5 Pro $5/hr ($3,250/mo), Rerank 4 Pro $10/hr ($6,500/mo). Legacy: Aya Expanse $0.50 in / $1.50 out per 1M tokens. **The fetched page showed no per-token prices for Command A, Command A Translate or Rerank per search.** | https://cohere.com/pricing | Cohere | live 2026-10-01 | High (what was shown) | P |
| F11 | Embed 5 Pro costs $0.12 per 1M text tokens and $0.40 per 1M image tokens. Embed 5 Fast costs $0.08 per 1M text tokens and $0.40 per 1M image tokens. | https://cohere.com/blog/embed-5 | Cohere | 2026-09-30 | High | P |
| F12 | Rate limits: "Trial keys (and prod keys on newer Chat model variants) are limited to 1,000 API calls a month." Chat on trial is 20 req/min (production 500 req/min, more for some models via sales). Embed text is 2,000 inputs/min on both trial and production. Rerank is 10 req/min on trial and 1,000 req/min on production. | https://docs.cohere.com/docs/rate-limits | Cohere | undated | High | P |
| F13 | Embed 5 deployment options: Cohere API, Model Vault, Microsoft Foundry, Amazon SageMaker, private deployment via vLLM (on-prem or isolated VPC), and North. **No Canada-hosted public API region is stated.** | https://cohere.com/blog/embed-5 | Cohere | 2026-09-30 | High | P |
| F14 | Canadian sovereign options exist through partners: Bell (full-stack, Canadian data centres, July 2025), SAP's Canadian-operated sovereign cloud (Feb 2026), and BCE/Cohere Canada data centre news (Bloomberg, 2026-06-18). These are enterprise or partner offerings, not a self-serve API region. | https://www.newswire.ca/news-releases/bell-canada-and-cohere-forge-strategic-partnership-to-deliver-sovereign-ai-powered-solutions-for-government-and-business-888382855.html ; https://news.sap.com/canada/2026/02/sap-and-cohere-expand-partnership-to-launch-sovereign-ai-solutions-globally-beginning-in-canada/ | Bell / SAP | 2025-07 / 2026-02 | Medium (from search snippets only) | S |
| F15 | A third-party compliance blog warns that "a Toronto-headquartered company can still route inference through Virginia". It says Cohere's documentation describes multi-region processing, but it cites no primary URL. | https://augureai.ca/blog/yes-cohere-is-canadianheres-why-that-matters-for-compliance | Augure AI | 2026-09-19 | Low-Medium | S |

## Coverage table (language × model)

Key: **S** = officially listed; **W?** = not listed, but a related language is listed or the model claims broad coverage, so it may work and needs testing; **N** = not listed, with only a narrow official list.

| Language | embed-multilingual-v3 / rerank-multilingual-v3 (list F1) | embed-v4.0 | Embed 5 (100+) | rerank-v3.5 | Rerank 4 pro/fast | Command A / Translate / Reasoning (23) | Aya Expanse / Aya Vision (23) | Tiny Aya (70) |
|---|---|---|---|---|---|---|---|---|
| English | S | S | S | S | S | S | S | S |
| French | S | W? (no list) | S* | N (described as English) | S* | S | S* | S |
| Spanish | S | W? | S* | N | S* | S | S* | S |
| Mandarin Chinese | S (zh) | W? | S (zh score shown) | N | S* | S | S* | S |
| Greek | S | W? | S* | N | S* | S | S* | S |
| Hindi | S | W? | S (score shown) | N | S* | S | S* | S |
| Slovak | S | W? | S* | N | S* | N | N* | S |
| Urdu | S | W? | S* | N | S* | N | N* | S |
| Bengali | S | W? | S (score shown) | N | S* | N | N* | S |
| Tamil | S | W? | S* | N | S* | N | N* | S |
| Gujarati | S | W? | S* | N | S* | N | N* | S |
| Punjabi | S (pa; script not stated) | W? | S* | N | S* | N | N* | S (script not stated) |
| Tagalog | S (tl) | W? | S* | N | S* | N | N* | S |
| Dari | W? (via fa Persian) | W? | W? (Farsi score shown) | N | W? | W? (via Persian) | W? (via Persian)* | W? (via Persian) |
| Pashto | **N** (not in list) | W? | W? | N | W? | N | N | **N** (not in list) |

\* Inferred, not verified: no per-language list for Embed 5, Rerank 4 or Aya Expanse/Vision was retrieved this run. Treat as "100+ languages claimed" or "23 languages, assumed to be the same as Command A".

**Dari:** no Cohere source names Dari. Every list uses Persian/Farsi (fa). Dari is written in Perso-Arabic script and its standard written form is close to Iranian Persian, so Persian support is a reasonable proxy for written queries. This is unverified and needs testing with Afghan-specific vocabulary.
**Punjabi:** no source names a script (Gurmukhi or Shahmukhi). Test both. Shahmukhi shares script with Urdu, so its behaviour may differ.
**Pashto:** the weakest language here. It is absent from every explicit list that was retrieved.

## Answer to Q3 (low-resource evaluations)
- The only per-language numbers retrieved are from the Embed 5 blog (F5): Farsi, Hindi, Bengali, Arabic and East Asian languages. **None were found for Pashto, Gujarati, Punjabi, Tagalog, Tamil or Urdu.**
- The search did not reach MIRACL, MTEB multilingual or Belebele results for Cohere embed or rerank. That gap remains open.

## Leads worth chasing
1. https://docs.cohere.com/changelog/embed-v5 and the full Embed 5 blog: the benchmark name, the full per-language table, and whether a language list is published.
2. A Rerank 4 changelog or blog: the official language list and per-search or per-token pricing.
3. Pricing page tabs, which may need JS or a different render: Command A, Command A Translate and Rerank 4 per-unit prices. Also check the Microsoft Foundry and AWS Bedrock/SageMaker Cohere listings for ca-central-1 or Canada Central availability and prices.
4. The Cohere trust center, privacy policy or DPA for the SaaS API processing location and sub-processors.
5. The MTEB leaderboard (multilingual / MMTEB) for Cohere embed-v4 / v5 per-language scores (Pashto, Gujarati, Punjabi, Tamil, Urdu, Tagalog).
6. The Hugging Face cards for CohereLabs/aya-expanse-32b and aya-vision-32b, to quote the 23-language list directly.
7. Licensing: Aya and Tiny Aya are CC-BY-NC. A community app may still count as commercial or production use, so check before using them via the API or self-hosted.

## Looked for, not found
- An official per-language list for embed-v4.0, Embed 5 or Rerank 4.
- Any official mention of Dari, Pashto, or the Punjabi script.
- Per-token prices for Command A or Command A Translate, and Rerank per-search prices, on the pricing page as fetched.
- A Cohere self-serve API region in Canada, or a primary Cohere statement of the default processing location.
- MIRACL, MTEB or Belebele scores for Cohere models on the target low-resource languages.
