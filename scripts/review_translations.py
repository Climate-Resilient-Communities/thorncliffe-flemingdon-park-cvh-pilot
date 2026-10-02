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

Guides and essential numbers (S02.09):

  python3 scripts/review_translations.py --content    # status per language, stale and critical (911) problems
  python3 scripts/review_translations.py --content --mark-reviewed ur --reviewer "Name" --reviewed-on 2026-11-02
                                                      # record a native reader's review of a language's current
                                                      # machine translations (--keys to limit it to some texts)

  python3 scripts/review_translations.py --content --mark-english-reviewed --reviewer "Owner" --reviewed-on 2026-10-20
                                                      # the owner signs off the English now in guides.json and
                                                      # numbers.json: records reviewer, date and a hash of that English
                                                      # (--guide ID for one guide, --numbers for the numbers list)

--mark-english-reviewed ties the review to the English it covered: the seed refuses a guide or the
numbers list whose English changed after the sign-off. The reviewer must be the file's owner.

Terms and privacy page (S07.01, data/catalogue/terms.json; its texts are keyed terms.* in the same translation files):

  python3 scripts/review_translations.py --content --mark-english-reviewed --terms --reviewer "Owner" --reviewed-on 2026-10-20
  python3 scripts/review_translations.py --content --mark-counsel-reviewed --reviewer "Counsel" --reviewed-on 2026-10-25

--terms records the owner's English review of the terms; --mark-counsel-reviewed records counsel's review of the
current English, privacy contact and consent_version. Both are tied to a hash of that text: the terms are published
only while the counsel review matches, so any later change needs a new review. Counsel's review also records
the version and its text hash in terms.json publishedVersions: a consentVersion is never reused for changed text
(bump consentVersion, YYYY-MM-DD.n), and when the text changed lastUpdated must have moved past the review it replaces.

--content writes review/content-translation-status.json. --mark-reviewed changes status
"machine" to "reviewed" (with reviewer and date) only on translations that are current
(their source hash matches the English); zh-Hant follows zh and is never marked by hand.
"""
import argparse
import json
import re
import unicodedata
from datetime import date
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


def content_status(texts):
    """Per language: counts and the problems the seed would report (S02.09)."""
    import content_catalogue as cc

    status = {}
    for lang in cc.CONTENT_LANGS:
        path = cc.CONTENT_DIR / f'{lang}.json'
        raw = cc.read_json(path)['texts'] if path.exists() else {}
        counts = {'reviewed': 0, 'machine': 0, 'stale': 0, 'null': 0}
        problems = []
        for key, english in texts.items():
            rec = raw.get(key)
            if not rec:
                counts['null'] += 1
                continue
            if rec.get('sourceHash') != cc.source_hash(english):
                counts['stale'] += 1
                problems.append({'id': key, 'problem': 'stale: the English changed since this was translated'})
                continue
            counts[rec['status']] += 1
            lost = missing_critical(english, rec['text'])
            if lost:
                problems.append({'id': key, 'problem': 'lost or changed: ' + ', '.join(lost)})
            lost_tokens = cc.lost_required_tokens(key, english, rec['text'])
            if lost_tokens:
                problems.append({'id': key, 'problem': 'lost required: ' + ', '.join(lost_tokens) + ' (the app shows the English instead)'})
            if rec['status'] == 'reviewed' and (cc.is_placeholder(rec.get('reviewer')) or not cc.valid_date(rec.get('reviewedOn'))):
                problems.append({'id': key, 'problem': 'reviewed without a named reviewer and date'})
        status[lang] = {'texts': len(texts), **counts, 'problems': problems}
    return status


def mark_reviewed(lang, reviewer, reviewed_on, keys):
    import content_catalogue as cc

    if lang not in cc.MODEL_LANGS:
        raise SystemExit(f'{lang}: only translated languages are reviewed by hand; zh-Hant follows zh')
    if cc.is_placeholder(reviewer):
        raise SystemExit('--reviewer must name the person who read the translation')
    if not cc.valid_date(reviewed_on):
        raise SystemExit('--reviewed-on must be a date, YYYY-MM-DD')
    texts = cc.content_texts()
    data = cc.load_content(lang, texts)
    marked = 0
    refused = []
    for key, rec in data['texts'].items():
        if rec and rec['status'] == 'machine' and (not keys or key in keys):
            lost = cc.lost_required_tokens(key, texts.get(key, ''), rec.get('text') or '')
            if lost:
                if keys:
                    raise SystemExit(f'{key}: the translation lost {", ".join(lost)}, which a resident acts on; correct it before marking it reviewed')
                refused.append(f'{key} (lost {", ".join(lost)})')
                continue
            rec.update(status='reviewed', reviewer=reviewer, reviewedOn=reviewed_on)
            marked += 1
    cc.save_content(lang, data)
    print(f'{lang}: {marked} translations marked reviewed by {reviewer} on {reviewed_on}')
    for item in refused:
        print(f'{lang}: not marked reviewed, a required string is lost: {item}')
    if lang == 'zh':
        changed, kept, missing = cc.convert_zh_hant(texts)
        print(f'zh-Hant: {changed} converted from zh, {kept} unchanged, {missing} null')


def mark_english_reviewed(reviewer, reviewed_on, guide_id, numbers_only):
    """Record the owner's English review (reviewer, date, hash of the English) in guides.json / numbers.json."""
    import content_catalogue as cc

    if cc.is_placeholder(reviewer):
        raise SystemExit('--reviewer must name the owner who read the English')
    if not cc.valid_date(reviewed_on):
        raise SystemExit('--reviewed-on must be a date, YYYY-MM-DD')
    if reviewed_on > date.today().isoformat():
        raise SystemExit('--reviewed-on cannot be in the future')

    def sign(item, texts, label):
        owner = item.get('owner')
        if cc.is_placeholder(owner):
            raise SystemExit(f'{label}: the owner is not named yet')
        if ' '.join(owner.lower().split()) != ' '.join(reviewer.lower().split()):
            raise SystemExit(f'{label}: the English review must be by the owner ({owner})')
        if not cc.valid_date(item.get('lastUpdated')) or reviewed_on < item['lastUpdated']:
            raise SystemExit(f'{label}: the review cannot be dated before the last update ({item.get("lastUpdated")})')
        item['englishReview'] = {'reviewer': reviewer, 'date': reviewed_on,
                                 'sourceHash': cc.english_review_hash(texts)}
        print(f'{label}: English review recorded for {reviewer} on {reviewed_on}')

    if not numbers_only:
        guides = cc.read_json(cc.GUIDES_PATH)
        chosen = [g for g in guides['guides'] if not guide_id or g['id'] == guide_id]
        if guide_id and not chosen:
            raise SystemExit(f'No guide {guide_id}')
        for g in chosen:
            sign(g, {f'guide.{g["id"]}.{k}': v for k, v in cc.guide_texts(g).items()}, f'guide {g["id"]}')
        cc.write_json(cc.GUIDES_PATH, guides, sort_keys=False)
    if numbers_only or not guide_id:
        numbers = cc.read_json(cc.NUMBERS_PATH)
        texts = {}
        for n in numbers['numbers']:
            texts.update({f'number.{n["id"]}.{k}': v for k, v in cc.number_texts(n).items()})
        sign(numbers, texts, 'essential numbers')
        cc.write_json(cc.NUMBERS_PATH, numbers, sort_keys=False)


def version_date(version):
    """The date part of a consent_version (YYYY-MM-DD.n), or None."""
    match = re.match(r'^(\d{4}-\d{2}-\d{2})\.[1-9]\d*$', version or '')
    return match.group(1) if match else None


def mark_terms_reviewed(reviewer, reviewed_on, counsel):
    """Record the review of the current terms (S07.01) in terms.json: the owner's English review
    (englishReview) or counsel's (counselReview, which also records the consent_version it covered).
    Both are tied to a hash of the English and the privacy contact: any later change makes them stale."""
    import content_catalogue as cc

    if cc.is_placeholder(reviewer):
        raise SystemExit('--reviewer must name the person who read the terms')
    if not cc.valid_date(reviewed_on):
        raise SystemExit('--reviewed-on must be a date, YYYY-MM-DD')
    if reviewed_on > date.today().isoformat():
        raise SystemExit('--reviewed-on cannot be in the future')
    terms = cc.read_json(cc.TERMS_PATH)
    if not cc.valid_date(terms.get('lastUpdated')) or reviewed_on < terms['lastUpdated']:
        raise SystemExit(f'the review cannot be dated before the last update ({terms.get("lastUpdated")})')
    current = cc.english_review_hash(cc.terms_review_texts(terms))
    record = {'reviewer': reviewer, 'date': reviewed_on, 'sourceHash': current}
    previous = terms.get('counselReview' if counsel else 'englishReview') or {}
    if previous.get('sourceHash') and previous['sourceHash'] != current:
        # The text changed since the review this one replaces: "Last updated" must say so.
        if cc.valid_date(previous.get('date')) and terms['lastUpdated'] <= previous['date']:
            raise SystemExit(f'the text changed since the review of {previous["date"]}, but lastUpdated ({terms["lastUpdated"]}) '
                             'has not moved past it; set lastUpdated to the date of the change')
    version = terms.get('consentVersion')
    if version_date(version) and terms['lastUpdated'] < version_date(version):
        raise SystemExit(f'lastUpdated ({terms["lastUpdated"]}) is before the date of consentVersion {version}')
    if counsel:
        if cc.is_placeholder(terms.get('privacyContact')) or cc.is_placeholder(terms.get('owner')):
            raise SystemExit('counsel reviews the terms only once the owner and the privacy contact are named')
        ledger = terms.get('publishedVersions') or {}
        if ledger.get(version) not in (None, current):
            raise SystemExit(f'consentVersion {version} was already published with different text; bump consentVersion '
                             '(YYYY-MM-DD.n) before counsel reviews the changed terms')
        terms['counselReview'] = {**record, 'version': version}
        terms['publishedVersions'] = {**ledger, version: current}
        print(f'terms {version}: counsel review recorded for {reviewer} on {reviewed_on}')
    else:
        owner = terms.get('owner')
        if cc.is_placeholder(owner):
            raise SystemExit('terms: the owner is not named yet')
        if ' '.join(owner.lower().split()) != ' '.join(reviewer.lower().split()):
            raise SystemExit(f'terms: the English review must be by the owner ({owner})')
        terms['englishReview'] = record
        print(f'terms {version}: English review recorded for {reviewer} on {reviewed_on}')
    cc.write_json(cc.TERMS_PATH, terms, sort_keys=False)


def content_main(args):
    import content_catalogue as cc

    if args.mark_counsel_reviewed or (args.mark_english_reviewed and args.terms):
        return mark_terms_reviewed(args.reviewer, args.reviewed_on, args.mark_counsel_reviewed)
    if args.mark_english_reviewed:
        return mark_english_reviewed(args.reviewer, args.reviewed_on, args.guide, args.numbers)
    if args.mark_reviewed:
        return mark_reviewed(args.mark_reviewed, args.reviewer, args.reviewed_on,
                             set(args.keys.split(',')) if args.keys else None)
    status = content_status(cc.content_texts())
    cc.write_json(cc.REVIEW_DIR / 'content-translation-status.json', status, sort_keys=False)
    for lang, st in status.items():
        print(f'{lang}: {st["reviewed"]} reviewed, {st["machine"]} machine, {st["stale"]} stale, '
              f'{st["null"]} not translated (English with translation.unavailable), {len(st["problems"])} problem(s)')
    print(f'Wrote {cc.REVIEW_DIR / "content-translation-status.json"}')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--langs', help='comma-separated language codes (default: every language with a file)')
    ap.add_argument('--fix-digits', action='store_true', help='convert non-Western digits to 0-9 in place')
    ap.add_argument('--content', action='store_true', help='report on the guides and essential numbers')
    ap.add_argument('--mark-reviewed', metavar='LANG', help='with --content: record a native reader\'s review')
    ap.add_argument('--reviewer', help='with --mark-reviewed: the reader\'s name')
    ap.add_argument('--reviewed-on', help='with --mark-reviewed: the review date, YYYY-MM-DD')
    ap.add_argument('--mark-english-reviewed', action='store_true',
                    help='with --content: record the owner\'s review of the current English (--reviewer, --reviewed-on)')
    ap.add_argument('--guide', help='with --mark-english-reviewed: only this guide id (default: every guide and the numbers)')
    ap.add_argument('--numbers', action='store_true', help='with --mark-english-reviewed: only the numbers list')
    ap.add_argument('--terms', action='store_true',
                    help="with --mark-english-reviewed: record the owner's review of the terms (terms.json) instead")
    ap.add_argument('--mark-counsel-reviewed', action='store_true',
                    help="with --content: record counsel's review of the current terms and consent version (--reviewer, --reviewed-on)")
    ap.add_argument('--keys', help='with --mark-reviewed: comma-separated text keys (default: all current machine texts)')
    args = ap.parse_args()
    if args.content:
        return content_main(args)

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
