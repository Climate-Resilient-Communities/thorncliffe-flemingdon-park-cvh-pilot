#!/usr/bin/env python3
"""Apply hand corrections to the catalogue translations.

Reads  data/catalogue/review/corrections-<lang>.json
       {"corrections": [{"id": ..., "source": <English>, "text": <corrected translation>, "note": ...}]}
Writes data/catalogue/translations/<lang>.json, then rebuilds providers.json

A correction applies only while the English is unchanged, so an edit to the spreadsheet
sends the text back for a fresh translation. The machine translation it replaces is kept
under "correctedFrom", and the text is marked model "claude-correction" so a native
reader can see what was changed by hand.

  python3 scripts/apply_corrections.py              # every corrections file
  python3 scripts/apply_corrections.py --langs es,fr
  python3 scripts/apply_corrections.py --content    # guides and numbers (S02.09)

With --content the corrections are review/content-corrections-<lang>.json, keyed by the text
keys of scripts/content_catalogue.py (guide.power.when911, number.911.label, ...). A corrected
text goes back to status "machine" (its earlier review no longer covers it), so a native reader
reviews the correction before it can be loaded; zh-Hant is converted again from the new zh.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from translate_catalogue import check, missing_numbers, to_western, TRANSLATIONS_DIR  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
REVIEW_DIR = ROOT / 'data/catalogue/review'
CORRECTOR = 'claude-correction'


def apply_content_corrections(langs):
    import content_catalogue as cc

    texts = cc.content_texts()
    for path in sorted(cc.REVIEW_DIR.glob('content-corrections-*.json')):
        lang = path.stem.removeprefix('content-corrections-')
        if langs and lang not in langs:
            continue
        if lang not in cc.MODEL_LANGS:
            print(f'{lang}: corrections apply to translated languages only (zh-Hant follows zh)')
            continue
        data = cc.load_content(lang, texts)
        applied, stale, rejected = 0, 0, []
        for c in json.loads(path.read_text(encoding='utf-8'))['corrections']:
            current = data['texts'].get(c['id'])
            if not current or current['source'] != c['source'] or texts.get(c['id']) != c['source']:
                stale += 1  # English changed (or no translation) since the correction was written
                continue
            text = to_western(c['text'].strip())
            problems = check(lang, c['source'], text) + \
                [f'number missing: {n}' for n in missing_numbers(c['source'], text)]
            if problems:
                rejected.append(f'{c["id"]}: {"; ".join(problems)}')
                continue
            if current['model'] == CORRECTOR and current['text'] == text:
                continue
            original = current.get('correctedFrom') or {'text': current['text'], 'model': current['model']}
            record = cc.new_record(c['source'], text, CORRECTOR)
            record.update(note=c.get('note', ''), correctedFrom=original)
            data['texts'][c['id']] = record
            data['failed'].pop(c['id'], None)
            applied += 1
        cc.save_content(lang, data)
        print(f'{lang}: applied {applied}, skipped {stale} (English changed), rejected {len(rejected)}')
        for r in rejected:
            print(f'  rejected {r}')
    changed, kept, missing = cc.convert_zh_hant(texts)
    print(f'zh-Hant: {changed} converted from zh, {kept} unchanged, {missing} null')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--langs', help='comma-separated language codes (default: every corrections file)')
    ap.add_argument('--content', action='store_true', help='apply corrections to the guides and essential numbers')
    args = ap.parse_args()
    if args.content:
        return apply_content_corrections(set(args.langs.split(',')) if args.langs else None)
    paths = sorted(REVIEW_DIR.glob('corrections-*.json'))
    if args.langs:
        wanted = set(args.langs.split(','))
        paths = [p for p in paths if p.stem.removeprefix('corrections-') in wanted]

    for path in paths:
        lang = path.stem.removeprefix('corrections-')
        tpath = TRANSLATIONS_DIR / f'{lang}.json'
        data = json.loads(tpath.read_text(encoding='utf-8'))
        applied, stale, rejected = 0, 0, []
        for c in json.loads(path.read_text(encoding='utf-8'))['corrections']:
            current = data['texts'].get(c['id'])
            if not current or current['source'] != c['source']:
                stale += 1  # English changed since the correction was written
                continue
            text = to_western(c['text'].strip())
            problems = check(lang, c['source'], text)
            if problems:
                rejected.append(f'{c["id"]}: {"; ".join(problems)}')
                continue
            if current.get('model') == CORRECTOR and current['text'] == text:
                continue
            original = current.get('correctedFrom') or {'text': current['text'], 'model': current['model']}
            data['texts'][c['id']] = {'source': c['source'], 'text': text, 'model': CORRECTOR,
                                      'note': c.get('note', ''), 'correctedFrom': original}
            data.get('failed', {}).pop(c['id'], None)
            applied += 1
        tpath.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
        print(f'{lang}: applied {applied}, skipped {stale} (English changed), rejected {len(rejected)}')
        for r in rejected:
            print(f'  rejected {r}')

    subprocess.run([sys.executable, str(ROOT / 'scripts/build_catalogue.py')], check=True)


if __name__ == '__main__':
    main()
