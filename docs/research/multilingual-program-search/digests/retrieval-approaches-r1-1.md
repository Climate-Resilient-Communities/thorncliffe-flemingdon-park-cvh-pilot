# Digest: retrieval approaches for multilingual program matching (round 1, pass 1)

Decision served: how to match a resident's natural-language question (15 languages, incl. romanized/code-mixed) to ~100 English provider descriptions.
Accessed for all sources: 2026-10-01. Tool calls used: 14 of 15. Classes: primary-paper, official-doc, secondary (search snippet / vendor marketing).

## Claims

| # | Claim | Source URL | Publisher | pub_date | Confidence | Class |
|---|---|---|---|---|---|---|
| C1 | Elasticsearch language analyzers cover Bengali, Persian, Hindi, Greek, Spanish, French, English (plus CJK bigram analyzer); there is NO analyzer for Urdu, Pashto, Tagalog, Gujarati, Punjabi, Tamil, or Slovak, and no dedicated Chinese analyzer (CJK only). | https://www.elastic.co/docs/reference/text-analysis/analysis-lang-analyzer | Elastic | undated (current docs) | High | official-doc |
| C2 | On MKQA cross-lingual retrieval (queries in 25 non-English languages, English-side corpus), Recall@100 averages: BM25 39.9, mE5-large 70.9, OpenAI text-embedding-3-large 69.5, BGE-M3 dense 75.1, dense+sparse 75.3, all modes 75.5. Keyword search roughly halves recall cross-lingually. | https://arxiv.org/html/2402.03216v4 | arXiv (BAAI, Chen et al.) | 2024-02-05, rev. 2025-12-12 | High (primary table) | primary-paper |
| C3 | BM25 collapses on non-Latin-script / lower-resource query languages cross-lingually (Recall@100: ar 18.9, he 26.9, km 27.8, th 37.8) while BGE-M3 stays ~68-76 on the same languages. | https://arxiv.org/html/2402.03216v4 | arXiv (BAAI) | 2024 / rev. 2025-12 | High | primary-paper |
| C4 | Adding sparse/multi-vector (hybrid) to BGE-M3 dense gives only marginal gain cross-lingually (75.1 -> 75.5 R@100 on MKQA). | https://arxiv.org/html/2402.03216v4 | arXiv (BAAI) | 2024 / rev. 2025-12 | High | primary-paper |
| C5 | BGE-M3 MIRACL (monolingual multilingual, 18 langs) nDCG@10 71.5 vs mE5-large 66.6. | https://arxiv.org/html/2402.03216v4 | arXiv (BAAI) | 2024 / rev. 2025-12 | High | primary-paper |
| C6 | Code-switched queries are a "fundamental performance bottleneck" for multilingual retrievers; CS-MTEB shows declines of up to 27%, with substantial embedding-space divergence between pure and code-switched text. (Specific language pairs/models not visible in abstract.) | https://arxiv.org/abs/2604.17632 | arXiv (Zeng et al.) | 2026-04-19 | Medium (abstract only) | primary-paper |
| C7 | Embedding-level mixing of parallel query translations with BGE-M3 beats the best monolingual query in 88/105 cases -> embedding original query + its English translation and combining can help. | https://arxiv.org/abs/2606.13537v1 (ACL 2026: https://aclanthology.org/2026.acl-long.1455/) | arXiv / ACL Anthology | 2026-06 | Medium (search snippet of abstract) | primary-paper (snippet) |
| C8 | Translating code-mixed queries to English was found effective "given current embedding model resources"; script variation, transliteration and tokenization errors hurt retrieval. | https://arxiv.org/pdf/2602.11181 | arXiv ("Code Mixologist") | 2026-02 | Low-Medium (search snippet, not fetched) | secondary |
| C9 | Mixed evidence on translate-then-retrieve: retrieval-fine-tuned models benefit from pivoting through English, whereas bitext-mining models (LaBSE) do best directly; English pivot cost LaBSE/M-MPNet ~2.6-2.8 points. | https://arxiv.org/html/2502.08638v3 (EMNLP Findings 2025) | arXiv / ACL | 2025 | Low-Medium (search snippet) | primary-paper (snippet) |
| C10 | Field survey: CLIR has shifted from translation-based pipelines toward embedding-based approaches; cross-language alignment, data imbalance and linguistic variation remain open problems for low-resource languages. | https://arxiv.org/abs/2510.00908 | arXiv (Goworek et al.) | 2025-10-01 | Medium (abstract, qualitative) | primary-paper (survey) |
| C11 | Roman-Urdu<->Urdu transliteration with transformer (m2m100-based) reaches char-BLEU ~96-97 -> transliteration normalization of Roman Urdu is technically mature. | https://aclanthology.org/2025.loresmt-1.13/ | ACL Anthology (LoResMT 2025) | 2025 | Low-Medium (search snippet) | primary-paper (snippet) |
| C12 | pgvector performs exact nearest-neighbour search by default with perfect recall; HNSW/IVFFlat indexes are approximate and only needed for speed. | https://github.com/pgvector/pgvector | pgvector (GitHub README) | current | High | official-doc |
| C13 | Supabase documents a hybrid pattern: tsvector+GIN full-text and pgvector+HNSW, fused with Reciprocal Rank Fusion in a SQL function; example uses to_tsvector('english', ...) and gives no multilingual guidance or corpus-size threshold. | https://supabase.com/docs/guides/ai/hybrid-search | Supabase | undated | High | official-doc |
| C14 | Cohere embed v4 supports 100+ languages in a shared vector space for cross-lingual search; claims SOTA on MTEB (vendor/secondary claim, no per-language numbers retrieved). | https://techcommunity.microsoft.com/blog/azure-ai-foundry-blog/unlock-multi-modal-embed-4-and-multilingual-agentic-rag-with-command-a-on-azure/4404458 ; https://cohere.com/embed | Microsoft / Cohere | 2025 | Low (marketing) | secondary |

## Comparison of approaches a-e

| Approach | Cross-lingual accuracy (esp. low-resource) | Romanized / code-mixed | Build effort | Fit for ~100 docs |
|---|---|---|---|---|
| (a) Keyword FTS (ES/OpenSearch/Postgres) | Poor: lexical match cannot bridge Pashto->English; BM25 MKQA R@100 39.9 vs ~70-75 dense, <30 for several non-Latin langs (C2, C3). 7-8 of the 15 languages lack ES analyzers (C1). | Poor (no stemming/transliteration for Roman Urdu/Hinglish; occasional English loanword hits only). | Low (Postgres) to Medium (ES cluster). | ES is overkill; Postgres FTS adequate only as an English-keyword side channel. |
| (b) Multilingual dense embeddings, direct | Best evidenced: BGE-M3 75.1, mE5 70.9, OpenAI-3-large 69.5 R@100 on MKQA (C2), stable on low-resource scripts (C3). Pashto/Dari/Tagalog/Gujarati-specific numbers NOT found. | Degrades: up to 27% drop on code-switched queries (C6). | Low: embed 100 docs once, embed query, cosine. | Very good; exact search, no index needed (C12). |
| (c) Hybrid keyword+vector (+reranker) | Marginal gain cross-lingually over dense alone (C4); keyword leg contributes little when query is non-English. Reranker benefit for these languages: not evidenced this round. | Keyword leg can catch English tokens in code-mixed queries (unverified belief). | Medium (Supabase RRF recipe exists, C13). | Fine but extra complexity for little evidenced benefit at 100 docs. |
| (d) Translate query to English, then retrieve | Mixed evidence: helps retrieval-tuned models, hurts bitext models slightly (C9); survey says field has moved to direct embeddings (C10). No head-to-head on our 15 languages found. | Likely the strongest lever for code-mixed/romanized input (C8, C11), but evidence is snippet-level. | Medium: adds MT/LLM call, latency, cost; translation also enables English keyword match. | Good; adds per-query dependency. |
| (e) Romanized/code-mixed handling | Dense models degrade (C6); mixing original + translated query embeddings helps (C7); transliteration normalization mature for Roman Urdu (C11). | — | Medium (LLM-based normalize/translate step). | Good as a preprocessing layer. |

Evidence-based ranking for this decision: (1) b as backbone, augmented with d/e as a fallback or fused second query (embed original + English translation, combine — C7) -> (2) c only if English keyword precision matters -> (3) d alone -> (4) a alone (rejected). Storage: pgvector exact scan or in-memory cosine is sufficient for ~100 docs (C12); Elasticsearch/OpenSearch is overkill (inference from C1, C12; no production account retrieved).

Note on two-source rule: "dense >> keyword cross-lingually" rests on C2/C3 (one paper, primary table) plus C10 (survey, qualitative) -> meets two-source threshold only loosely. "Code-mixed degrades dense retrieval" rests on C6 + C8 (two sources). "Translate-then-retrieve beats/loses vs direct" does NOT meet the bar.

## Leads
- Full text of arXiv 2604.17632 (CS-MTEB): which language pairs (Hinglish? Roman Urdu?) and which models.
- MMTEB (arXiv 2502.13595) per-language retrieval for Urdu/Pashto/Tagalog/Gujarati/Punjabi/Tamil.
- Belebele-based retrieval or bitext results for Pashto/Dari.
- arXiv 2112.11031 (Litschko et al., "On cross-lingual retrieval with multilingual text encoders") for quantitative translate-vs-direct.
- Cohere embed v4 / multilingual-v3 and OpenAI text-embedding-3 per-language MIRACL numbers from official docs.
- Postgres text search language list (docs URL 404'd: textsearch-dicts.html); try https://www.postgresql.org/docs/current/textsearch-configuration.html or `\dF`.
- Multilingual reranker evidence (bge-reranker-v2-m3, Cohere rerank-multilingual) on MIRACL.

## Could not find (this round)
- Any retrieval benchmark numbers for Pashto, Dari, Tagalog, Gujarati, Punjabi specifically.
- Head-to-head translate-then-retrieve vs direct cross-lingual dense for these languages.
- Quantitative Roman Urdu / Hinglish retrieval results with BGE-M3, e5, OpenAI or Cohere.
- Postgres built-in FTS language list (page 404; NOT verified this run — belief only: Snowball configs cover English, French, Spanish, Greek, Hindi, Tamil and others, but not Urdu/Pashto/Tagalog).
- Production accounts of tiny-corpus (<1k docs) multilingual search on Supabase.
- Multilingual reranker gains for low-resource query languages.
