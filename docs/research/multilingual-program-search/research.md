---
title: 'technical research: multilingual natural-language program search'
type: 'technical'
topic: 'multilingual natural-language program search'
decision: 'How the CVH pilot matches a resident question in any of 15 languages to the right program/provider in a ~100-provider English catalogue'
source: 'native run'
status: complete
preset: 'standard'
validation: 'normal'
created: '2026-10-01'
updated: '2026-10-01'
claims_verified: 8
claims_unverified: 1
claims_overturned: 1
---

# Technical research: multilingual natural-language program search

**Decision this research serves:** How the CVH pilot matches a resident's natural-language question, typed in any of 15 launch languages (English, French, Urdu, Tagalog, Gujarati, Dari, Slovak, Bengali, Tamil, Pashto, Hindi, Mandarin, Greek, Spanish, Punjabi), to the right program or provider in a small English catalogue (about 100 providers), within a CAD 1,000 pilot budget on Vercel and Supabase.

## Executive summary

**Do not use Elasticsearch, and do not generate answers with an LLM in the pilot.** Use a **multilingual retrieval search that returns real catalogue listings**:

1. Embed each provider's English description once with a multilingual embedding model, and ship the vectors **in a JSON file loaded into memory** alongside the pre-translated listings. No vector database and no search engine are needed at about 100 providers (§3a).
2. For each question, embed the resident's own words and compare them in memory. For Pashto, Dari and romanized input, which the embedding model does not list, also translate the question to English and merge the two rankings.
3. Show the top three to five listings exactly as they are in the catalogue, already translated into every language ahead of time, so **nothing is translated back** at question time and no paragraph is generated. If nothing scores above a threshold, show the category list and the Hub's phone number.

Three findings drive this:

- **Keyword search fails across languages.** Questions in 25 languages searched against English documents found the right answer in the top 100 results only 39.9% of the time with keyword search (BM25), against 69.5–75.1% with multilingual embeddings. Keyword search fell below 30% for several non-Latin scripts [2]. Elasticsearch has no language analyzer for Urdu, Pashto, Tagalog, Gujarati, Punjabi, Tamil or Slovak [1].
- **Cohere cannot translate 8 of the 15 languages.** Command A and Command A Translate officially support 23 languages, which leaves out Urdu, Tagalog, Gujarati, Slovak, Bengali, Tamil, Pashto and Punjabi [10][11]. Cohere's multilingual embedding list covers 13 of the 15 but not Pashto, and names Dari only as Persian [9]. Azure Translator and Amazon Translate both cover all 14 target languages, with Dari listed separately from Persian [18][19].
- **Generated answers are the main safety risk, not a cost question.** New York City's MyCity chatbot gave answers that contradicted city law [23][24]. Government of Canada guidance says to answer only from information you control, link to the authoritative source, and offer a non-automated alternative [25]. At pilot scale, generation would cost only about $1–33 a month [26], so cost is not the deciding factor.

**Biggest caveat:** no retrieval benchmark exists for Pashto, Dari, Tagalog, Gujarati or Punjabi, or for romanized Urdu. The pilot must measure them with its own test set (Recommendation R5).

## 1. Landscape: what each approach is good at

| Approach | What it does | Evidence |
|---|---|---|
| (a) Keyword search: Elasticsearch, OpenSearch, Postgres full-text | Matches words, with stemming per language | Cannot connect a Pashto question to an English description, since no words are shared. Found the right answer 39.9% of the time across languages, against about 70–75% for embeddings [2]. No Elasticsearch analyzer exists for 7 of the 15 languages [1]. |
| (b) Multilingual embeddings | Turns the question and descriptions into vectors in a space shared across languages, then compares meaning | Best measured approach: BGE-M3 75.1, multilingual-e5-large 70.9 and OpenAI text-embedding-3-large 69.5 recall@100, holding about 68–76 on scripts where keyword search collapses [2]. The field has moved from translation pipelines to embeddings [5]. |
| (c) Hybrid keyword and embeddings, with a reranker | Merges a keyword ranking with an embedding ranking | Only a marginal gain across languages: 75.1 → 75.5 [2]. Supabase publishes a ready recipe (reciprocal rank fusion), English only [8]. No evidence found that a multilingual reranker helps these languages. |
| (d) RAG: retrieve, then an LLM writes an answer | A model writes a reply in the resident's language from the retrieved listings | Adds the risk of invented content (see §3) and needs a generation model that supports the language. Cohere's does not for 8 of the 15 [11]. |
| (e) Translate the question to English, then search | Machine-translates the question, then searches the English descriptions | Mixed evidence when used alone: it helps some models and slightly hurts others [6]. Combining the original question's embedding with its translation's beat either alone in 88 of 105 comparisons [4] (medium confidence: abstract only). |

**Romanized and mixed-language questions** ("mujhe khana chahiye", Hinglish) are the known weak spot of embeddings: retrieval drops by up to 27% on code-switched questions [3]. Translating mixed-language questions to English was found effective [29] (low–medium confidence), and Roman Urdu transliteration is technically mature [30] (low–medium confidence). This is the strongest reason to add the translation leg (e) to the embedding search (b).

**Size of the catalogue.** pgvector compares every row exactly by default, so it never misses a match, and needs an index only for speed [7]. With about 100 providers, exact search in Supabase, or even in memory in a Vercel function, is enough. A search cluster such as Elasticsearch adds operating cost for no measured benefit (an inference from [1][7]; no small-catalogue production account was found).

## 2. Language coverage: Cohere and alternatives

| Language | Cohere embed-multilingual-v3 [9] | Cohere Embed 5 [12] | Cohere Command A / Translate [11] | Azure Translator [18] | Amazon Translate [19] | Google Translation [20] |
|---|---|---|---|---|---|---|
| English, French, Spanish, Chinese, Greek, Hindi | Yes | Yes (claimed) | Yes | Yes | Yes | Yes |
| Urdu, Tagalog, Gujarati, Slovak, Bengali, Tamil | Yes | "100+ languages", none named | **No** | Yes | Yes | Yes |
| Punjabi | Yes (script not stated) | Not named | **No** | Yes (Gurmukhi) | Yes | Yes (Gurmukhi and Shahmukhi) |
| Dari | Only as Persian | Not named (Farsi scored) | Only as Persian | **Yes, separate (`prs`)** | **Yes, separate (`fa-AF`)** | Only as Persian |
| Pashto | **No** | Not named | **No** | Yes | Yes | Yes (standard model only) |

Notes:

- **Embed 5** (launched 2026-09-30) claims more than 100 languages, but its documentation gives no per-language list [12]. Coverage of Pashto and Dari is unverified.
- **Tiny Aya** (February–March 2026; five open-weight 3.35B models: Base, Global, Earth, Fire, Water) [13][32][33]:
  - **Language list.** All five model cards list the same 67 languages. Of the 15 launch languages, 13 are listed: English, French, Spanish, Greek, Slovak, Hindi, Urdu, Bengali, Gujarati, Tamil, Punjabi (Gurmukhi only), Tagalog, and Chinese (Simplified and Traditional) [32].
  - **Not covered.** Pashto is not listed or evaluated. Dari appears only as Persian [32][33].
  - **Slovak resolved.** Slovak *is* listed (`sk`, Flores chrF about 0.53) [32][33]. The earlier summary saying it was omitted [31] is overturned on this point.
  - **Variants.** They differ in regional focus, not language list: Fire for South Asian languages (Urdu, Hindi, Bengali, Gujarati, Tamil, Punjabi); Water for European and Asia-Pacific languages (Tagalog, Chinese, Slovak, Greek, French, Spanish); Earth for West Asian and African languages (including Persian); Global for balanced coverage [32]. The technical report advises against using a regional variant outside its focus [33].
  - **Quality (vendor-reported, English → target, Flores chrF on a 0–1 scale)** [33]:

    | Language | Variant | chrF |
    |---|---|---|
    | Tagalog | Global | 0.56 |
    | Slovak | — | about 0.53 |
    | Gujarati | Fire | 0.44 |
    | Punjabi | Fire | 0.42 |
    | Urdu | Fire | 0.41 |
    | Tamil | Global | 0.37 |
    | Bengali | Fire | 0.32 |
    | Chinese | all variants | 0.21–0.27 |

    Tamil and Bengali trail Google's TranslateGemma-4B (0.53 and 0.46) [33].
  - **Hosting and licence.** Available on the Cohere API Chat endpoint with no published price, and as open weights. The 4-bit build is 2.1 GB and decodes about 10 tokens a second on an iPhone 13 [32][33]. Licensed CC-BY-NC 4.0; commercial use requires Cohere Sales [32]. A free non-profit app plausibly qualifies as non-commercial, but that needs legal confirmation.
  - **Verdict.** Tiny Aya cannot cover Pashto or Dari, so it cannot replace a full-coverage translator. It is a candidate for MVP offline or on-device translation of the 13 listed languages, not a pilot component.
- **Rerank:** rerank-v3.5 is now described as English-only, and Rerank 4 as "multilingual" with no list [10].
- **Google Translation:** marked medium confidence, because the table was read through a summarizer [20].
- **DeepL:** coverage could not be verified.

**Implication.** Cohere works for search embeddings in 13 of the 15 languages, and the translation leg covers the gaps (Pashto, Dari). Cohere cannot be the translation engine for the pilot as decided earlier (PRD D-4). Azure Translator is the strongest single option: it covers every launch language including Dari, has a free tier of 2 million characters a month [22], and offers Canadian regions in its pricing selector [22]. Whether translation is actually processed in Canada is unverified. Cohere itself has no self-serve Canadian API region; Canadian hosting comes through partners such as Bell and SAP [16], and a third-party compliance blog warns that inference may be routed through the US [17].

## 2a. Hands-on test: Pashto and Dari (product owner, 2026-10-01)

The product owner sent the same hospital sentence to four models and compared the output [34]:

| Model | Pashto | Dari |
|---|---|---|
| north-small-translate-09-2026 | **Good**; one slightly awkward phrase for "nearest" | **Good** |
| Command A+ | Poor (a non-word, wrong word for "where") | Good |
| Command A Translate | **Failed: returned Dari when asked for Pashto** | Good |
| Aya Expanse 32B | Poor, garbled | Understandable, word order off |

What this changes:
- **North Small Translate is the pilot choice for Pashto and Dari.** It is the only model tested that produced real Pashto, although Pashto is not in its listed 50 languages [34].
- **Undocumented support is a risk.** A language a vendor does not list can regress without notice. The pilot test set (R5) must include translation checks for Pashto and Dari, reviewed by native speakers, re-run when the model version changes.
- **Wrong-language output is a real failure mode.** Command A Translate silently returned Dari for Pashto [34]. Every translation should be checked automatically for the expected language before it is published or sent, with Azure Translator as the fallback when the check fails.
- **Evidence strength: low.** One sentence, one reviewer, screenshots not inspected by this run. It justifies the routing choice for the pilot, not a final vendor decision.

## 3. Generated answers: safety, cost and platform fit

**Safety.**
- New York City's MyCity chatbot told users they could take workers' tips and refuse tenants with housing vouchers, both contrary to city law. The city's response was to add "beta" disclaimers [23][24].
- Studies from 2025–26 report higher hallucination rates in lower-resource languages, but they tested models answering without retrieved documents and were read only through summaries (unverified for grounded RAG).
- The Government of Canada's generative AI guide says to ground output "only [in] the information you provide and control", link to authoritative sources, disclose AI use, offer a non-automated alternative, and check quality in each official language [25].
- No guidance from 211 or Inform USA was found, and no measured effectiveness of mitigations such as citations or refusal.

**Cost** at about 2,000 questions a month:

| Approach | Cost per month | Source |
|---|---|---|
| Retrieval only | About $0–5 | Embedding at $0.08–0.20 per million tokens [12][26] |
| RAG with Gemini 2.5 Flash-Lite | About $1 | Official pricing [26] |
| RAG with Gemini 2.5 Flash | About $3–6 | Official pricing [26] |
| RAG with Cohere Command A | About $21–33 | Aggregator price only, unverified |

Translating about 100 descriptions into 14 languages is about 0.7 million characters, a one-off that fits inside the 2 million character free tiers of Azure and Amazon [21][22]. Questions add about 0.1 million characters a month.

**Platform fit.**
- Vercel functions run up to 300 seconds on Hobby and 800 seconds on Pro. Time spent waiting on a model call is not billed as CPU [27].
- Supabase's free plan pauses a project after 7 days without activity [28] (secondary source). The pilot needs Supabase Pro or a scheduled keep-alive.
- Cohere trial keys may not be used in production and are limited to 1,000 calls a month [14][15], so the pilot needs a paid key. At pilot volumes, the paid cost is cents.

## 3a. Latency: the pipeline and where the data lives

**The pipeline in the question:** translate the question → search Elasticsearch → translate the results back. That is three network calls in series, and two of them are avoidable.

| Step | Translate → Elasticsearch → translate back | Recommended |
|---|---|---|
| Understand the question | Translation call | One embedding call, in the resident's own language |
| Search | Network call to a search cluster | In-memory comparison against about 100 vectors: well under a millisecond (unverified: own arithmetic, about 100 × 1,024 multiplications) |
| Results in the resident's language | Translation call per result | Already translated and stored in the same JSON file: no call |
| Network calls in series | 3 | **1** (2 for Pashto, Dari and romanized input) |

**A JSON file, not a vector store.** About 100 providers × one 1,024-dimension vector is about 100,000 numbers: roughly 0.4 MB as plain floats and less with shorter vectors. The 15 translated versions of every listing add about 0.7 million characters [21][22]. The file loads once when the function starts and stays in memory. pgvector would give the same exact answer [7] but adds a database round trip to every question. Supabase remains the place where the Hub edits providers; publishing a change regenerates the JSON (embeddings plus translations) and redeploys it, so every listing still carries its "Last confirmed" date.

**When the second call is needed.** Cohere's embedding list covers 13 of the 15 languages [9]. For those, one embedding call is enough. A question detected as Pashto or Dari, or as romanized Urdu or Hindi, also goes through translation to English (both calls start in parallel, and the translated text is then embedded), and the two rankings are merged [4].

**Not measured.** No latency figures for Cohere embedding or Azure translation calls were retrieved this run. The R5 test set should log time per question. For speed the resident can see right away, the app also shows category buttons, which need no network call at all.

**Elasticsearch adds a hop and an operating cost**, and it brings no benefit: keyword matching is the weakest approach across languages [1][2].

## 4. Cross-dimension insights

- **Coverage decides the architecture, not search quality.** Every embedding model scores well on average, but the two languages most at risk in Thorncliffe Park (Pashto and Dari) are the ones vendors don't list. Translating the question to English is the only route that is verified to cover them, so the translation leg is required, not an optimization.
- **One translation service serves three jobs.** The same Azure (or Amazon) translation service translates alerts, translates the catalogue for display, and translates questions for search. Using it for all three removes the Cohere coverage gap in one place.
- **Returning listings fits the PRD's principles.** P6 (accurate and validated) and the "Last confirmed by the Hub" rule in D2 work only if residents see catalogue text, not model text. Generated answers would bypass that marker.

## 5. Decision matrix

Scores run from 1 (poor) to 5 (best). Weights come from the agreed requirements frame and can be re-weighted.

| Criterion (weight) | (a) Keyword | (b) Embeddings | (b+e) Embeddings + translated question, merged | (c) Hybrid + rerank | (d) RAG | (e) Translate, then keyword/embed |
|---|---|---|---|---|---|---|
| Accuracy across languages, incl. low-resource (30%) | 1 | 4 | 5 | 4 | 4 | 3 |
| Safety and grounding (25%) | 5 | 5 | 5 | 5 | 2 | 5 |
| Cost (15%) | 5 | 5 | 5 | 4 | 3 | 4 |
| Build effort, small team (15%) | 4 | 4 | 3 | 3 | 2 | 3 |
| Latency (10%) | 5 | 4 | 3 | 3 | 2 | 3 |
| Path to MVP and Canada (5%) | 2 | 4 | 4 | 4 | 3 | 3 |
| **Weighted total** | 3.50 | 4.40 | **4.40** | 4.00 | 2.80 | 3.65 |
| **Hard gate: all 15 languages** | Fails | **Fails (Pashto unlisted)** | **Passes** | Fails (Pashto) | Fails with Cohere | Passes |

**Pick: (b+e).** Multilingual embeddings over the English catalogue, plus an English translation of each question, with the two ranked lists merged, returning catalogue listings only. It ties (b) on the weighted score and is the only high scorer that passes the hard gate for all 15 languages.

**Runner-up: (b) alone.** It wins instead if the pilot's test set shows the translation leg adds nothing (R5) and Embed 5 is confirmed to cover Pashto and Dari.

**Strongest argument against the pick:** the translation step adds a second vendor and about one extra network call per question, and machine translation of very short or romanized questions may itself be poor (unmeasured).

**Cheapest way to reverse it:** keep the translation leg behind a switch, and log both rankings during the pilot to compare.

## 6. Recommendations

| # | Recommendation | Feeds | Confidence basis |
|---|---|---|---|
| R1 | Natural-language search in the pilot is **retrieval only**: it returns three to five catalogue listings with their "Last confirmed" date, never a generated answer. A plain-language "ask a question" box replaces the MVP chatbot (D10) for the pilot. | PRD D2; architecture | High: [2][23][24][25] |
| R2 | Use a **Cohere multilingual embedding model** (embed-multilingual-v3 for its published language list, or Embed 5 once its list is confirmed) over English provider descriptions, shipped as a **JSON file searched in memory**. Supabase stays the editing source; publishing regenerates the file. No Elasticsearch, OpenSearch or vector database. | Architecture; addendum | High for approach [2][7]; medium for model choice [9][12]; latency unmeasured |
| R3 | **Translate the question to English only when needed**: Pashto, Dari, or romanized or mixed-language input. Search with both the original and the translation and merge the rankings. Never translate results back at question time; listings are pre-translated. | Architecture | Medium: [3][4][29]; required for Pashto by [9] |
| R4 | **Change PRD D-4.** Research recommended a full-coverage translator (Azure or Amazon) [18][19]. **Overridden by the product owner on 2026-10-01: Cohere models only.** Route by language: Pashto and Dari through north-small-translate-09-2026 [34]; English, French, Spanish, Chinese, Greek and Hindi through Command A Translate [11]; Urdu, Tagalog, Gujarati, Slovak, Bengali, Tamil and Punjabi through North Small Translate if it lists them, otherwise Tiny Aya Fire or Water [32][33]. Check every output's language automatically and fall back along the route. | PRD D-4, A3, N1; addendum | High for Command A coverage [11]; medium for Tiny Aya [32][33]; low for North Small Translate (one sentence, language list unverified) [34] |
| R5 | Build a **test set** with ambassadors: about 10 real questions per language (150 in total), including romanized Urdu and Hinglish, each with the expected provider. Measure whether the right provider is in the top 3 for (b) alone vs (b+e) before launch and monthly. | PRD Section 9; pilot plan | Fills the evidence gap (§7) |
| R6 | Below a similarity threshold, show "We couldn't find a clear match" with category browsing and the Hub's number. 911 is always shown on emergency-category results. | PRD D2, D7 | Medium: [25] |
| R7 | Run Supabase on **Pro, or with a keep-alive**, so the database never pauses during the pilot. | Architecture | Medium: [28] (secondary source) |

## 7. Open questions

- **Embed 5's per-language list.** Does it officially cover Pashto, Dari, Urdu, Tagalog, Gujarati and Punjabi? *To answer:* ask Cohere or wait for the docs page.
- **Retrieval quality in Pashto, Dari, Tagalog, Gujarati and Punjabi, and for romanized Urdu.** No published benchmark exists. *To answer:* the R5 test set.
- **Translation of romanized input.** Does Azure's language detection handle romanized Urdu and Hindi correctly? *To answer:* the R5 test set, or a transliteration step if not.
- **Azure Translator paid price, and Canadian processing.** The price page did not render, and Canadian processing for Translator, Amazon and Google is not verified. *To answer:* Azure regional endpoint docs; matters for the MVP, not the pilot.
- **Cohere per-token prices** for Command A and Rerank: not shown on the official page.
- **Whether a multilingual reranker helps.** Not evidenced. *To answer:* add Rerank 4 to the R5 comparison if accuracy is short.

## Source appendix

| # | Supports | Publisher | Pub date | Accessed | Confidence |
|---|---|---|---|---|---|
| [1] | Elasticsearch analyzers lack Urdu, Pashto, Tagalog, Gujarati, Punjabi, Tamil, Slovak | [Elastic](https://www.elastic.co/docs/reference/text-analysis/analysis-lang-analyzer) | current docs | 2026-10-01 | High |
| [2] | MKQA cross-lingual recall: BM25 39.9 vs embeddings 69.5–75.1; hybrid +0.4 | [arXiv 2402.03216 (BAAI)](https://arxiv.org/html/2402.03216v4) | 2024-02, rev. 2025-12 | 2026-10-01 | High |
| [3] | Code-switched questions reduce retrieval by up to 27% | [arXiv 2604.17632](https://arxiv.org/abs/2604.17632) | 2026-04 | 2026-10-01 | Medium |
| [4] | Combining original and translated question embeddings wins 88/105 | [arXiv 2606.13537 / ACL 2026](https://arxiv.org/abs/2606.13537v1) | 2026-06 | 2026-10-01 | Medium |
| [5] | Field has shifted from translation pipelines to embeddings | [arXiv 2510.00908](https://arxiv.org/abs/2510.00908) | 2025-10 | 2026-10-01 | Medium |
| [6] | Translate-then-retrieve: mixed results by model type | [arXiv 2502.08638](https://arxiv.org/html/2502.08638v3) | 2025 | 2026-10-01 | Low |
| [7] | pgvector exact search by default, perfect recall | [pgvector](https://github.com/pgvector/pgvector) | current | 2026-10-01 | High |
| [8] | Supabase hybrid search recipe, English only | [Supabase](https://supabase.com/docs/guides/ai/hybrid-search) | current | 2026-10-01 | High |
| [9] | Cohere multilingual embedding language list: no Pashto, no Dari | [Cohere](https://docs.cohere.com/docs/supported-languages) | current | 2026-10-01 | High |
| [10] | Cohere model catalogue: rerank-v3.5 English, Rerank 4 multilingual, Command A Translate exists | [Cohere](https://docs.cohere.com/docs/models) | current | 2026-10-01 | High |
| [11] | Command A's 23 languages | [Cohere](https://docs.cohere.com/docs/command-a) | 2025-03 model | 2026-10-01 | High |
| [12] | Embed 5: 100+ languages, $0.08–0.12 per million tokens | [Cohere](https://cohere.com/blog/embed-5) | 2026-09-30 | 2026-10-01 | High |
| [13] | Tiny Aya: 70 languages, no Pashto, non-commercial | [Cohere Labs](https://huggingface.co/CohereLabs/tiny-aya-global) | ~2026-03 | 2026-10-01 | High |
| [14] | Trial keys not for production | [Cohere](https://cohere.com/pricing) | live | 2026-10-01 | High |
| [15] | Rate limits: trial 1,000 calls/month | [Cohere](https://docs.cohere.com/docs/rate-limits) | current | 2026-10-01 | High |
| [16] | Canadian hosting via partners (Bell, SAP) | [Bell / Newswire](https://www.newswire.ca/news-releases/bell-canada-and-cohere-forge-strategic-partnership-to-deliver-sovereign-ai-powered-solutions-for-government-and-business-888382855.html) | 2025-07 | 2026-10-01 | Medium |
| [17] | Inference may be routed outside Canada | [Augure AI](https://augureai.ca/blog/yes-cohere-is-canadianheres-why-that-matters-for-compliance) | 2026-09-19 | 2026-10-01 | Low |
| [18] | Azure Translator covers all 14 targets incl. Dari `prs` | [Microsoft](https://learn.microsoft.com/en-us/azure/ai-services/translator/language-support) | 2026-08-23 | 2026-10-01 | High |
| [19] | Amazon Translate covers all 14 targets incl. Dari `fa-AF` | [AWS](https://docs.aws.amazon.com/translate/latest/dg/what-is-languages.html) | current | 2026-10-01 | High |
| [20] | Google Translation: no separate Dari; Pashto standard model only | [Google](https://docs.cloud.google.com/translate/docs/languages) | 2026-09-24 | 2026-10-01 | Medium |
| [21] | Amazon Translate $15 per million characters; 2M free for 12 months | [AWS](https://aws.amazon.com/translate/pricing/) | current | 2026-10-01 | High |
| [22] | Azure Translator free tier 2M characters/month; Canada regions selectable | [Microsoft](https://azure.microsoft.com/en-us/pricing/details/cognitive-services/translator/) | current | 2026-10-01 | Medium |
| [23] | NYC MyCity chatbot gave unlawful advice | [OECD.AI](https://oecd.ai/en/incidents/2024-03-29-3dce) | 2024-03-29 | 2026-10-01 | High |
| [24] | NYC MyCity wrong answers; beta disclaimers | [StateScoop](https://statescoop.com/nyc-mayor-eric-adams-chatbot-wrong-answers/) | 2024 | 2026-10-01 | High |
| [25] | Government of Canada generative AI guidance | [Government of Canada](https://www.canada.ca/en/government/system/digital-government/digital-government-innovations/responsible-use-ai/guide-use-generative-ai.html) | 2026-09-24 | 2026-10-01 | High |
| [26] | Gemini pricing (Flash, Flash-Lite, Embedding) | [Google](https://ai.google.dev/gemini-api/docs/pricing) | 2026-10-01 | 2026-10-01 | High |
| [27] | Vercel function duration limits | [Vercel](https://vercel.com/docs/functions/limitations) | 2026-08-24 | 2026-10-01 | High |
| [28] | Supabase free plan pauses after 7 days inactive | [Costbench](https://costbench.com/software/database-as-service/supabase/free-plan/) | 2026 | 2026-10-01 | Medium |
| [29] | Translating code-mixed questions to English is effective | [arXiv 2602.11181](https://arxiv.org/pdf/2602.11181) | 2026-02 | 2026-10-01 | Low |
| [30] | Roman Urdu ↔ Urdu transliteration is mature | [ACL Anthology, LoResMT 2025](https://aclanthology.org/2025.loresmt-1.13/) | 2025 | 2026-10-01 | Low |
| [31] | Tiny Aya omits Pashto; Fire variant for South Asian languages; Slovak omission overturned by [32][33] (user-supplied summary citing Cohere and TechCrunch) | [TechCrunch](https://techcrunch.com/2026/02/17/cohere-launches-a-family-of-open-multilingual-models/) | 2026-02-17 | 2026-10-01 | Medium (Slovak: overturned) |
| [32] | Tiny Aya variants, 67-language list (incl. Slovak, Punjabi Gurmukhi; no Pashto, no Dari), CC-BY-NC, quantized sizes | [Cohere Labs model cards](https://huggingface.co/CohereLabs/tiny-aya-global) | 2026-02/03 | 2026-10-01 | High |
| [33] | Tiny Aya technical report: per-language Flores/WMT chrF; regional variants vs Global | [arXiv 2603.11510](https://arxiv.org/abs/2603.11510) | 2026-03-12 | 2026-10-01 | High (vendor-reported numbers) |
| [34] | Hands-on test of four models on one hospital sentence in Pashto and Dari | [Product owner test, imports/user-test-pashto-dari-2026-10-01.md](imports/user-test-pashto-dari-2026-10-01.md) | 2026-10-01 | 2026-10-01 | Low (n = 1 sentence) |

## Staleness map

Re-check dates by claim class (versions and pricing ≤ 1 month; AI landscape ≤ 3 months; patterns ≤ 2 years):

| Claim | Class | Re-check by |
|---|---|---|
| Cohere model language lists, Embed 5 coverage [9][10][11][12] | version | 2026-11-01 |
| Translator language coverage [18][19][20] | version | 2026-11-01 |
| Cohere, Azure, Amazon, Gemini prices [12][21][22][26] | pricing | 2026-11-01 |
| Embeddings vs keyword across languages [2][5] | landscape (AI) | 2027-01-01 |
| Hybrid and translation-merging patterns [4][8] | pattern | 2028-06-01 |

Earliest re-check: **2026-11-01**, before the pilot's second month.
