# Digest: RAG safety, mitigations, guidance, cost, platform fit (r1-1)

Decision served: retrieval-only (ranked listings) vs RAG (LLM answer in user's language) for a ~100-entry English program catalogue, 15 user languages, some emergency-adjacent queries.
Accessed: 2026-10-01. Tool budget: 15 calls (13 web, all used). Classes: F = fact from primary source; S = secondary/aggregator report; I = inference/computation by researcher; U = unverified belief.

## Claims

### Q1 Hallucination / safety incidents and rates
1. **Claim:** NYC's official MyCity chatbot (Microsoft-powered, LLM) told users things contrary to NYC law: that employers could take a cut of workers' tips, that landlords could refuse tenants with housing vouchers, that stores could go cashless (banned 2020), and stated an outdated minimum wage. First documented by The Markup / THE CITY (Colin Lecher), 2024-03-29; city responded by adding "beta" / "may provide inaccurate or incomplete" disclaimers rather than taking it down.
   - Source: https://oecd.ai/en/incidents/2024-03-29-3dce (OECD.AI Incidents Monitor, 2024-03-29); corroborated https://statescoop.com/nyc-mayor-eric-adams-chatbot-wrong-answers/ (StateScoop, 2024). Accessed 2026-10-01. Confidence: high (two independent reporters via search snippets; original Markup article not fetched). Class: F/S.
2. **Claim:** The MyCity chatbot was later shut down under Mayor Mamdani.
   - Source: https://futurism.com/artificial-intelligence/ai-chatbot-mamdani (Futurism, date not captured, ~2026). Confidence: medium (single source, headline/snippet only). Class: S.
3. **Claim:** Hallucination rates in LLM conversation are consistently higher in lower-resource languages; for Tamil, hallucination-free response rates were ~1% (Gemma) and ~2% (Llama-3.1) in the CCL-XCoT study; knowledge learned in high-resource languages does not transfer naturally to low-resource ones.
   - Source: https://arxiv.org/pdf/2507.14239 (arXiv, CCL-XCoT, 2025-07) and https://arxiv.org/pdf/2507.22720 (arXiv, "Investigating Hallucination in Conversations for Low Resource Languages", 2025-07); multilingual benchmark https://aclanthology.org/2026.resourceful-4.17/ (ACL Anthology, 2026) reports higher rates for lower-resource languages (e.g. Icelandic). Confidence: medium (read via search summary; not fetched in full; setting is open-domain/closed-book, not grounded RAG over a small catalogue). Class: F (paper) / S (summary).
4. **Claim:** Literature notes RAG improves factuality but gains are harder to achieve for low-resource languages, where both the generator and the retriever are weaker.
   - Source: https://arxiv.org/pdf/2405.10936 (arXiv survey on multilingual LLMs, 2024-05) via search snippet. Confidence: medium. Class: S.
5. **Implication (inference):** Generating an answer in, e.g., Tamil/Dari/Tigrinya from English listings adds two failure points (generation + translation) that retrieval-only avoids; emergency-adjacent wrong answers are the highest-severity case. Class: I.

### Q2 Mitigations
6. **Claim:** Government of Canada guidance tells institutions deploying public-facing GenAI to "use grounding and prompt engineering so the models build responses from only the information you provide and control", to "include links to authoritative sources", and to test before deployment and monitor on an ongoing basis.
   - Source: https://www.canada.ca/en/government/system/digital-government/digital-government-innovations/responsible-use-ai/guide-use-generative-ai.html (Government of Canada / TBS, page date 2026-09-24). Confidence: high. Class: F.
7. **Not found:** quantitative evidence this run on the effectiveness of citation modes (e.g. Cohere documents/citations), answer-only-from-context prompts, or refusal-on-no-match in reducing hallucination, especially multilingually. Class: gap. (Unverified belief: grounding + citations reduce but do not eliminate unsupported statements.)

### Q3 Public-sector / I&R guidance
8. **Claim:** Canadian federal guidance for public-facing GenAI: notify users they are interacting with GenAI; publish a plain-language description of the system and quality steps; offer alternative non-automated means of communication; test that output quality meets official-languages requirements (recognising performance may differ between languages).
   - Source: same as #6 (Government of Canada, 2026-09-24). Confidence: high. Class: F.
9. **Claim:** Multiple US states (e.g. CA, WA, UT, NH, ME, NE) had enacted chatbot laws by April 2026; nearly all require conspicuous AI disclosure at session start.
   - Source: https://www.orrick.com/en/Insights/2026/04/2026-State-Chatbot-Laws-Key-Provisions-and-Regulatory-Trends (Orrick, 2026-04). Confidence: medium (search snippet; US, not Ontario jurisdiction). Class: S.
10. **Not found:** any 211 / Inform USA (ex-AIRS) / 211 Ontario published guidance on AI chatbots for service navigation. Search returned nothing on-topic. Class: gap.

### Q4 Cost (prices) and latency
11. **Claim:** Gemini API paid tier (per 1M tokens): Gemini 2.5 Flash input $0.30 / output $2.50; Gemini 2.5 Flash-Lite input $0.10 / output $0.40; Gemini Embedding 2 text $0.20. Free tier exists with limits.
   - Source: https://ai.google.dev/gemini-api/docs/pricing (Google, last updated 2026-10-01). Confidence: high. Class: F.
12. **Claim:** Cohere Command A: $2.50 / 1M input, $10.00 / 1M output, 256K context.
   - Source: https://pricepertoken.com/pricing-page/model/cohere-command-a (aggregator, 2026) via search summary. Confidence: medium-low: **official cohere.com/pricing, fetched today, did NOT list Command A, Embed 4 or Rerank per-unit prices** (it showed legacy Command R / R+ / Aya prices and Model Vault $3-10/hr instance pricing, and points to sales). Class: S. **Needs a second, primary source before relying on it.**
13. **Claim:** Cohere Rerank and Embed per-unit prices: not verifiable from the official page this run. An aggregator headline cites "Rerank v3 $2" (unit unclear). Class: U.
14. **Not fetched:** OpenAI pricing (platform.openai.com/docs/pricing now 301-redirects to https://developers.openai.com/api/docs/pricing; budget ran out). Class: gap.
15. **Not found:** measured latency for embed+rerank vs embed+rerank+generate. Unverified belief: retrieval-only adds hundreds of ms; generation adds roughly 1-several seconds to first full answer, mitigated by streaming. Class: U.

### Q5 Platform fit
16. **Claim:** Vercel Functions (Fluid compute, Node/Bun/Python): max duration Hobby 300s default and max; Pro/Enterprise 300s default, 800s max (1800s beta). Duration includes streamed responses; timeout returns 504 FUNCTION_INVOCATION_TIMEOUT. Edge runtime must begin responding within 25s and can stream up to 300s. Request/response body limit 4.5 MB. Waiting on I/O (e.g. calling AI models) does not count toward active CPU billing.
   - Source: https://vercel.com/docs/functions/limitations (Vercel, last updated 2026-08-24). Confidence: high. Class: F.
17. **Claim:** Supabase Free plan: 500 MB database, 1 GB file storage, 50,000 MAU, 5 GB egress, 2 active projects; free projects pause after 7 days of inactivity and need manual unpause; paid plans are not paused.
   - Source: https://www.itpathsolutions.com/supabase-free-tier-limits and https://costbench.com/software/database-as-service/supabase/free-plan/ (third-party, 2026) via search summary. Official https://supabase.com/pricing was fetched but returned no extractable content. Confidence: medium. Class: S.
18. **Inference:** a 100-entry catalogue with e.g. 1,024-dim float embeddings is ~0.4 MB of vectors, far below 500 MB; pgvector is fine on Free, but the 7-day pause is a real availability risk for an emergency-adjacent public service -> Pro (or a keep-alive) is needed in production. Class: I. (pgvector availability on Free not re-verified this run; unverified belief that it is included on all plans.)

## Cost table (rough, monthly, 2,000 queries)
Assumptions (I): per query ~30 query tokens embedded; RAG prompt ~3,000 input tokens (system + top ~8 listings) and ~300 output tokens (multilingual answers can tokenize 1.5-3x longer in non-Latin scripts — upper bound shown). Catalogue re-embedding (100 x ~300 tokens = 30K tokens) is negligible.

| Component | Price used | Volume / month | Cost / month | Price source status |
|---|---|---|---|---|
| Query embedding (Gemini Embedding 2) | $0.20 / 1M | 0.06M tokens | ~$0.01 | official, 2026-10-01 |
| Rerank (Cohere) | unverified (~$2 / 1K searches if per-search) | 2,000 searches | ~$4 (U) | NOT verified |
| Generation: Command A | $2.50 in / $10 out per 1M | 6M in / 0.6M out (up to 1.8M out) | ~$21 (up to ~$33) | aggregator only |
| Generation: Gemini 2.5 Flash | $0.30 / $2.50 | same | ~$3.30 (up to ~$6.30) | official |
| Generation: Gemini 2.5 Flash-Lite | $0.10 / $0.40 | same | ~$0.84 (up to ~$1.30) | official |
| Supabase | Free $0 / Pro (price not verified this run) | — | — | secondary |
| Vercel | Hobby free; Pro usage-based | — | — | official limits |

Bottom line (I): retrieval-only ≈ $0-5/month; RAG adds ~$1-35/month depending on model. Cost is not the deciding factor at this scale; safety and translation quality are.

## Leads (not followed — budget)
- The Markup original: "NYC's AI chatbot tells businesses to break the law" (2024-03-29) — primary press source for #1.
- https://developers.openai.com/api/docs/pricing — gpt-4o-mini / gpt-5-mini prices (second price source).
- https://docs.cohere.com/ model pages or Cohere dashboard for official Command A / Rerank 3.5 / Embed 4 prices; or Cohere on Vercel AI Gateway / OpenRouter listing.
- Cohere RAG "documents" + citations docs; papers on attribution/citation accuracy (e.g. ALCE benchmark) for Q2 effectiveness numbers.
- UK GOV.UK "Generative AI Framework for HMG" / GOV.UK Chat experiment results (accuracy findings) for Q3.
- 211 Ontario / Inform Canada / Inform USA AI position statements (try their sites directly).
- Supabase docs "pgvector" + "billing/compute" pages for official limits.
- Latency: Cohere rerank latency benchmarks; Artificial Analysis TTFT for Command A / Gemini Flash.

## Could not find / verify
- Official Cohere per-unit prices for Command A, Embed 4, Rerank (official page omits them).
- Any 211 / Inform USA / AIRS guidance on AI chatbots.
- Quantitative effectiveness of citations / grounded-only prompts / refusal for reducing hallucination, especially in non-English output.
- Latency figures for embed+rerank vs +generate.
- Official Supabase plan limits page content (fetch returned empty); Pro price.
- Hallucination rates specifically for *grounded* RAG answers in low-resource languages (found only closed-book / conversational studies).
