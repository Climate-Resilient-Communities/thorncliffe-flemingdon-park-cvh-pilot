# The search test set

Questions residents might ask, each with the providers that answer it, used to measure search (E03). The format is S03.01's
(`src/contracts/searchTestSet.ts`); the launch set, the evaluation split and the launch bar are S03.08's
(`src/contracts/searchTestSetLaunch.ts`). All commands are `npm run search-test-set -- <command>`.

| File | What it is |
| --- | --- |
| `questions.jsonl` | One question per line. Never holds personal data. |
| `template.csv` | The sheet ambassadors fill in (open it in Excel or Google Sheets). |
| `subsets.json` | Which questions are in the tuning subset and which in the evaluation subset, drawn by a committed seed. |
| `bar.json` | The Hub-approved launch bar. Committed unapproved (`approvedBy` null, no minimums) until the Hub sets it. |
| `reports/` | Reports of runs (`run`, S03.01 and S03.07), and the interim tuning of 2026-10-07 (`2026-10-07-interim-tuning.md`). |

## For ambassadors: filling in the template

Open `template.csv` in Excel or Google Sheets. Keep the header row as it is. The second row is an example; rows that start with
`#` are skipped, so you can leave it. Add one question per row:

| Column | What to write |
| --- | --- |
| `id` | Leave empty. The import numbers it (`ur-15`, `ur-16` ...). |
| `lang` | The language the question is written in: `en`, `ur`, `ps`, `tl`, `prs`, `gu`, `ta`, `el`, `sk`, `bn`, `hi`, `pa`, `zh`, `es`, `fr`. |
| `page_lang` | Usually empty. Only if the resident would ask from a page in another language (for example a romanized Urdu question asked from the English page: `en`). |
| `question` | The question as a resident would type it, at most 200 characters. Spelling mistakes and mixed languages are welcome. **No names, phone numbers, email addresses, unit or apartment numbers**, real or made up: the import refuses those rows. |
| `form` | `native` (the language's own script), `romanized` (in Latin letters, for example Urdu written as "khana kahan milega"), or `mixed` (two languages mixed, for example Hinglish: "Mujhe nearby free dental clinic batao"). |
| `intent` | `normal`; `emergency` (the resident needs help now: fire, police, ambulance, a crisis line); or `no_match` (something the directory does not have, for example a hotel). |
| `expected` | The ids of the providers that answer the question (from the catalogue, for example `M008 M071`), separated by spaces. Empty only for `no_match`. If you do not know the ids, leave it empty and the team fills it in before the import. |
| `author` | Your initials or handle (2 to 32 letters or digits, no real name). |
| `added` | Today, as `YYYY-MM-DD`. |
| `checked_by`, `checked_on` | Empty. A second person who reads the language fills these in after checking the question and the providers. |

What the set needs before launch (about 150 questions): **at least 10 questions in every language**, and overall at least
**5 romanized Urdu**, **3 Hinglish** (Hindi, `mixed`), **10 emergency** and **10 no-match** questions. Machine drafts (author
`claude-draft`) do not count. Save the sheet as **CSV UTF-8** (Excel: File > Save As > "CSV UTF-8 (comma delimited)"; Google Sheets:
File > Download > "Comma-separated values"). An `.xlsx` file is not read.

## For the team: importing

1. `npm run search-test-set -- import sheet.csv --dry-run` checks every row and writes nothing. A row is refused when it fails the
   format, names a provider not in the catalogue, repeats an id or a question already in the set, holds personal data (a phone
   number, email address, or unit or apartment number, found by pattern, in any script's digits), or has no expected provider and
   is not `no_match`. Rows missing an expected provider are listed on their own line.
2. Fix the refused rows in the sheet (or ask the ambassador), then `npm run search-test-set -- import sheet.csv`. With any refused row
   nothing is written; `--skip-refused` imports the other rows.
3. The import appends the questions to `questions.jsonl` and gives each new one its subset (below). Commit `questions.jsonl` and
   `subsets.json` together, never the sheet itself.
4. `npm run search-test-set -- coverage` names every gap against the launch numbers and the evaluation subset's (4 per language,
   4 emergency, 4 no-match). It prints "Launch readiness (coverage): not met" and the gaps, and exits 0; `--launch` (or
   `SEARCH_TEST_SET_LAUNCH=1`) makes a gap exit 1. CI prints the same status in `npm test`
   (`test/search-test-set-launch.test.ts`) and stays green until launch mode is turned on.

## The evaluation split

The evaluation subset is acceptance evidence and is never used for tuning. `npm run search-test-set -- assign` (run by `import`)
gives every question not yet in `subsets.json` its subset:

1. A question already in `subsets.json` keeps its subset forever. A tuning question has been used for tuning and can never become
   evidence; an evaluation question stays evidence. A question deleted from the set leaves `subsets.json`.
2. New questions are taken in the order of sha256("{seed}:{id}") with the committed seed (`20261006`), so the draw is random but
   the same every time.
3. In that order they go to evaluation while it holds fewer than 4 emergency questions, then 4 no-match, then, language by
   language, 4 questions of each language. Machine drafts (`claude-draft`) never go to evaluation.
4. Every other new question goes to tuning.

The same questions, seed and `subsets.json` always give the same file. `questions.jsonl` repeats each question's subset in its
`split` field; `validate` fails when the two disagree. The first `subsets.json` was written with `assign --adopt-splits` from the
splits the S03.01 starter set already had (16 evaluation questions, chosen by the team before any run); the seed applies from then on.

## For the Hub: tune, evaluate, set the bar

Each run uses Cohere calls from a monthly allowance shared with live search: check the month first (see `docs/config.md`,
"Search test set").

1. **Tune.** With the full set imported, run the tuning subset with the chosen model and both legs (the "Search test set" workflow,
   or `run --engine production ... --translated-leg both`). Confirm or revise the model, leg and no-match threshold on the tuning
   report only (S03.07's rule: the threshold that keeps every tuning no-match question below it while losing the fewest hits).
   Commit the report.
2. **Evaluate, once.** With the final model, leg and threshold, run the evaluation subset once (`run ... --split evaluation --final`
   with an engine for the deployment being measured) and commit the report. Do not tune again on what it shows. The production
   runner (`--engine production` and the "Search test set" workflow) still refuses the evaluation subset on purpose: that is lifted
   for this one run in its own change, or the run uses S03.09's preview runner.
3. **Set the bar.** From that first full evaluation report, the Hub agrees a minimum for each language's hit rate (top 3), the
   no-match accuracy and the emergency accuracy, and records them in `bar.json` with who approved them (a role, for example
   `"Hub Director"`) and the date, in a pull request:

   ```json
   {
     "version": 1,
     "approvedBy": "Hub Director",
     "approvedOn": "2026-11-02",
     "minimums": {
       "hitRate": { "en": 0.8, "ur": 0.7, "ps": 0.6, "...": 0.7 },
       "noMatchAccuracy": 0.8,
       "emergencyAccuracy": 0.95
     }
   }
   ```

   Rates are shares from 0 to 1. An approved bar names every launch language.
4. **Launch readiness.** `npm run search-test-set -- readiness` checks the latest report that ran the evaluation subset against
   the bar: met only when the bar is approved and every minimum is met; otherwise it names each measure and how far below it is.
   A language whose first measurement is below what the Hub would accept goes on the launch-readiness checklist with its action
   and owner (for example more catalogue review, or a different question route).

The bar has one reader, `scripts/search-test-set/bar.ts`: `readBarFile(root)` and `meetsBar(report, file)` for launch readiness, and `readBar(root, file?)` / `checkBar(bar, subset)` for S03.09's guard, all through `BarSchema`. (The guard's workflow also peeks at the base branch's file in `scripts/ci/search-guard-scope.sh`, only to decide whether to measure at all.)

## Replaying with cached vectors (no vendor call)

`node scripts/search-test-set/replay-cached.mjs --cache <vector-cache.json>` asks every question of `questions.jsonl` through the
real search use case (language detection, the translated-leg routing, the ranking, the emergency flag, and the `SEARCH_*`
settings of the environment) with vectors embedded earlier, and prints hit@3, results shown, no-match accuracy and emergency
accuracy overall, by author and by language. It calls no model, so a ranking change can be measured for free; the cache (never
committed) holds each provider's and each question's vector, and the English translations that stand in for the translated leg
(an upper bound). `scripts/search-test-set/replayCached.ts` describes its shape; the interim tuning report used it.
