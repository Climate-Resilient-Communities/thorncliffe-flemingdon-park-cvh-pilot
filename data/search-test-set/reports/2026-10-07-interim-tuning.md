# Search tuning experiment (offline), and the interim tuning built from it — CVH pilot

> **Status: interim.** This is the offline experiment of 2026-10-07 that the product owner approved, committed as the record of
> the interim tuning (the spine's AD-11 "As built (interim search tuning)", S03.07's notes in docs/planning/pilot/epics.md).
> It was measured on a small, mostly machine-drafted test set; S03.08's ambassador questions confirm or revise every value.
> The vectors, the rerank scores and the experiment's scripts are not committed (about 7.6 MB of vectors; section 7 lists what
> they were). The 22 experiment questions `x-01` to `x-22` are in `data/search-test-set/questions.jsonl` as `en-11` to `en-32`
> (same order, author `claude-draft`, tuning subset). Section 8, at the end, is the verification of the code as built.


Date: 2026-10-07. Code read at origin/main `ed3fc2e4`. Offline only: no change to production, Vercel, Supabase or GitHub; nothing committed.

## 1. What was measured

* **Documents** reproduced with the repo's own `searchItems()` / `searchTextOf()` (src/modules/directory/domain/searchData.ts) over
  data/catalogue/providers.json: one English text per provider (name, `Categories:`, `Subcategories:`, scrubbed `Services:`,
  scrubbed `Emergency role:`), 99 providers, embedded once (English only — production embeds one English text per provider, not per language),
  `embed-v4.0`, `input_type=search_document`, float, default 1536 dims (production passes no `outputDimension`).
* **Sanity check** (questions embedded as `search_query`): reproduces production to within 0.002 —

| question | production (release 8) | this run, top 5 cosine | # ≥ 0.30 | proposed hybrid (D, w .15, thr .27) |
|---|---|---|---|---|
| where can I get food? | 0 results | M008 0.293, M007 0.281, M071 0.281, M075 0.276, M010 0.265 | 0 | M008 0.359, M071 0.346, M075 0.338, M007 0.334, M010 0.326 |
| food | 0 | M073 0.268, M078 0.267, M071 0.263, M075 0.258, M007 0.253 | 0 | M071 0.328, M078 0.323, M073 0.322, M075 0.321, M007 0.306 |
| I need food | 0 | M008 0.290, M007 0.269, M071 0.259, M010 0.224, M078 0.215 | 0 | M008 0.356, M071 0.324, M007 0.321, M010 0.285, M075 0.272 |
| where can I get food | 1 (M008 0.303) | M008 0.301, M007 0.296, M071 0.295, M075 0.281, M073 0.259 | 1 | M008 0.367, M071 0.360, M007 0.348, M075 0.344, M073 0.313 |
| food bank | 5 (0.446, 0.408, 0.400, 0.320, 0.315) | M008 0.444, M071 0.409, M007 0.400, M092 0.320, M075 0.315 | 8 | M008 0.540, M071 0.475, M007 0.473, M010 0.379, M075 0.378 |
| groceries | 1 (0.311) | M071 0.311, M092 0.290, M007 0.285, M075 0.270, M008 0.250 | 1 | M057 0.311, M071 0.311, M092 0.290, M007 0.285 |

* **Questions**: all 171 of data/search-test-set/questions.jsonl (32 by `dev-agent`, 139 `claude-draft`; NB none is ambassador-written)
  + 22 new English questions, **experiment set**, saved in `experiment_set.jsonl` (food, doctor/no OHIP, mental health, teen counselling,
  eviction/legal, rent, homelessness, seniors, homework, school, newcomers, immigration papers, fire, police, 4 no-match).
* **Translated-question leg (S03.05)**: production translates ps / prs / native ur / romanized-or-mixed questions with
  `command-a-translate` and fuses the two legs (RRF). I could not reproduce that model cheaply (it is a chat model with its own monthly cap),
  so I ran production's own routing (`questionLegSource`) to find the 70 questions that take the leg, wrote the English translations myself
  (`translations_proxy.json`) and embedded them. Treat that leg as an **upper bound** (clean human-quality translations).
  Arm A ranks the two legs exactly as production (`rankLegs`, RRF k=60); arms B/D/E fuse legs by max similarity; C reranks the original question.
* **Vendor usage (key 1 = `COHERE_API_KEY` only; key 2 never read)**: 5 embed calls (2 documents, 3 questions; 99 + 269 texts),
  193 rerank calls (`rerank-v3.5`, one per question, top-20 embedding candidates). No 429s.
  Rerank latency per call (from this Mac): p50 163 ms, p90 608 ms, p99 1245 ms, max 1277 ms.

**Metrics** (percent). hit@3: an expected provider among the first 3 shown (answerable questions). shown: results shown (answerable).
no-match ok: a `no_match` question shows nothing (only 21 such questions: one question = 4.8 points). emergency flag: `emergency_first`
true for an `emergency` question (production meaning: the 911 block goes first; computed as production does — an emergency-category
result, or the fail-safe "emergency provider in a leg's top 3 at ≥ min(0.25, threshold)"). emerg. false alarm: flag on a non-emergency question.
false-pos: share of all questions that show results with no expected provider (any results, for no-match).
Emergency-category providers (Support & Emergency Services): M001–M006 and the shelters M009, M010.

## 2. Sweeps (overall, n=193)

### A. Current ranking, threshold sweep
| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| A thr=0.3 | 48.3 | 50.6 | 85.7 | 42.1 | 1.1 | 3.6 |
| A thr=0.28 | 54.7 | 58.7 | 81.0 | 42.1 | 1.1 | 5.7 |
| A thr=0.27 | 59.3 | 64.0 | 81.0 | 42.1 | 1.1 | 6.2 |
| A thr=0.25 | 66.9 | 73.8 | 66.7 | 42.1 | 2.9 | 9.3 |
| A thr=0.24 | 69.2 | 77.3 | 66.7 | 42.1 | 2.9 | 10.4 |
| A thr=0.22 | 72.7 | 82.0 | 47.6 | 52.6 | 4.6 | 13.0 |
| A thr=0.2 | 77.9 | 86.6 | 33.3 | 63.2 | 5.2 | 14.0 |
| A thr=0.18 | 78.5 | 91.3 | 9.5 | 63.2 | 8.0 | 19.7 |

### B. Top-5 with a floor on the top score, dropping results more than `gap` below the top
| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| B floor=0.18 gap=0.08 | 80.2 | 91.3 | 9.5 | 68.4 | 9.2 | 17.6 |
| B floor=0.18 gap=0.1 | 80.8 | 91.3 | 9.5 | 68.4 | 9.8 | 17.1 |
| B floor=0.2 gap=0.08 | 77.3 | 86.6 | 33.3 | 63.2 | 7.5 | 14.0 |
| B floor=0.2 gap=0.1 | 77.9 | 86.6 | 33.3 | 63.2 | 8.0 | 13.5 |
| B floor=0.22 gap=0.08 | 73.8 | 82.0 | 47.6 | 52.6 | 5.7 | 11.9 |
| B floor=0.22 gap=0.1 | 74.4 | 82.0 | 47.6 | 52.6 | 6.3 | 11.4 |
| B floor=0.24 gap=0.08 | 71.5 | 77.3 | 66.7 | 42.1 | 4.6 | 7.8 |
| B floor=0.24 gap=0.1 | 72.1 | 77.3 | 66.7 | 42.1 | 4.6 | 7.3 |
| B floor=0.25 gap=0.08 | 69.2 | 73.8 | 66.7 | 42.1 | 4.0 | 7.3 |
| B floor=0.25 gap=0.1 | 69.8 | 73.8 | 66.7 | 42.1 | 4.0 | 6.7 |
| B floor=0.28 gap=0.08 | 55.8 | 58.7 | 81.0 | 42.1 | 3.4 | 4.1 |
| B floor=0.28 gap=0.1 | 56.4 | 58.7 | 81.0 | 42.1 | 3.4 | 3.6 |

### C. Cohere rerank-v3.5 on the embedding top 20, relevance cut-off
| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| C rerank cut=0.02 | 77.3 | 93.0 | 42.9 | 84.2 | 14.9 | 17.6 |
| C rerank cut=0.03 | 68.6 | 79.1 | 71.4 | 63.2 | 8.0 | 11.4 |
| C rerank cut=0.04 | 66.3 | 72.7 | 76.2 | 57.9 | 6.9 | 7.3 |
| C rerank cut=0.05 | 60.5 | 64.5 | 85.7 | 52.6 | 4.0 | 4.1 |
| C rerank cut=0.06 | 55.2 | 58.7 | 90.5 | 42.1 | 3.4 | 3.1 |
| C rerank cut=0.08 | 51.7 | 54.1 | 95.2 | 42.1 | 2.9 | 1.6 |
| C rerank cut=0.1 | 45.9 | 48.8 | 95.2 | 42.1 | 2.3 | 2.6 |
| C rerank cut=0.15 | 30.2 | 34.3 | 100.0 | 42.1 | 1.1 | 3.6 |

rerank-v3.5 relevance scores are low in absolute terms (good matches 0.05–0.4). It reads the *original* question, so it is weak on
romanized/mixed questions (Urdu/Hindi/Punjabi in Latin letters) and strong on native-script ones the embedding scores low (es, fr, tl, sk, gu, bn).

### D. Hybrid: cosine + w · BM25/(BM25+4) over English name + categories + subcategories + services (question text + its English translation when the translated leg exists)
| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| D w=0.1 thr=0.24 | 72.1 | 77.9 | 61.9 | 47.4 | 4.0 | 7.8 |
| D w=0.1 thr=0.25 | 69.8 | 76.2 | 66.7 | 47.4 | 3.4 | 7.8 |
| D w=0.1 thr=0.26 | 68.0 | 74.4 | 76.2 | 47.4 | 2.3 | 6.7 |
| D w=0.1 thr=0.27 | 64.5 | 70.3 | 81.0 | 42.1 | 1.7 | 5.7 |
| D w=0.1 thr=0.28 | 61.6 | 66.3 | 81.0 | 42.1 | 1.7 | 5.2 |
| D w=0.1 thr=0.3 | 57.0 | 60.5 | 81.0 | 42.1 | 1.7 | 5.2 |
| D w=0.15 thr=0.24 | 72.7 | 78.5 | 61.9 | 47.4 | 4.6 | 8.3 |
| D w=0.15 thr=0.25 | 70.9 | 76.7 | 61.9 | 47.4 | 4.0 | 8.3 |
| D w=0.15 thr=0.26 | 69.2 | 75.0 | 71.4 | 47.4 | 3.4 | 7.3 |
| D w=0.15 thr=0.27 | 66.3 | 71.5 | 81.0 | 47.4 | 2.9 | 5.7 |
| D w=0.15 thr=0.28 | 62.8 | 68.0 | 81.0 | 47.4 | 2.9 | 5.7 |
| D w=0.15 thr=0.3 | 58.7 | 62.2 | 81.0 | 42.1 | 2.3 | 4.7 |
| D w=0.2 thr=0.24 | 73.8 | 79.7 | 61.9 | 47.4 | 5.2 | 8.3 |
| D w=0.2 thr=0.25 | 71.5 | 76.7 | 61.9 | 47.4 | 5.2 | 7.8 |
| D w=0.2 thr=0.26 | 70.3 | 75.6 | 71.4 | 47.4 | 4.6 | 6.7 |
| D w=0.2 thr=0.27 | 68.0 | 72.7 | 76.2 | 47.4 | 4.6 | 5.7 |
| D w=0.2 thr=0.28 | 65.1 | 70.3 | 76.2 | 47.4 | 4.0 | 6.2 |
| D w=0.2 thr=0.3 | 60.5 | 64.0 | 81.0 | 47.4 | 3.4 | 4.1 |

### E. (extra) rerank order, show a candidate if rerank ≥ cut OR cosine ≥ t
| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| E rerank cut=0.03 OR cos>=0.28 | 76.7 | 87.2 | 61.9 | 63.2 | 8.0 | 12.4 |
| E rerank cut=0.03 OR cos>=0.3 | 75.6 | 86.0 | 66.7 | 63.2 | 8.0 | 11.9 |
| E rerank cut=0.05 OR cos>=0.28 | 70.9 | 76.7 | 71.4 | 52.6 | 4.0 | 7.3 |
| E rerank cut=0.05 OR cos>=0.3 | 69.8 | 74.4 | 76.2 | 52.6 | 4.0 | 5.7 |
| E rerank cut=0.08 OR cos>=0.28 | 67.4 | 71.5 | 81.0 | 42.1 | 2.9 | 4.7 |
| E rerank cut=0.08 OR cos>=0.3 | 65.1 | 68.0 | 85.7 | 42.1 | 2.9 | 3.1 |

## 3. Best setting per arm (highest hit@3 with no-match accuracy ≥ 80%, i.e. at most 4 of 21 no-match questions show something)

| arm | setting | hit@3 | shown | no-match ok | emergency flag | false-pos | extra vendor calls / search |
|---|---|---|---|---|---|---|---|
| A | thr 0.27 | 59.3 | 64.0 | 81.0 | 42.1 | 6.2 | 0 |
| B | floor 0.28, gap 0.10 | 56.4 | 58.7 | 81.0 | 42.1 | 3.6 | 0 |
| C | rerank cut 0.05 | 60.5 | 64.5 | 85.7 | 52.6 | 4.1 | 1 rerank |
| D | w 0.15, thr 0.27 | 66.3 | 71.5 | 81.0 | 47.4 | 5.7 | 0 |
| E | rerank 0.08 OR cos 0.28 | 67.4 | 71.5 | 81.0 | 42.1 | 4.7 | 1 rerank |
| (current) | A thr 0.30 | 48.3 | 50.6 | 85.7 | 42.1 | 3.6 | 0 |
| **R1b — recommended** | D(w .15, thr .27) when the question is English or took the translated leg; B(floor .24, gap .10) for other languages; + emergency top-1 rule (.14) | 70.9 | 75.6 | 81.0 | 68.4 | 5.2 | 0 |
| R2 — optional later | R1b but rerank cut .05 for non-English direct-only questions | 75.0 | 79.7 | 81.0 | 68.4 | 4.7 | 1 rerank on ~non-English native-script searches |

## 4. By question set and language group

**Overall (171 test-set + 22 experiment)** (n=193; answerable 172, no-match 21, emergency 19)

| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| A current (thr 0.30) | 48.3 | 50.6 | 85.7 | 42.1 | 1.1 | 3.6 |
| A thr 0.27 | 59.3 | 64.0 | 81.0 | 42.1 | 1.1 | 6.2 |
| B floor 0.24 gap 0.10 | 72.1 | 77.3 | 66.7 | 42.1 | 4.6 | 7.3 |
| C rerank cut 0.05 | 60.5 | 64.5 | 85.7 | 52.6 | 4.0 | 4.1 |
| D w 0.15 thr 0.27 | 66.3 | 71.5 | 81.0 | 47.4 | 2.9 | 5.7 |
| E rerank 0.08 OR cos 0.28 | 67.4 | 71.5 | 81.0 | 42.1 | 2.9 | 4.7 |
| **R1b** (rec.) D(.15,.27) en/translated, B(.24,.10) other + em top-1 .14 | 70.9 | 75.6 | 81.0 | 68.4 | 2.3 | 5.2 |
| R2 D(.15,.27) en/translated, C rerank .05 other + em top-1 .14 | 75.0 | 79.7 | 81.0 | 68.4 | 3.4 | 4.7 |

**Non-draft test-set questions (author `dev-agent`; there are NO ambassador-written questions yet)** (n=32; answerable 30, no-match 2, emergency 2)

| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| A current (thr 0.30) | 66.7 | 66.7 | 100.0 | 50.0 | 0.0 | 0.0 |
| A thr 0.27 | 73.3 | 76.7 | 100.0 | 50.0 | 0.0 | 3.1 |
| B floor 0.24 gap 0.10 | 86.7 | 90.0 | 100.0 | 50.0 | 0.0 | 3.1 |
| C rerank cut 0.05 | 83.3 | 86.7 | 100.0 | 100.0 | 0.0 | 0.0 |
| D w 0.15 thr 0.27 | 73.3 | 76.7 | 100.0 | 50.0 | 0.0 | 3.1 |
| E rerank 0.08 OR cos 0.28 | 86.7 | 90.0 | 100.0 | 50.0 | 0.0 | 0.0 |
| **R1b** (rec.) D(.15,.27) en/translated, B(.24,.10) other + em top-1 .14 | 86.7 | 90.0 | 100.0 | 100.0 | 0.0 | 3.1 |
| R2 D(.15,.27) en/translated, C rerank .05 other + em top-1 .14 | 90.0 | 93.3 | 100.0 | 100.0 | 0.0 | 0.0 |

**`claude-draft` test-set questions** (n=139; answerable 124, no-match 15, emergency 15)

| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| A current (thr 0.30) | 48.4 | 50.8 | 80.0 | 33.3 | 0.8 | 4.3 |
| A thr 0.27 | 57.3 | 61.3 | 73.3 | 33.3 | 0.8 | 6.5 |
| B floor 0.24 gap 0.10 | 69.4 | 72.6 | 66.7 | 33.3 | 3.2 | 5.8 |
| C rerank cut 0.05 | 53.2 | 57.3 | 86.7 | 40.0 | 3.2 | 4.3 |
| D w 0.15 thr 0.27 | 63.7 | 69.4 | 73.3 | 40.0 | 1.6 | 7.2 |
| E rerank 0.08 OR cos 0.28 | 63.7 | 68.5 | 73.3 | 33.3 | 2.4 | 6.5 |
| **R1b** (rec.) D(.15,.27) en/translated, B(.24,.10) other + em top-1 .14 | 66.9 | 71.8 | 73.3 | 60.0 | 0.8 | 6.5 |
| R2 D(.15,.27) en/translated, C rerank .05 other + em top-1 .14 | 71.8 | 76.6 | 73.3 | 60.0 | 2.4 | 6.5 |

**Experiment set (22 English need-phrased, written for this experiment)** (n=22; answerable 18, no-match 4, emergency 2)

| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| A current (thr 0.30) | 16.7 | 22.2 | 100.0 | 100.0 | 5.0 | 4.5 |
| A thr 0.27 | 50.0 | 61.1 | 100.0 | 100.0 | 5.0 | 9.1 |
| B floor 0.24 gap 0.10 | 66.7 | 88.9 | 50.0 | 100.0 | 20.0 | 22.7 |
| C rerank cut 0.05 | 72.2 | 77.8 | 75.0 | 100.0 | 15.0 | 9.1 |
| D w 0.15 thr 0.27 | 72.2 | 77.8 | 100.0 | 100.0 | 15.0 | 0.0 |
| E rerank 0.08 OR cos 0.28 | 61.1 | 61.1 | 100.0 | 100.0 | 10.0 | 0.0 |
| **R1b** (rec.) D(.15,.27) en/translated, B(.24,.10) other + em top-1 .14 | 72.2 | 77.8 | 100.0 | 100.0 | 15.0 | 0.0 |
| R2 D(.15,.27) en/translated, C rerank .05 other + em top-1 .14 | 72.2 | 77.8 | 100.0 | 100.0 | 15.0 | 0.0 |

**All English (test-set en + experiment)** (n=32; answerable 27, no-match 5, emergency 4)

| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| A current (thr 0.30) | 29.6 | 33.3 | 80.0 | 75.0 | 3.6 | 6.2 |
| A thr 0.27 | 51.9 | 63.0 | 80.0 | 75.0 | 3.6 | 12.5 |
| B floor 0.24 gap 0.10 | 74.1 | 88.9 | 40.0 | 75.0 | 21.4 | 18.8 |
| C rerank cut 0.05 | 70.4 | 77.8 | 60.0 | 75.0 | 10.7 | 12.5 |
| D w 0.15 thr 0.27 | 70.4 | 77.8 | 80.0 | 75.0 | 10.7 | 6.2 |
| E rerank 0.08 OR cos 0.28 | 63.0 | 66.7 | 80.0 | 75.0 | 7.1 | 6.2 |
| **R1b** (rec.) D(.15,.27) en/translated, B(.24,.10) other + em top-1 .14 | 70.4 | 77.8 | 80.0 | 75.0 | 10.7 | 6.2 |
| R2 D(.15,.27) en/translated, C rerank .05 other + em top-1 .14 | 70.4 | 77.8 | 80.0 | 75.0 | 10.7 | 6.2 |

**Non-English questions that take the translated leg (ps, prs, native ur, romanized/mixed)** (n=70; answerable 61, no-match 9, emergency 6)

| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| A current (thr 0.30) | 73.8 | 77.0 | 77.8 | 83.3 | 1.6 | 5.7 |
| A thr 0.27 | 83.6 | 86.9 | 66.7 | 83.3 | 1.6 | 7.1 |
| B floor 0.24 gap 0.10 | 91.8 | 95.1 | 55.6 | 83.3 | 3.1 | 7.1 |
| C rerank cut 0.05 | 49.2 | 52.5 | 88.9 | 83.3 | 3.1 | 2.9 |
| D w 0.15 thr 0.27 | 90.2 | 95.1 | 66.7 | 100.0 | 1.6 | 7.1 |
| E rerank 0.08 OR cos 0.28 | 78.7 | 85.2 | 66.7 | 83.3 | 3.1 | 8.6 |
| **R1b** (rec.) D(.15,.27) en/translated, B(.24,.10) other + em top-1 .14 | 90.2 | 95.1 | 66.7 | 100.0 | 1.6 | 7.1 |
| R2 D(.15,.27) en/translated, C rerank .05 other + em top-1 .14 | 90.2 | 95.1 | 66.7 | 100.0 | 1.6 | 7.1 |

**Other non-English (direct leg only)** (n=91; answerable 84, no-match 7, emergency 9)

| setting | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| A current (thr 0.30) | 35.7 | 36.9 | 100.0 | 0.0 | 0.0 | 1.1 |
| A thr 0.27 | 44.0 | 47.6 | 100.0 | 0.0 | 0.0 | 3.3 |
| B floor 0.24 gap 0.10 | 57.1 | 60.7 | 100.0 | 0.0 | 0.0 | 3.3 |
| C rerank cut 0.05 | 65.5 | 69.0 | 100.0 | 22.2 | 2.4 | 2.2 |
| D w 0.15 thr 0.27 | 47.6 | 52.4 | 100.0 | 0.0 | 1.2 | 4.4 |
| E rerank 0.08 OR cos 0.28 | 60.7 | 63.1 | 100.0 | 0.0 | 1.2 | 1.1 |
| **R1b** (rec.) D(.15,.27) en/translated, B(.24,.10) other + em top-1 .14 | 57.1 | 60.7 | 100.0 | 44.4 | 0.0 | 3.3 |
| R2 D(.15,.27) en/translated, C rerank .05 other + em top-1 .14 | 65.5 | 69.0 | 100.0 | 44.4 | 2.4 | 2.2 |

### Per language (hit@3 / no-match ok; each language has 1–2 no-match questions)
| lang | n | A current hit@3 / nm | C rerank cut 0.05 hit@3 / nm | D w 0.15 thr 0.27 hit@3 / nm | R1b hit@3 / nm | R2 D(.15,.27) en/translated, C rerank .05 other + em top-1 .14 hit@3 / nm |
|---|---|---|---|---|---|---|
| en | 32 | 30 / 80 | 70 / 60 | 70 / 80 | 70 / 80 | 70 / 80 |
| bn | 11 | 20 / 100 | 50 / 100 | 60 / 100 | 60 / 100 | 50 / 100 |
| el | 10 | 44 / 100 | 44 / 100 | 56 / 100 | 56 / 100 | 56 / 100 |
| es | 12 | 55 / 100 | 73 / 100 | 55 / 100 | 64 / 100 | 73 / 100 |
| fr | 10 | 38 / 100 | 75 / 100 | 50 / 100 | 62 / 100 | 75 / 100 |
| gu | 10 | 33 / 100 | 67 / 100 | 56 / 100 | 78 / 100 | 89 / 100 |
| hi | 11 | 44 / 100 | 78 / 50 | 89 / 100 | 89 / 100 | 100 / 100 |
| pa | 11 | 40 / 0 | 30 / 100 | 50 / 0 | 50 / 0 | 70 / 0 |
| prs | 16 | 80 / 100 | 60 / 100 | 87 / 100 | 87 / 100 | 87 / 100 |
| ps | 15 | 86 / 100 | 64 / 100 | 93 / 100 | 93 / 100 | 93 / 100 |
| sk | 10 | 33 / 100 | 67 / 100 | 44 / 100 | 67 / 100 | 67 / 100 |
| ta | 10 | 22 / 100 | 33 / 100 | 33 / 0 | 33 / 0 | 56 / 0 |
| tl | 11 | 40 / 100 | 70 / 100 | 50 / 100 | 70 / 100 | 70 / 100 |
| ur | 14 | 69 / 0 | 46 / 100 | 85 / 0 | 85 / 0 | 85 / 0 |
| zh | 10 | 78 / 100 | 67 / 100 | 78 / 100 | 78 / 100 | 78 / 100 |

Notes: `ur` / `pa` / `ta` no-match failures are near-misses the directory half-answers: "car repair shop" → Gateway Bike Hub (bike repair),
"nearest gurdwara" → other prayer halls (Jamatkhana, masjid). `en-10` "car mechanic near overlea" shows Red Apple Day Care *Overlea*
already in production (cosine 0.39): place names in provider names attract questions that mention the street.

## 5. Emergency flag
| rule | emergency qs flagged (of 19) | non-emergency qs flagged (of 174) |
|---|---|---|
| production fail-safe: emergency provider in top 3 of a leg, sim >= 0.25 | 8 | 2 |
| production fail-safe: emergency provider in top 3 of a leg, sim >= 0.22 | 10 | 3 |
| production fail-safe: emergency provider in top 3 of a leg, sim >= 0.2 | 12 | 3 |
| production fail-safe: emergency provider in top 3 of a leg, sim >= 0.18 | 12 | 5 |
| proposed: top-1 provider of a leg is an emergency provider, sim >= 0.12 | 13 | 0 |
| proposed: top-1 provider of a leg is an emergency provider, sim >= 0.14 | 13 | 0 |
| proposed: top-1 provider of a leg is an emergency provider, sim >= 0.16 | 12 | 0 |
| proposed: top-1 provider of a leg is an emergency provider, sim >= 0.2 | 11 | 0 |

The emergency provider is the single best match for 13 of 19 emergency questions but often at low similarity (0.14–0.26), so the
current top-3 ≥ 0.25 fail-safe catches only 8. "Top-1 of either leg is an emergency provider at ≥ 0.14" catches 13 with **no** false alarm
on the other 174 questions. The 6 still missed are medical emergencies ("not breathing", "collapsed", "swallowed pills"), a gas smell and
a flood — the catalogue has no ambulance/EMS/gas provider, so no ranking rule finds them; they need a separate crisis-phrase check
(or a catalogue entry for 911/ambulance), not search tuning.

## 6. Recommendation

**Adopt R1b (no new vendor call):**
1. Keyword boost: `score = cosine + 0.15 × bm25/(bm25 + 4)`, BM25 (k1 1.2, b 0.75; lowercase words, small stop-word list, plural `s`
   stripped) over each provider's English name, category names, subcategory names and services text, computed on the question and, when
   the translated leg ran, its English translation. Show the top 5 with score ≥ **0.27**. Pure code over ~99 short texts: < 1 ms.
2. For questions that are not English and took no translated leg (es, fr, tl, sk, el, zh, bn, gu, ta, native pa/hi), show the top 5 of
   the direct leg if the top similarity ≥ **0.24**, dropping results more than **0.10** below the top (cross-lingual cosines run lower).
3. Emergency: set `emergency_first` when the top provider of either leg is in an emergency category with similarity ≥ **0.14**
   (keep the top-3 ≥ 0.25 fail-safe). Also **drop** the "any shown result is an emergency-category provider" clause: the category holds
   the shelters M009/M010, and with more results shown, "where can I get food?" and "I need food" would list Heyworth House (M010) and
   raise the 911 block. Without that clause R1b keeps emergency 68.4 and false alarms 1.1% (2 of 174, same as today); with it, 2.3%.

Effect on all 193 questions vs. today: hit@3 **48.3 → 70.9**, results shown 50.6 → 75.6, no-match ok 85.7 → 81.0 (one more of 21),
false-positive 3.6 → 5.2, emergency flag 42 → 68. English only: hit@3 30 → 70 with no-match unchanged (80). The six live probes above all
return food providers.

Cost/latency: 0 extra Cohere calls; the same 1 embed call per search (+ translation where it already happens); no new dependency; the
release's vectors are unchanged (no re-embed). It does change the ranking code and the meaning of the threshold, so it needs a code
change in `searchRanking.ts`/`search.ts` (score fusion before the threshold) and new per-route thresholds, not just `SEARCH_THRESHOLD`.

**Why not rerank (C/E/R2) now:** it adds about 4 points of hit@3 overall (R2 75.0 vs R1b 70.9), all from native-script non-English
questions, but costs 1 `rerank-v3.5` call per search against the 1,000-calls/month per-model cap (one key would cap live search at
~1,000 searches/month, or ~1,000 non-English searches if only routed there), adds p50 ~0.16 s / p99 ~1.2 s inside a 2.2 s leg budget,
and makes search depend on a second vendor model that can 429. It also hurts romanized questions unless fed the English translation.
Revisit if traffic is small enough or a production rerank quota is bought.

**Fallback if code change is not wanted now:** `SEARCH_THRESHOLD=0.27` alone (arm A): hit@3 48.3 → 59.3, no-match 85.7 → 81.0, and
`SEARCH_EMERGENCY_THRESHOLD` cannot go above it. That is a config-only change but leaves half of English need-questions unanswered.

**Risks / caveats**
* Small, mostly machine-drafted test set: 139 of 171 questions are `claude-draft`, the other 32 are `dev-agent`; only 21 no-match and 19
  emergency questions. Each no-match question is 4.8 points. Parameters were chosen on the same questions they are scored on
  (including the 16 `evaluation`-split ones) — they must be confirmed on the tuning/evaluation process (S03.07/S03.08) before being called tuned.
* Translated-leg numbers use my translations, not `command-a-translate`; real results for ps/prs/ur/romanized will be somewhat lower.
* The keyword boost only helps when there is English text (English questions or translated ones); place names in provider names
  (Overlea, Grenoble, Thorncliffe) can pull in wrong providers — consider stop-wording neighbourhood names.
* "Expected" provider lists are partial; some "false positives" are reasonable answers.
* Medical/gas/flood emergencies remain unflagged whatever the ranking.
* The emergency category mixes 911 services with shelters (M009, M010); any rule keyed on the category inherits that.

## 7. Files of the experiment (not committed)
`docs.json` (document texts as production builds them), `doc_vectors.json`, `query_vectors.json`, `rerank_cache.json`, `calls.log`
(every vendor call: model, count, status, ms — no keys), `experiment_set.jsonl`, `translations_proxy.json`, `legs.json` (production's
translated-leg routing per question), `cohere.py`, `common.py`, `questions.py`, `evalx.py` (arms + metrics), `sweep.py`, `frontier.py`,
`tables.py`, `make_report.py`.

## 8. Verification of the code as built (2026-10-07)

The recommended setting (R1b) is built in `src/modules/directory/domain/searchRanking.ts`, `searchKeywords.ts` and
`application/search.ts`, with its values as configuration (`SEARCH_THRESHOLD` 0.27, `SEARCH_KEYWORD_WEIGHT` 0.15,
`SEARCH_DIRECT_FLOOR` 0.24, `SEARCH_DIRECT_GAP` 0.10, `SEARCH_EMERGENCY_TOP_THRESHOLD` 0.14; `SEARCH_EMERGENCY_THRESHOLD` 0.25
kept for the top-3 fail-safe; docs/config.md). It was replayed with the vectors of sections 1 to 7, through the real search use
case (`createSearch`: language detection, the translated-leg routing, the ranking and the emergency flag), with no vendor call:

    node scripts/search-test-set/replay-cached.mjs --cache <vector-cache.json>

(the cache is the experiment's provider, question and translation vectors keyed by text; scripts/search-test-set/replayCached.ts
describes it). All 193 questions (n = 193; answerable 172, no-match 21, emergency 19):

| | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| before (production's ranking, threshold 0.30; section 4) | 48.3 | 50.6 | 85.7 | 42.1 | 1.1 | 3.6 |
| R1b as the experiment computed it (section 3) | 70.9 | 75.6 | 81.0 | 68.4 | 1.1 without the "emergency result" rule | 5.2 |
| **as built, replayed** | **70.9** | **75.6** | **81.0** | **68.4** | **1.1** | **5.2** |

By author: `dev-agent` (32) 86.7 / 90.0 / 100 / 100; `claude-draft` (161, the 22 new questions included) 67.6 / 72.5 / 78.9 / 64.7;
the 22 new questions alone 72.2 / 77.8 / 100 / 100. Per language the replay gives the R1b column of section 4.

How the build differs from the experiment's script, none of which moves a number here:
* "English" is decided by the use case's language detection (confident English; Latin text the detector cannot place, asked on an
  English page; or one or two plainly English words), not by the test set's `lang` field; a translation that comes back as the
  question itself counts as English.
* The top-3 fail-safe uses `SEARCH_EMERGENCY_THRESHOLD` (0.25, never above the release's threshold) on both routes; the
  experiment's direct arm used 0.24.
* The keyword index is built from the release's English listing file (name, category names, subcategories, services); the
  experiment read the same fields from `data/catalogue/providers.json`.
* A result's `score` is the score it was ranked by (similarity plus keyword boost on the hybrid route), to six places.
* `SEARCH_THRESHOLD` is recorded on each release: production keeps 0.30 until the next release is published.

## 9. Verification of R2 as built (2026-10-07): the reranker on the direct route

The product owner approved R2 after R1b shipped: for a question in another language that takes no translated leg (the direct route:
es, fr, zh, tl, ta, pa, bn, gu, hi, el, sk… in their own script), Cohere `rerank-v3.5` orders the 20 best providers by similarity,
reading the question and each provider's English search text (the text its vector was made from, rebuilt from the release's English
listing; the experiment's arm C read the same texts, `docs.json`). The results are the top 5 with a relevance of at least
`SEARCH_RERANK_MIN` (0.05), best relevance first, none when no provider reaches it. Each result's `score` stays its similarity. English
questions and translated-leg questions are never reranked, and `emergency_first` is still decided on the legs' similarities, so a rerank
cannot hide the 911 block. Built in `src/modules/directory/application/search.ts` (the step), `application/rerank.ts` (time and monthly
budget), `domain/searchRanking.ts` (`rerankCandidates`, `rerankedResults`), `domain/searchData.ts` (`searchTextsOfListing`) and
`adapters/cohereReranker.ts` (plain fetch, `src/platform/cohere/restClient.ts`); settings `SEARCH_RERANK` (on), `SEARCH_RERANK_MIN`
(0.05), `SEARCH_RERANK_MONTHLY_CALLS` (900), docs/config.md.

Budget and fallback: the call is made only when at least 0.3 s of the leg's 2.2 s is left after the embedding, and is cut at 1.2 s or at
the 2.2 s deadline, whichever comes first (the experiment measured p50 0.16 s, p99 1.25 s), so the answer still beats the 2.5 s limit.
Each call is a `spend_event` row (kind `rerank`, one call); the month's rows of the model (every purpose: the vendor's ~1,000 a month is
the key's) are counted beside the embedding, at most every 30 s per instance, and the instance adds its own calls in between; at 900 the
reranker is not called until the month ends. A 429 stops calls for 5 minutes. On a timeout, a vendor failure, a 429, the monthly limit or
too little time, the question is ranked by the floor and gap (R1b), silently for the resident; ops gets `search.leg_failed` with reason
`rerank_failed` (`timed_out`, `rerank_failed:limited`…) or `rerank_quota`, once a minute per reason and model, never the question.

Replayed through the real use case with the experiment's cached vectors and its cached `rerank-v3.5` answers (`rerank_cache.json`, keyed
by question; **no vendor call was made for this verification**):

    node scripts/search-test-set/replay-cached.mjs --cache <vector-cache.json> --rerank-cache <rerank-cache.json>

86 of the 193 questions took the direct route and were reranked; for every one of them the use case sent exactly the 20 providers the
experiment sent and answered exactly arm C's results. All 193 questions:

| | hit@3 | shown | no-match ok | emergency flag | emerg. false alarm | false-pos |
|---|---|---|---|---|---|---|
| R1b as built, replayed (section 8) | 70.9 | 75.6 | 81.0 | 68.4 | 1.1 | 5.2 |
| R2 as the experiment computed it (section 3) | 75.0 | 79.7 | 81.0 | 68.4 | — | 4.7 |
| **R2 as built, replayed** | **75.6** | **80.2** | **81.0** | **68.4** | **1.1** | **4.7** |

Per language, hit@3 (no-match accuracy unchanged in every language):

| lang | R1b as built | R2 experiment | **R2 as built** |
|---|---|---|---|
| en | 70.4 | 70 | 70.4 |
| ta | 33.3 | 56 | **55.6** |
| pa | 50.0 | 70 | **70.0** |
| gu | 77.8 | 89 | **88.9** |
| hi | 88.9 | 100 | **100.0** |
| es | 63.6 | 73 | **72.7** |
| fr | 62.5 | 75 | **75.0** |
| tl | 70.0 | 70 | 70.0 |
| sk | 66.7 | 67 | 66.7 |
| el | 55.6 | 56 | 55.6 |
| zh | 77.8 | 78 | 77.8 (shown 77.8 → 88.9) |
| bn | 60.0 | 50 | 60.0 |
| ur / ps / prs | 84.6 / 92.9 / 86.7 | 85 / 93 / 87 | unchanged (translated leg) |

The one difference from the experiment's R2 column: three romanized questions asked on a Gujarati or Bengali page (gu-04, bn-03, bn-06:
"free english class kothay") are confident English to the use case's detector, so they take the hybrid route and are not reranked;
the experiment routed them by the test set's `lang` field. bn-03 is a hit on the hybrid route, hence bn 60.0 against 50 and 75.6
overall against 75.0. False positives move from 5.2 to 4.7 overall (pa 27.3 → 18.2, fr and sk 10 → 0; zh and el 0 → 10, one question each).

Cost: 86 of 193 test questions (45%) would make one rerank call; at 900 calls a month the reranker covers about 900 direct-route
searches, after which those searches are ranked as in R1b until the month ends. **Interim**, as R1b: machine-drafted questions,
parameters chosen on the questions they are scored on; S03.08's ambassador questions confirm or revise `SEARCH_RERANK_MIN`. The search
test-set runner (S03.07 production runs, the S03.09 guard) does not rerank yet: its call plan and vendor meter count embedding and
translation calls only, so its direct-route numbers are R1b's until it is wired with the rerank model's own allowance.

## 10. Translate-first for languages the embedding model reads poorly (2026-10-07)

**Why.** After R2, live search still answered the Tamil "எனக்கு உணவு எங்கே கிடைக்கும்?" (where can I get food?) with four
daycares and a clinic (every similarity about 0.11; no food provider in the embedding's top 20, so the reranker cannot find one),
and the Tagalog "Saan ako makakakuha ng pagkain?" with EarlyON, the TNO Food Collaborative, a daycare, a mosque and TNO. The
question: does translating such a question to English first (the S03.05 translated-question leg, as for Pashto, Dari and Urdu:
both legs, best similarity per provider, the English keyword boost) beat embedding it as typed, with #158's reranker?

**How (offline, no production change).** Each test question the use case's detector reads confidently as one of these languages
was translated to English through production's own code: `cohereTranslator` (system prompt with the source language named,
temperature 0, 200 tokens), `normaliseTranslation` and `checkTranslation` (English, not too long). The model production routes a
native-script language to for `ur` is North Small Translate; on the experiment key (key 1, never production's) it answered HTTP 429
from the first call (its 1,000 calls a month on that key are spent), so **every translation was made by Command A Translate**
(`command-a-translate-08-2025`), which is also the model the defaults below route to. Romanized Tamil, Punjabi and Tagalog questions
already take the leg (`romanized_or_mixed`, Command A Translate) and are the same in both arms. The translations were embedded
(`embed-v4.0`, `search_query`, one batched call) and every question was replayed through the real `createSearch` with the cached
vectors and #158's cached rerank answers (as sections 8 and 9), arm (a) as on main and arm (b) with the language as a
translated-question kind. Arm (a) reproduces section 9 exactly (all 193: hit@3 75.6, shown 80.2, no-match 81.0, emergency 68.4).

Vendor calls (key 1): 116 translation calls, of which 25 answered (all Command A Translate) and 91 were refused with 429 (North
Small Translate every time; Command A Translate for about a minute after 19 calls: its per-minute limit, it answered again after a
pause); 1 embedding call (87 texts, 884 tokens); no rerank call.

**Decision rule (product owner):** translate-first for a language when (b) raises hit@3 by at least 10 points with no worse
no-match accuracy.

| lang | n | arm | hit@3 | shown | no-match ok | emergency | false-pos | qualifies |
|---|---|---|---|---|---|---|---|---|
| ta | 10 | (a) main (#158) | 55.6 | 55.6 | 0.0 | 0.0 | 10.0 | |
| ta | 10 | **(b) translate-first** | **88.9** | **88.9** | 0.0 | **100.0** | 10.0 | **yes** (+33.3) |
| pa | 11 | (a) main (#158) | 70.0 | 100.0 | 0.0 | 100.0 | 18.2 | |
| pa | 11 | **(b) translate-first** | **80.0** | 100.0 | 0.0 | 100.0 | 18.2 | **yes** (+10.0) |
| tl | 11 | (a) main (#158) | 70.0 | 70.0 | 100.0 | 0.0 | 0.0 | |
| tl | 11 | (b) translate-first | 80.0 | 90.0 | **0.0** | 0.0 | 18.2 | no: no-match worse |

Each language has 10 answerable questions and one no-match question, so one question is 10 points of hit@3 and 100 of no-match.
ta gains ta-01 (free dental), ta-03 (free food: M008, M071, M007 instead of daycares), ta-06 (rent) and the emergency flag on ta-07
(fire); pa gains pa-01 (free food for children); the no-match questions (ta-10 car repair, pa-10) show something in both arms. tl
gains tl-11 (Catholic church) and loses its no-match question: "saan pwede umupa ng trak para sa paglipat ng bahay" (rent a truck
for moving) becomes "where can you rent a truck for moving house", and the hybrid route shows four providers for it (M092 at 0.35),
where the direct route showed none. Turning tl on would also translate three questions in other languages that the detector reads
as Tagalog (prs-11, el-03, bn-05 — all three became hits).

**#158's rerank on top of translation** does not help: putting the direct leg's reranked results first and filling with arm (b)'s
gives ta 88.9, pa 70.0 (worse), tl 80.0; arm (b)'s results filled with the reranked ones gives exactly arm (b). So a translated
question is not reranked (the hybrid route, as for Pashto); a question whose translation fails, is refused at its limit or is
rejected takes today's route, the direct leg reranked.

The live examples, as arm (b) answers them (the three translate to "Where can I get food?"): M008, M071, M075, M007, M010, food
providers all (0.359 to 0.325). Production today (arm a, with the reranker): Tamil four daycares and a clinic, Tagalog EarlyON, TNO Food
Collaborative, a daycare, a mosque, TNO; Punjabi already food providers.

All 193 questions with Tamil and Punjabi translate-first (as built): hit@3 75.6 → 77.9, shown 80.2 → 82.0, no-match 81.0 (unchanged),
emergency flag 68.4 → 73.7, false positives 4.7 (unchanged); every other language unchanged.

**Nice to know (not built; hand-written translations, an upper bound).** With the translation budget spent, the other
languages' questions were translated by hand (as the experiment did for the original leg, section 1) and replayed the same way:

| lang | n | hit@3 (a → b) | no-match ok (a → b) | emergency (a → b) | false-pos (a → b) |
|---|---|---|---|---|---|
| bn | 11 | 60.0 → 100.0 | 100 → 100 | 100 → 100 | 0 → 0 |
| gu | 10 | 88.9 → 100.0 | 100 → 100 | 100 → 100 | 0 → 0 |
| el | 10 | 55.6 → 77.8 | 100 → 100 | 0 → 0 | 10 → 0 |
| zh | 10 | 77.8 → 100.0 | 100 → 100 | 100 → 100 | 10 → 0 |
| sk | 10 | 66.7 → 100.0 | 100 → 0 | 100 → 100 | 0 → 10 |
| hi | 11 | 100.0 → 100.0 | 100 → 100 | 100 → 100 | 0 → 0 |
| es | 12 | 72.7 → 63.6 | 100 → 0 | 50 → 50 | 0 → 16.7 |
| fr | 10 | 75.0 → 75.0 | 100 → 50 | 0 → 0 | 0 → 20 |

bn, gu, el and zh look like candidates; they need a run with the real model (a month with translation calls to spare on a key that
is not production's) before they are switched on, which is one `SEARCH_QUESTION_ROUTE` entry each (`bn=command-a-translate-08-2025`).
es and fr should stay direct: the embedding reads them well and translation costs no-match accuracy.

**As built.** The translate-first languages are kinds of the translated-question leg (`QUESTION_SOURCES` / `SEARCH_QUESTION_ROUTE`:
tl, gu, ta, el, sk, bn, hi, pa, zh, es, fr), translated only where the route names a model: by default `ta` and `pa` with Command A
Translate and **no fallback model** (North Small Translate's month on the production key is alert translation's, S04.02); the others
are off. A failed, refused (429), rejected or timed-out translation leaves the question on the direct route with the reranker, as
before; the translation is counted in `spend_event` (kind `translate`) like the other kinds' and in the S03.07 runner's call plan.

**Alert translation's reserve.** Command A Translate is also alert translation's model (S04.02's `translation_route`: first choice
for fr, es, zh, el and hi, second for prs; about 5–6 calls per alert entry), and Cohere allows each model about 1,000 calls a month
on a key. So translate-first questions have a gate of their own, `SEARCH_TRANSLATE_FIRST_MONTHLY_CALLS` (default 600): a Tamil or
Punjabi question is translated only while the model's translate calls this month, counted from `spend_event` for every purpose
(alert translation, search, test-set runs), are below 600 (the reranker's counting: one count per 30 s per instance plus the
instance's own calls; a count that fails means no call). Past it the question takes today's route and ops hears `translate_quota`
(`search_monthly_limit`). That leaves alerts at least ~400 calls a month (some 70 alert entries), less what the romanized and
ambiguous Arabic-script questions use: they were already on Command A Translate before this change and are not gated by it.

**Cost.** One Command A Translate call per Tamil or Punjabi search, until the model's month reaches 600. **Interim**, as the rest:
machine-drafted questions, ten per language.

## 11. Translate-first for Bengali, Greek and Chinese, measured with the real model (2026-10-07)

**Why.** Section 10 found bn, gu, el and zh promising only on hand-written translations (an upper bound): the experiment key's
translation month ran out before the real model could translate them. This run translates them with the model production would
use and applies the same decision rule.

**How (offline, no production change).** The 26 test questions the use case's detector routes to `bn`, `gu`, `el` or `zh`
(`questionSourceOf(detect(q, page language))`) were translated by Command A Translate (`command-a-translate-08-2025`, the model
`ta` and `pa` use) through production's question translator (`createQuestionTranslator` over `cohereTranslator`: the source
language named in the system prompt, temperature 0, `normaliseTranslation`, then `checkTranslation`'s English and length
checks), on the experiment key (key 1, never production's), paced at one call per 6.5 s. Every call answered and passed the
checks. The new English texts were embedded (`embed-v4.0`, `search_query`, one batched call) and all 193 questions replayed
through the real `createSearch` with the cached vectors and #158's cached rerank answers, as in section 10: arm (a) as on main
(`ta` and `pa` translate-first, the reranker on the direct route), arm (b) with `bn`, `gu`, `el` and `zh` also translated. Arm (a)
reproduces section 10's "as built" numbers exactly (all 193: hit@3 77.9, shown 82.0, no-match 81.0, emergency 73.7, false
positives 4.7).

The other questions written in these languages are not their own kind and are the same in both arms: romanized ones already take
the leg as `romanized_or_mixed` (gu-06, gu-08, gu-10, el-05, el-10, bn-10, zh-08), some are read as another language (el-03 and
bn-05 as Tagalog, bn-08 as French, bn-11 as Slovak) or as nothing confident (gu-04, el-08, bn-03, bn-06). No question written in
another language is routed to `bn`, `gu`, `el` or `zh`, so switching them on changes nothing elsewhere.

Vendor calls (key 1): 26 Command A Translate calls, all answered (no 429); 1 embedding call (18 texts, 206 tokens); no rerank
call; no North Small Translate call.

| lang | n | arm | hit@3 | shown | no-match ok | emergency | false-pos | qualifies |
|---|---|---|---|---|---|---|---|---|
| bn | 11 | (a) main | 60.0 | 60.0 | 100.0 | 100.0 | 0.0 | |
| bn | 11 | **(b) translate-first** | **70.0** | 70.0 | 100.0 | 100.0 | 0.0 | **yes** (+10.0) |
| gu | 10 | (a) main | 88.9 | 88.9 | 100.0 | 100.0 | 0.0 | |
| gu | 10 | (b) translate-first | 88.9 | 100.0 | 100.0 | 100.0 | 10.0 | no (+0.0) |
| el | 10 | (a) main | 55.6 | 66.7 | 100.0 | 0.0 | 10.0 | |
| el | 10 | **(b) translate-first** | **66.7** | 66.7 | 100.0 | 0.0 | 0.0 | **yes** (+11.1) |
| zh | 10 | (a) main | 77.8 | 88.9 | 100.0 | 100.0 | 10.0 | |
| zh | 10 | **(b) translate-first** | **100.0** | 100.0 | 100.0 | 100.0 | 0.0 | **yes** (+22.2) |

One question is 10 (bn, el, zh: 9 or 10 answerable) or 11.1 points of hit@3. bn gains bn-07 (a man threatening with a knife:
the police, M001, now shown, where nothing was; the emergency flag was already on); el gains el-07 ("English courses for adults":
M051 in the top 3, where (a) showed only unexpected providers); zh gains zh-06 (landlord eviction: legal aid, M022) and zh-07 (someone beating me downstairs: the police, M001,
instead of the fire service, (a)'s false positive). Every other changed question keeps its hit, mostly with the expected
providers higher. gu gains no hit: its one change is gu-07, "the landlord is evicting me", which the model turned into "What should
I do if the landlord vacates the house?" and the hybrid route answered with two unrelated providers (shown up, a false positive);
its no-match question (gu-09, a gold jewellery shop, translated as "the shop of Sonadagi Nani") shows nothing in both arms.
The real translations land below section 10's hand-written upper bound (bn 100, el 77.8, zh 100) because only the questions the
detector reads confidently as the language are translated.

**Decision (the product owner's rule: hit@3 up by at least 10 points, no-match accuracy no worse):** Bengali, Greek and Chinese
on, with Command A Translate and no fallback model, like Tamil and Punjabi; Gujarati stays direct.

All 193 questions with bn, el and zh on (as built): hit@3 77.9 → 80.2, shown 82.0 → 83.1, no-match 81.0 (unchanged), emergency
flag 73.7 (unchanged), false positives 4.7 → 3.6; every other language unchanged.

**The monthly reserve.** `SEARCH_TRANSLATE_FIRST_MONTHLY_CALLS` (600) counts every translate call of the model in the month,
alert translation's included, and only stops search: so adding languages cannot take alert translation below its ~400 calls; in a
busy month the translate-first questions only reach 600 sooner and are then searched directly (today's route). For a modest pilot
(a few hundred searches a month, of which Bengali, Greek and Chinese questions in their own script are a small share, say 30 to
100) the five translate-first languages together should stay well under 600 with alert translation's own use (5–6 calls an
alert entry) on top, so 600 stays. What still is not gated: romanized and ambiguous Arabic-script questions. Watch the model's
monthly `spend_event` count and `translate_quota` events in the first month.

**Cost.** One Command A Translate call per Bengali, Greek or Chinese search in its own script (as for Tamil and Punjabi), until the
model's month reaches 600. **Interim**, as the rest: machine-drafted questions, ten per language; S03.08's ambassador questions
confirm or revise the list.

## 12. Tagalog with real native-speaker questions (Amazon MASSIVE), and the Tagalog route decision (2026-10-07)

**Why.** Section 10 left Tagalog direct on one question: with one no-match question per language, the truck-rental question
showing four providers once translated made no-match accuracy 100 → 0. That was too thin to decide on. With the product owner's
approval, 42 Tagalog questions written by native speakers were added from Amazon's MASSIVE dataset (`tl-12` to `tl-53`, author
`massive-tl`, CC BY 4.0; the README's "Questions from public datasets" says what was chosen, how it was labelled and the
attribution). Tagalog now has 53 questions: 40 answerable (2 of them emergencies) and 13 no-match.

**How (offline, no production change).** The same method as sections 10 and 11. The detector (`questionSourceOf(detect(q, page
language))`) routes 57 texts to `tl`: all 53 Tagalog questions, the live "Saan ako makakakuha ng pagkain?", and three questions
written in other languages (prs-11, el-03 and bn-05, all romanized). The 42 new questions were translated by Command A Translate
(`command-a-translate-08-2025`) through production's question translator (`createQuestionTranslator` over `cohereTranslator`,
`normaliseTranslation`, `checkTranslation`), with no fallback model, on the experiment key (key 1), at no more than 5 calls a
minute. Every call answered and passed the checks. The 15 other texts reuse section 10's real Command A answers. The new questions
and their English were embedded (`embed-v4.0`, `search_query`). Because the new questions take the direct route on main, each
one's 20 candidates, exactly as the use case chose them, were sent once to `rerank-v3.5` (as #158 does) and cached. Every
question was then replayed through the real `createSearch` in two arms:

- (a) main after #160: `ta`, `pa`, `bn`, `el` and `zh` translate-first, Tagalog direct with the reranker.
- (b) the same, plus `tl` translate-first.

On the 193 earlier questions, arm (a) reproduces section 11's as-built hit@3 of 80.2.

Vendor calls (key 1 only): 42 Command A Translate calls, all answered (no 429); 2 embedding calls (42 questions with 685 tokens,
then 42 translations with 309 tokens); 42 `rerank-v3.5` calls. No North Small Translate call.

| set | n (answerable / no-match / emergency) | arm | hit@3 | shown | no-match ok | emergency flag | false alarm | false-pos |
|---|---|---|---|---|---|---|---|---|
| tl, all | 53 (40 / 13 / 2) | (a) main | 32.5 | 35.0 | **100.0** | 0.0 | 2.0 | 1.9 |
| tl, all | 53 (40 / 13 / 2) | (b) translate-first | **72.5** | 85.0 | 69.2 | 0.0 | 3.9 | 17.0 |
| tl, tuning subset | 48 (38 / 10 / 1) | (a) main | 31.6 | 34.2 | **100.0** | 0.0 | 2.1 | 2.1 |
| tl, tuning subset | 48 (38 / 10 / 1) | (b) translate-first | **73.7** | 86.8 | 70.0 | 0.0 | 4.3 | 16.7 |
| tl, MASSIVE only | 42 (30 / 12 / 1) | (a) main | 20.0 | 23.3 | **100.0** | 0.0 | 2.4 | 2.4 |
| tl, MASSIVE only | 42 (30 / 12 / 1) | (b) translate-first | **70.0** | 83.3 | 75.0 | 0.0 | 4.9 | 16.7 |
| tl, earlier 11 (section 10) | 11 (10 / 1 / 1) | (a) main | 70.0 | 70.0 | 100.0 | 0.0 | 0.0 | 0.0 |
| tl, earlier 11 (section 10) | 11 (10 / 1 / 1) | (b) translate-first | 80.0 | 90.0 | 0.0 | 0.0 | 0.0 | 18.2 |
| other languages routed to tl (prs-11, el-03, bn-05) | 3 (3 / 0 / 0) | (a) main | 0.0 | 0.0 | — | — | 0.0 | 0.0 |
| other languages routed to tl | 3 (3 / 0 / 0) | (b) translate-first | 100.0 | 100.0 | — | — | 33.3 | 0.0 |
| all 235 | 235 (202 / 33 / 20) | (a) main | 71.3 | 74.3 | 87.9 | 70.0 | 1.4 | 3.4 |
| all 235 | 235 (202 / 33 / 20) | (b) translate-first | 80.7 | 85.6 | 75.8 | 70.0 | 2.3 | 6.8 |

**What changes.**

- **Gains.** The real phrasings show that the direct route reads Tagalog poorly: arm (a) shows nothing for 26 of the 40 answerable
  questions. Translation gains 17 hits, among them the library questions, directions to the police, parks and a walking trail,
  swimming, the farmers' market, jobs, legal advice, health and climate. It loses one: tl-32, "free activities this weekend", gets
  M081, M033 and M068 instead of a community centre.
- **No-match losses.** It also shows something for 4 of the 13 no-match questions, where arm (a) showed nothing:
  - tl-10: the truck rental from section 10.
  - tl-43: "saan ang pinakamalapit na gasolinahan" ("where is the nearest gas station") gets the five fire stations, with the 911
    block first.
  - tl-47: a cat groomer (an evaluation question) gets M079 and M058.
  - tl-49: "play my music" gets the Aga Khan Museum.
- **Other languages.** The three questions from other languages that the detector reads as Tagalog all become hits, but prs-11
  also turns the 911 block on.
- **Emergencies.** Neither arm handles tl-41, "naaksidente ako sa sasakyan ngayon" ("I had a car accident today"): it gets no
  result and no 911 block either way. This is a separate emergency gap, noted for S03.07.

**Decision (the product owner's rule: hit@3 up by at least 10 points, no-match accuracy no worse): Tagalog stays direct.** Hit@3
rises by 40 points (42 on the tuning subset alone), but no-match accuracy falls from 100 to 69.2 (70.0 on the tuning subset).
Under the rule, the no-match drop decides it. No default changes. If the product owner weighs the 40-point gain above the no-match
losses, switching Tagalog on takes one `SEARCH_QUESTION_ROUTE` entry (`tl=command-a-translate-08-2025`) and no code change. Most of
the no-match losses are the hybrid route's threshold showing weak matches for translated questions, which S03.07's
no-match threshold could address for every translate-first language at once.

**Caveats.**

- **Labels unchecked.** Claude assigned the MASSIVE labels, and nobody who reads Tagalog has checked them.
- **Not resident questions.** The utterances are native-speaker localizations of voice-assistant requests, not questions residents
  asked.
- **Evaluation questions seen.** Four of the new questions went to the evaluation subset (tl-41, tl-47, tl-48, tl-52), and the
  "tl, all" rows include them. The decision is the same on the tuning subset alone, which is what this section relies on.

## 13. Crisis phrases: the 911 block for any question that describes an emergency (2026-10-07)

**Why.** `emergency_first` came only from the ranking: an emergency-category provider (police, the fire stations, crisis lines)
as a leg's best match at 0.14, or in its top 3 at 0.25. The catalogue has no ambulance or paramedic provider, so a question about
a medical emergency, a gas leak, a flood or a car accident had nothing to match: after section 12, with Tagalog translated first,
6 of the 20 emergency questions got no 911 block (en-08 "my dad collapsed and is not breathing", es-07, fr-07, el-06, tl-07 and
the Tagalog car accident tl-41). With every translation failing (a vendor outage, or a language past its month), 11 did.

**What was built (product owner's approval).** A pure, deterministic crisis-phrase check, `src/modules/directory/domain/crisisPhrases.ts`:
curated phrases for clear emergencies (someone not breathing, unconscious or collapsed; heart attack, stroke, choking, drowning,
severe bleeding, a stabbing or shooting, overdose or poisoning; suicide or self-harm intent; fire or smoke in a home; gas leak,
carbon monoxide; flood or water pouring in; car accident, hit by a car; assault, a weapon, a threat, a break-in; a missing child;
"call an ambulance / the police / 911") in English and every launch language: es, fr and sk as typed; Hindi with romanized
Hindi, Urdu, Punjabi and Gujarati; the native scripts of ur, prs, ps, bn, ta, pa, gu, el, zh and tl, the backstop for a failed
translation. The English lists are also read in the English translation (taken as soon as the translator answers). Ordinary
phrases are masked first ("gas station", "fire station", "police clearance / check / station / department", "first aid course",
"CPR class", "flood insurance / warning", "smoke detector", "accident insurance", "flu shot", each language's fire-service words);
"where is the hospital" alone is not an emergency (only a described emergency is). The check sets `emergency_first` and changes
nothing else; it never turns the flag off. `SEARCH_CRISIS_PHRASES=off` switches it off. The non-English lists are
**machine-assisted, to be checked by native readers** before launch (launch checklist, section 5).

**How it was measured (no vendor call).** Every one of the 235 questions through the real `createSearch` with the cached vectors,
section 10 to 12's real Command A Translate answers and #158's cached rerank answers, main's routes (ta, pa, bn, el, zh and tl
translated first); arm "before" with `crisisPhrases: false`, arm "after" with the default; then both again with every translation
failing. The "before" arm reproduces section 12's arm (b) exactly (hit@3 80.7, shown 85.6, no-match 75.8, emergency 70.0, false
alarm 2.3, false-pos 6.8).

| set | emergency questions with the 911 block, before → after | false alarms (other questions with it), before → after | the same with every translation failing: emergencies | false alarms |
|---|---|---|---|---|
| **all 235** | **14/20 → 20/20** (70.0% → 100%) | **5/215 → 5/215** (2.3%) | 9/20 → 20/20 | 2/215 → 2/215 |
| en | 3/4 → 4/4 | 1/28 → 1/28 | 3/4 → 4/4 | 1/28 → 1/28 |
| es | 1/2 → 2/2 | 0/10 → 0/10 | 1/2 → 2/2 | 0/10 |
| fr | 0/1 → 1/1 | 0/9 → 0/9 | 0/1 → 1/1 | 0/9 |
| el | 0/1 → 1/1 | 0/9 → 0/9 | 0/1 → 1/1 | 0/9 |
| tl | 0/2 → 2/2 | 2/51 → 2/51 | 0/2 → 2/2 | 1/51 → 1/51 |
| ur | 1/1 → 1/1 | 0/13 | 0/1 → 1/1 | 0/13 |
| prs | 1/1 → 1/1 | 1/15 → 1/15 | 0/1 → 1/1 | 0/15 |
| ps | 1/1 → 1/1 | 1/14 → 1/14 | 1/1 → 1/1 | 0/14 |
| gu | 1/1 → 1/1 | 0/9 | 0/1 → 1/1 | 0/9 |
| ta | 1/1 → 1/1 | 0/9 | 0/1 → 1/1 | 0/9 |
| hi | 1/1 → 1/1 | 0/10 | 0/1 → 1/1 | 0/10 |
| sk, bn, pa, zh | 1/1 → 1/1 each | 0 each | 1/1 → 1/1 each | 0 each |

Hit@3, results shown, no-match accuracy and false positives are unchanged (the results are not touched).

**False alarms.** The check adds none: no non-emergency question, nor its translation, matches a phrase. The five that remain are
the ranking's, unchanged: en-17 (a teenager who "needs counselling": the crisis lines), ps-09 (an eviction), prs-11 (a romanized
Dari question), tl-16 ("directions to the police department") and tl-43, MASSIVE's "nearest gas station", whose English
translation makes the five fire stations the best match. A phrase cannot remove a flag the ranking set: the check only adds.

**Proposal, not built (for the product owner).** Let a masked ordinary phrase turn the *ranking's* flag off when no crisis phrase is
found: a question that says "gas station", "fire station", "police station / department" or "police check" and describes no
emergency would not get the 911 block from a fire station or police provider at the top. Measured on the same replay: false
alarms 5 → 3 of 215 (tl-16 and tl-43 lose the block), no emergency question loses it (all 20 are found by their phrases). It
weakens a safety rule (owner decision 41's fail-safe) on the words of a mask list, so it is left for the product owner to decide.

**Remaining misses.** None in the test set. **Caveats.** The phrases were written knowing these 20 emergency questions, so 20/20
is an upper bound; `crisisPhrases.test.ts` holds about forty hand-written questions per major language group (emergencies, and
ordinary questions close to an emergency word: gas station, fire station, police clearance, first aid course, smoke detector,
flood insurance, "where is the hospital") and every phrase was also run over the catalogue's own texts in all languages to find
words of one language that are ordinary in another (Slovak "ambulancia" is a clinic; "horí" is not "horizons"; the fire-service
words of each language are masked). The non-English lists and examples are machine-assisted and wait for native readers.
S03.08's ambassador questions are the real measure.

## 14. The English-class concept and language lists in the keyword match (production UAT, 2026-10-08)

**Why.** On production, "where can I learn english" answered five childcare centres, schools and a trades programme (M040, M032,
M033, M027, M080) and missed the Afghan Women's Organization (M051, "women-only LINC English classes") and Saint John XXIII
(M028, "offering ESL"). The keyword index already reads the services text, but it could not help: "english" is in many listings
as the language a service is offered in ("Care offered in English, Spanish, Gujarati and Ukrainian", "Multilingual staff
(English, Arabic, …)"), so M040 got the same boost as M051; "ESL", "LINC" and "language training" share no word with the
question; and "classes" was stemmed to "classe", which never matched "class".

**What was built** (`src/modules/directory/domain/searchKeywords.ts`, pure, no model):
- a language name in a list of two or more language names is not a keyword (it says what language the help is in);
- a *concept*: one more token found by phrase in the question and the listing alike. The one concept is learning English
  (questions: "learn / study / practise / improve / speak English", "English class / lessons / course / school / tutor /
  conversation", "ESL", "LINC", "language class / training"; listings: the same phrases, not another language's "Japanese
  language classes", and not a clause that says it is not offered: "no French immersion, ESL, or special education programs").
  A provider that holds a concept the question names gets the keyword weight once more, so the keyword match adds at most
  twice `SEARCH_KEYWORD_WEIGHT` (0.30 by default);
- "-sses" plurals keep their "ss" ("classes" is "class").

**Measured** offline with the cached vectors and rerank answers (no vendor call), all 235 questions, production's defaults
(translate-first ta, pa, bn, el, zh, tl; rerank on the direct route; crisis phrases on):

| | hit@3 | shown | no-match ok | emergency flag | false alarm | false positives |
|---|---|---|---|---|---|---|
| before | 80.7 | 85.6 | 75.8 | 100.0 | 2.3 | 6.8 |
| after | **81.2** | 85.6 | 75.8 | 100.0 | 2.3 | **6.4** |

One hit gained, none lost: pa-09 ("english sikhan di class kithe hundi aa", translated "Where are English classes held?") now
shows M027, M051, M028 first instead of M090, M069, M040. pa-04 (daycare) no longer shows a provider none of whose listings is
expected (false positive). The other English-class questions (ur-07, ps-07, prs-05, gu-04, el-07, bn-06, zh-08) already had
M051 first and now show M049 and M007 (TNO's "language training") and the ESL schools after it, instead of a Quran school, a
Japanese cultural centre and a midwife clinic.

**The UAT question itself** is not in the cache, so it cannot be replayed. Its production scores bound it: M051's similarity was
below 0.219 (its score was under the fifth result's 0.292 with a 0.073 boost); it now gets 0.227 of keyword boost. The childcare
centres that led lose their boost or never had one (M040 0.280, M032 0.317, M033 about 0.30), so M051 is above all of them
unless its similarity is below about 0.09; what it now shares the first places with is the other English-class listings (M027 and
M028 with ESL, M049 and M007 with language training), which is the answer the question wants.
Three cached English questions of the same need: "Where can I learn English for free?" M051 first (0.540, then M049, M007);
"English classes for adults" and "English courses for adults" M051 in the top two.
