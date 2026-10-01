# Import: user hands-on test, Pashto and Dari translation (2026-10-01)

Source: product owner (Luis), tested in the model dropdown; screenshots saved by the user (not available in this workspace).
Method: one English hospital sentence ("Where is the nearest hospital? My child is sick." or equivalent) sent to four models; Pashto judged from the tester's own knowledge.

| Model | Pashto | Dari |
|---|---|---|
| north-small-translate-09-2026 | Good: correct "where" (چېرته) and "sick" (ناروغ); "نژدې تر نژدې" for "nearest" slightly awkward | Good: نزدیکترین بیمارستان کجاست؟ کودکم بیمار است |
| Command A+ | Poor: a non-word and the wrong word for "where" | Good |
| Command A Translate | Failed: output labelled Pashto was actually Dari | Good |
| Aya Expanse 32B | Poor, garbled | Understandable, word order off |

Tester's notes: North Small Translate does not list Pashto among its 50 languages but was the only model to produce real Pashto, and the only dropdown model to handle both languages on this sentence.

Limits: one sentence; one reviewer; no native-speaker review recorded for Dari; screenshots not inspected by the research run.
