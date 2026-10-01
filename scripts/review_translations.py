#!/usr/bin/env python3
"""Review the catalogue translations and write an error list.

Reads  data/catalogue/translations/<lang>.json, data/catalogue/review/manual-findings.json
       data/catalogue/review/backtranslation-<lang>.json (scripts/backtranslate_check.py)
       and data/catalogue/review/line-review-<lang>.json (line-by-line reading, one per language)
Writes data/catalogue/review/translation-errors.md (for people)
       data/catalogue/review/translation-errors.json (for scripts/translate_catalogue.py --redo)

Severity:
  redo    the translation is missing, wrong, or lost something a resident needs exactly
          (a phone number, 911, a price, an address, a web or email address)
  fix     mechanical problem that can be corrected without a new translation
  review  passed the checks but needs a native reader first (fallback model, manual note)

  python3 scripts/review_translations.py              # all languages with a file
  python3 scripts/review_translations.py --langs ur,ps
  python3 scripts/review_translations.py --fix-digits # convert non-Western digits in place
"""
import argparse
import json
import re
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRANSLATIONS_DIR = ROOT / 'data/catalogue/translations'
REVIEW_DIR = ROOT / 'data/catalogue/review'
MANUAL = REVIEW_DIR / 'manual-findings.json'

NAMES = {'ur': 'Urdu', 'ps': 'Pashto', 'tl': 'Tagalog', 'prs': 'Dari', 'gu': 'Gujarati', 'ta': 'Tamil',
         'el': 'Greek', 'sk': 'Slovak', 'bn': 'Bengali', 'hi': 'Hindi', 'pa': 'Punjabi', 'zh': 'Mandarin',
         'es': 'Spanish', 'fr': 'French'}
NON_LATIN = {'ur', 'ps', 'prs', 'gu', 'ta', 'el', 'bn', 'hi', 'pa', 'zh'}
FIRST_CHOICE = {'ps': 'north-small-translate-09-2026', 'prs': 'north-small-translate-09-2026',
                'fr': 'command-a-translate-08-2025', 'es': 'command-a-translate-08-2025',
                'zh': 'command-a-translate-08-2025', 'el': 'command-a-translate-08-2025',
                'hi': 'command-a-translate-08-2025', 'gu': 'tiny-aya-fire'}
FALLBACK_NOTES = {
    ('prs', 'command-a-translate-08-2025'): 'Command A Translate fallback: likely Iranian Farsi wording, not Dari',
    'tiny-aya-fire': 'Tiny Aya fallback: this model often answered instead of translating',
    'tiny-aya-water': 'Tiny Aya fallback: this model often answered instead of translating',
}

# Things a resident needs letter for letter.
CRITICAL = [
    ('phone number', r'(?:\+?1[-\s])?\(?\d{3}\)?[-\s.]?\d{3}[-\s.]\d{4}(?:\s*(?:ext\.?|x)\s*\d+)?'),
    ('emergency number', r'\b(?:911|311|211|988)\b'),
    ('price', r'\$\s?\d+(?:\.\d{2})?'),
    ('postal code', r'\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b'),
    ('email', r'[\w.+-]+@[\w-]+\.[\w.]+'),
    ('web address', r'\b(?:https?://|www\.)[^\s,;)]+|\b[\w-]+\.(?:ca|com|org|net)\b(?:/[^\s,;)]*)?'),
]


def to_western(text):
    return ''.join(str(unicodedata.decimal(c)) if c.isdecimal() and not '0' <= c <= '9' else c for c in text)


def digits_only(s):
    return re.sub(r'\D', '', s)


def missing_critical(source, text):
    """Critical items in the English that do not survive in the translation."""
    flat = text.lower().replace('‏', '').replace('‎', '')
    flat_digits = digits_only(to_western(text))
    lost = []
    for kind, pattern in CRITICAL:
        for m in re.finditer(pattern, source, re.I):
            item = m.group(0).rstrip('.')
            if kind in ('phone number', 'emergency number', 'price'):
                ok = digits_only(item) in flat_digits  # spacing and dashes may change
            else:
                ok = item.lower().replace(' ', '') in flat.replace(' ', '')
            if not ok:
                lost.append(f'{kind} {item}')
    return sorted(set(lost))


def latin_share(text, source=''):
    """Share of Latin letters, not counting words copied from the English (names, addresses)."""
    source_words = set(re.findall(r'[A-Za-z][\w\'-]*', source))
    text = ' '.join(w for w in re.split(r'\s+', text) if re.sub(r'[^\w\'-]', '', w) not in source_words)
    letters = [c for c in text if c.isalpha()]
    return sum(1 for c in letters if c.isascii()) / max(len(letters), 1)


def review_language(lang, data, manual):
    issues = []

    def add(severity, key, source, problem, text=None, model=None):
        issues.append({'lang': lang, 'id': key, 'severity': severity, 'problem': problem,
                       'source': source, 'text': text, 'model': model})

    for key, f in data.get('failed', {}).items():
        reasons = '; '.join(a.split(': ', 1)[-1] for a in f['attempts']) or 'no model attempted'
        transient = all('gave up' in a or 'HTTP 5' in a for a in f['attempts'])
        add('redo', key, f['source'], ('API errors, retry as is' if transient else 'every model failed: ') +
            ('' if transient else reasons))

    for key, t in data['texts'].items():
        src, out, model = t['source'], t['text'], t['model']
        lost = missing_critical(src, out)
        if lost:
            add('redo', key, src, 'lost or changed: ' + ', '.join(lost), out, model)
        if any(c.isdecimal() and not '0' <= c <= '9' for c in out):
            add('fix', key, src, 'non-Western digits (run --fix-digits)', out, model)
        # Most of a description left in English (names and addresses stay English, so allow some).
        if lang in NON_LATIN and len(src) > 80 and latin_share(out, src) > 0.4:
            add('redo', key, src, f'{latin_share(out, src):.0%} of translated letters still Latin: partly untranslated', out, model)
        ratio = len(out) / max(len(src), 1)
        if len(src) > 80 and (ratio > 2.0 or ratio < (0.2 if lang == 'zh' else 0.5)):
            add('review', key, src, f'length {ratio:.1f}x the English: check nothing was added or dropped', out, model)
        note = FALLBACK_NOTES.get((lang, model)) or FALLBACK_NOTES.get(model)
        if model == 'claude-correction':
            add('review', key, src, 'hand-corrected by Claude (not a native speaker): check the correction. '
                + t.get('note', ''), out, model)
        elif note:
            add('review', key, src, note, out, model)
        elif FIRST_CHOICE.get(lang, 'north-small-translate-09-2026') != model:
            add('review', key, src, f'second-choice model {model} used', out, model)

    back_path = REVIEW_DIR / f'backtranslation-{lang}.json'
    back = json.loads(back_path.read_text(encoding='utf-8')) if back_path.exists() else {}
    for key, r in back.items():
        t = data['texts'].get(key)
        if not t or t['text'] != r.get('text') or r['severity'] in ('none',):
            continue  # the translation changed since it was checked, or no problem
        # About half of the 'major' flags are the back-translation misreading a correct text
        # (checked by hand on Pashto), so they go to a native reader, marked high priority.
        label = 'HIGH PRIORITY back-translation check' if r['severity'] == 'major' else 'back-translation check'
        add('review', key, t['source'], f'{label} ({r["severity"]}): ' + '; '.join(r.get('problems', [])),
            t['text'], t['model'])

    for m in manual.get(lang, []):
        t = data['texts'].get(m['id'], {})
        if not t:
            continue  # that text no longer exists (its English changed)
        if m.get('reviewedText') and t.get('text') != m['reviewedText']:
            continue  # retranslated since this note was written
        add(m['severity'], m['id'], t.get('source', m.get('source', '')), 'manual review: ' + m['problem'],
            t.get('text'), t.get('model'))
    return issues


def write_reports(issues, langs, totals):
    REVIEW_DIR.mkdir(parents=True, exist_ok=True)
    order = {'redo': 0, 'fix': 1, 'review': 2}
    issues.sort(key=lambda i: (order[i['severity']], not i['problem'].startswith(('HIGH', 'manual')), i['lang'], i['problem']))
    (REVIEW_DIR / 'translation-errors.json').write_text(
        json.dumps(issues, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    lines = ['# Catalogue translation errors', '',
             'Generated by `scripts/review_translations.py`. **redo**: translate again. '
             '**fix**: mechanical correction, no new translation. **review**: needs a native reader.', '',
             '| Language | Translated | redo | fix | review |', '|---|---|---|---|---|']
    for lang in langs:
        n = {s: sum(1 for i in issues if i['lang'] == lang and i['severity'] == s) for s in order}
        lines.append(f'| {NAMES[lang]} ({lang}) | {totals[lang]} | {n["redo"]} | {n["fix"]} | {n["review"]} |')
    for sev in order:
        group = [i for i in issues if i['severity'] == sev]
        if not group:
            continue
        lines += ['', f'## {sev} ({len(group)})', '']
        for i in group:
            src = i['source'] if len(i['source']) <= 90 else i['source'][:87] + '...'
            lines.append(f'- **{NAMES[i["lang"]]}** `{i["id"]}`: {i["problem"]}  \n  EN: {src}')
            if i['text'] and sev != 'fix':
                out = i['text'] if len(i['text']) <= 140 else i['text'][:137] + '...'
                lines.append(f'  {i["lang"]} ({i["model"]}): {out}')
    (REVIEW_DIR / 'translation-errors.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--langs', help='comma-separated language codes (default: every language with a file)')
    ap.add_argument('--fix-digits', action='store_true', help='convert non-Western digits to 0-9 in place')
    args = ap.parse_args()

    langs = args.langs.split(',') if args.langs else \
        [l for l in NAMES if (TRANSLATIONS_DIR / f'{l}.json').exists()]
    manual = json.loads(MANUAL.read_text(encoding='utf-8')) if MANUAL.exists() else {}
    # Line-by-line reviews, one file per language: review/line-review-<lang>.json
    for path in sorted(REVIEW_DIR.glob('line-review-*.json')):
        lang = path.stem.removeprefix('line-review-')
        found = json.loads(path.read_text(encoding='utf-8'))
        manual.setdefault(lang, []).extend(found.get('findings', []))
    issues, totals = [], {}
    for lang in langs:
        path = TRANSLATIONS_DIR / f'{lang}.json'
        data = json.loads(path.read_text(encoding='utf-8'))
        if args.fix_digits:
            changed = 0
            for t in data['texts'].values():
                new = to_western(t['text'])
                changed += new != t['text']
                t['text'] = new
            if changed:
                path.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')
                print(f'{lang}: converted digits in {changed} texts')
        totals[lang] = f'{len(data["texts"])}/{len(data["texts"]) + len(data.get("failed", {}))}'
        issues += review_language(lang, data, manual)

    write_reports(issues, langs, totals)
    for lang in langs:
        n = {s: sum(1 for i in issues if i['lang'] == lang and i['severity'] == s) for s in ('redo', 'fix', 'review')}
        print(f'{lang}: {totals[lang]} translated, redo {n["redo"]}, fix {n["fix"]}, review {n["review"]}')
    print(f'Wrote {REVIEW_DIR.relative_to(ROOT)}/translation-errors.md and .json')


if __name__ == '__main__':
    main()
