#!/usr/bin/env python3
"""Back-translation check: catch translations whose meaning drifted from the English.

Two calls per text, both to Command A (a different model from the one that translated):
1. Blind back-translation: the translation alone, back into English, literally. The model
   does not see the original, because when it did it read errors as what was meant.
2. Comparison: the English original against the back-translation, listing differences
   that would mislead a resident. Comparing two English texts is reliable; reading Pashto
   is not, so this catches many errors but not all (it read 'lighting a fire' as 'fire').

Reads  data/catalogue/translations/<lang>.json
Writes data/catalogue/review/backtranslation-<lang>.json
Major problems are picked up by scripts/review_translations.py as 'redo', minor as 'review'.

  python3 scripts/backtranslate_check.py --langs ps,prs
"""
import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from translate_catalogue import api_key, chat, TRANSLATIONS_DIR  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REVIEW_DIR = ROOT / 'data/catalogue/review'
JUDGE = 'command-a-03-2025'

BACK = ('Translate the user message into English as literally as possible, word for word where '
        'you can. Keep any errors or odd wording; do not fix or guess what was meant. Reply with '
        'the translation only.')

COMPARE = (
    'You check translations for a community services directory. The user message has an English '
    'original and an English back-translation of its translation. List only differences that would '
    'mislead a resident: wrong facts, services, people, times, days, frequencies, numbers, prices '
    'or addresses; opposite or changed meaning; information missing or added. Ignore style, word '
    'choice and word order, and expect the back-translation to be clumsy.\n'
    'Reply with JSON only: {"problems": ["..."], "severity": "none" | "minor" | "major"}. '
    'major = a resident would be misled about what the place offers, when, for whom, or how to '
    'reach it.'
)


def check_one(key, lang, source, text):
    back = chat(key, JUDGE, BACK, text)
    raw = chat(key, JUDGE, COMPARE, f'Original:\n{source}\n\nBack-translation:\n{back}')
    raw = raw.strip().removeprefix('```json').removeprefix('```').removesuffix('```').strip()
    try:
        out = json.loads(raw)
    except json.JSONDecodeError:
        out = {'severity': 'unknown', 'problems': ['comparison reply was not JSON: ' + raw[:300]]}
    if out.get('severity') not in ('none', 'minor', 'major'):
        out['severity'] = 'unknown'
    out['backTranslation'] = back
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--langs', required=True)
    ap.add_argument('--workers', type=int, default=3)
    ap.add_argument('--key-var', default='COHERE_API_KEY', help='name of the API key variable in .env')
    args = ap.parse_args()
    key = api_key(args.key_var)
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)

    for lang in args.langs.split(','):
        texts = json.loads((TRANSLATIONS_DIR / f'{lang}.json').read_text(encoding='utf-8'))['texts']
        path = REVIEW_DIR / f'backtranslation-{lang}.json'
        results = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
        # Keep a cached result only if it was for the same translation.
        results = {k: v for k, v in results.items() if k in texts and v.get('text') == texts[k]['text']}
        todo = [k for k in texts if k not in results]
        print(f'{lang}: {len(results)} cached, {len(todo)} to check')

        def work(k):
            t = texts[k]
            try:
                r = check_one(key, lang, t['source'], t['text'])
            except Exception as e:  # keep going; the item is retried next run
                return k, None, str(e)
            return k, dict(r, source=t['source'], text=t['text'], model=t['model']), None

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for i, (k, r, err) in enumerate(pool.map(work, todo), 1):
                if r:
                    results[k] = r
                else:
                    print(f'  {lang} {k}: {err}')
                if i % 20 == 0:
                    path.write_text(json.dumps(results, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
                    print(f'  {lang}: {i}/{len(todo)}')
        path.write_text(json.dumps(results, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
        counts = {s: sum(1 for r in results.values() if r['severity'] == s) for s in ('none', 'minor', 'major', 'unknown')}
        print(f'  {lang}: done {counts}')


if __name__ == '__main__':
    main()
