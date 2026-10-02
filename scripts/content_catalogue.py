"""Shared helpers for the guides and essential numbers (S02.09), used by the offline catalogue
scripts (translate_catalogue.py, apply_corrections.py, review_translations.py,
backtranslate_check.py with --content).

English source:  data/catalogue/guides.json, data/catalogue/numbers.json
Translations:    data/catalogue/translations/content/<lang>.json, one file per launch language
                 (the 14 languages of translate_catalogue.py plus zh-Hant), written for every
                 text, in this shape:

  {"language": "ur", "updated": "...",
   "texts":  {"guide.power.when911": null | {record}, ...},
   "failed": {"guide.power.title": {"source": ..., "attempts": [...]}}}

A null entry means "not translated": the app shows the English with translation.unavailable.
A record keeps the catalogue's traceability fields (source, text, model) and adds:

  sourceHash   SHA-256 of the English the record translates; a record whose hash no longer
               matches the English is stale and is never loaded (scripts/seed/guides.mjs)
  status       "machine" or "reviewed"; reviewer and reviewedOn are set when "reviewed"
  translatedOn the date the translation was made
  conversion   zh-Hant only: {"from": "zh", "fromTextHash", "openccVersion", "config"}

The text keys are the ones src/modules/directory/domain/guideContent.ts builds
(guide.<id>.title|when911|before.<i>|during.<i>|after.<i>, number.<id>.label|when).

Set CVH_CATALOGUE_DIR to point the scripts at another catalogue folder (the tests do).
"""
import hashlib
import json
import os
import re
import subprocess
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE_DIR = Path(os.environ.get('CVH_CATALOGUE_DIR') or ROOT / 'data/catalogue')
GUIDES_PATH = CATALOGUE_DIR / 'guides.json'
NUMBERS_PATH = CATALOGUE_DIR / 'numbers.json'
TERMS_PATH = CATALOGUE_DIR / 'terms.json'
CONTENT_DIR = CATALOGUE_DIR / 'translations/content'
REVIEW_DIR = CATALOGUE_DIR / 'review'
OPENCC_SCRIPT = ROOT / 'scripts/opencc_convert.mjs'
# Strings a translation of the terms must keep where the English has them; src/contracts/termsRequiredTokens.json
# is the one list, read here and by src/modules/subscriptions/domain/terms.ts (REQUIRED_TOKENS).
TERMS_REQUIRED_TOKENS_PATH = ROOT / 'src/contracts/termsRequiredTokens.json'

# The 14 translated languages of translate_catalogue.ROUTES, and zh-Hant converted from zh.
MODEL_LANGS = ['ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr']
DERIVED = {'zh-Hant': 'zh'}
CONTENT_LANGS = MODEL_LANGS + list(DERIVED)
PLACEHOLDER_PREFIX = 'PLACEHOLDER'
GUIDE_SECTIONS = ('before', 'during', 'after')


def source_hash(text):
    """SHA-256 of the English text; the seed computes the same value (guideContent.ts)."""
    return hashlib.sha256(text.encode('utf-8')).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, data, sort_keys=True):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=sort_keys) + '\n', encoding='utf-8')


def guide_texts(g):
    """{key: English} of one guide, keys relative to the guide (title, when911, before.0 ...)."""
    texts = {}
    for field in ('title', 'when911'):
        if g.get(field):
            texts[field] = g[field]
    for section in GUIDE_SECTIONS:
        for i, line in enumerate(g.get(section) or []):
            if line:
                texts[f'{section}.{i}'] = line
    return texts


def number_texts(n):
    """{key: English} of one number: label and, for 911, when."""
    return {field: n[field] for field in ('label', 'when') if n.get(field)}


def terms_texts(t):
    """{key: English} of the terms and privacy text (S07.01): terms.title, terms.<section>.heading,
    terms.<section>.<line index>. src/modules/subscriptions/domain/terms.ts builds the same keys."""
    texts = {}
    if t.get('title'):
        texts['terms.title'] = t['title']
    for section in t.get('sections') or []:
        if not section.get('id'):
            continue
        if section.get('heading'):
            texts[f'terms.{section["id"]}.heading'] = section['heading']
        for i, line in enumerate(section.get('lines') or []):
            if line:
                texts[f'terms.{section["id"]}.{i}'] = line
    return texts


def terms_review_texts(t):
    """What the English review and the counsel review of the terms cover: the translatable texts and the
    privacy contact (not translated, but part of what a resident reads)."""
    return {**terms_texts(t), 'terms.privacyContact': t.get('privacyContact') or ''}


def content_texts():
    """{key: English} for every text of the guides, the numbers page and the terms, in file order."""
    texts = {}
    if GUIDES_PATH.exists():
        for g in read_json(GUIDES_PATH)['guides']:
            for key, english in guide_texts(g).items():
                texts[f'guide.{g["id"]}.{key}'] = english
    if NUMBERS_PATH.exists():
        for n in read_json(NUMBERS_PATH)['numbers']:
            for key, english in number_texts(n).items():
                texts[f'number.{n["id"]}.{key}'] = english
    if TERMS_PATH.exists():
        texts.update(terms_texts(read_json(TERMS_PATH)))
    return texts


def english_review_hash(texts):
    """What an English review covers: SHA-256 over [[key, English], ...] (compact JSON, file order) of
    a guide's texts or of the numbers list's texts, keys in full. guideContent.ts englishReviewHash
    computes the same value; the seed refuses a review whose hash is not the current English's."""
    return source_hash(json.dumps([[k, v] for k, v in texts.items()], ensure_ascii=False, separators=(',', ':')))


def terms_required_tokens():
    return json.loads(TERMS_REQUIRED_TOKENS_PATH.read_text(encoding='utf-8'))


def lost_required_tokens(key, english, text):
    """Required tokens (terms.* keys only) the English has and the translation lost: the app's lost_required rule."""
    if not key.startswith('terms.'):
        return []
    return [token for token in terms_required_tokens() if token in english and token not in text]


def is_911_key(key):
    return key.startswith('number.911.') or (key.startswith('guide.') and key.endswith('.when911'))


def critical_keys(texts):
    """Keys of the texts that carry 911: the 911 keys, and any text that mentions 911. They must
    survive translation (and the 911 keys are never blank)."""
    return [k for k, en in texts.items() if is_911_key(k) or '911' in en]


def load_content(lang, texts):
    """The translation file of a language, with a null entry for every current text.
    A record whose English has changed since is dropped (set to null) and counted in
    data['staleDropped'] (not saved) unless another key of the same file holds a record of exactly
    the current English (its sourceHash matches): lines are keyed by position (before.0, before.1),
    so inserting a line shifts the others, and that record, with its review status, moves to the new
    key instead of being translated again (data['moved'], not saved)."""
    path = CONTENT_DIR / f'{lang}.json'
    data = read_json(path) if path.exists() else {'language': lang, 'texts': {}, 'failed': {}}
    data.setdefault('failed', {})
    old = data.get('texts', {})
    keep = {k for k, english in texts.items() if old.get(k) and old[k].get('sourceHash') == source_hash(english)}
    spare = {}  # sourceHash -> records not kept at their own key, in file order
    for k, rec in old.items():
        if rec and k not in keep and rec.get('sourceHash'):
            spare.setdefault(rec['sourceHash'], []).append(rec)
    fresh, dropped, moved = {}, [], []
    for key, english in texts.items():
        rec = old.get(key) if key in keep else None
        if rec is None and spare.get(source_hash(english)):
            rec = spare[source_hash(english)].pop(0)
            moved.append(key)
        elif rec is None and old.get(key):
            dropped.append(key)
        fresh[key] = rec
    data['texts'] = fresh
    data['failed'] = {k: v for k, v in data['failed'].items() if k in texts and fresh.get(k) is None
                      and v.get('source') == texts[k]}
    data['staleDropped'] = dropped
    data['moved'] = moved
    return data


def save_content(lang, data):
    data = {k: v for k, v in data.items() if k not in ('staleDropped', 'moved')}
    data['language'] = lang
    data['models'] = {}
    for rec in data['texts'].values():
        if rec:
            data['models'][rec['model']] = data['models'].get(rec['model'], 0) + 1
    path = CONTENT_DIR / f'{lang}.json'
    if path.exists():
        before = read_json(path)
        if {k: v for k, v in before.items() if k != 'updated'} == data:
            return  # nothing changed: keep the file (and its date) as it is
    data['updated'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    write_json(path, data)


def new_record(english, text, model):
    return {'source': english, 'sourceHash': source_hash(english), 'text': text, 'model': model,
            'status': 'machine', 'reviewer': None, 'reviewedOn': None,
            'translatedOn': date.today().isoformat()}


def is_placeholder(value):
    return not value or str(value).strip().upper().startswith(PLACEHOLDER_PREFIX)


# ---------------------------------------------------------------- zh-Hant from zh
def opencc(texts):
    """Run scripts/opencc_convert.mjs; returns (openccVersion, config, {key: converted})."""
    out = subprocess.run(['node', str(OPENCC_SCRIPT)], input=json.dumps({'texts': texts}), text=True,
                         capture_output=True, check=True, cwd=ROOT)
    result = json.loads(out.stdout)
    return result['openccVersion'], result['config'], result['texts']


def convert_zh_hant(texts):
    """Rebuild data/catalogue/translations/content/zh-Hant.json from the zh file. A zh-Hant record
    exists only for a current zh translation; it is "reviewed" only while the zh it came from is,
    and it is recomputed when that zh text, its status, the OpenCC version or its configuration
    change. Unchanged records are kept as they are. Returns (converted, kept, missing)."""
    zh = load_content('zh', texts)
    hant = load_content('zh-Hant', texts)
    sources = {k: r['text'] for k, r in zh['texts'].items() if r}
    version, config, converted = opencc(sources)
    changed = kept = 0
    for key, english in texts.items():
        z = zh['texts'][key]
        if not z:
            hant['texts'][key] = None
            continue
        want = new_record(english, converted[key], 'opencc')
        want['conversion'] = {'from': 'zh', 'fromTextHash': source_hash(z['text']),
                              'openccVersion': version, 'config': config}
        if z['status'] == 'reviewed':
            want.update(status='reviewed', reviewer=z['reviewer'], reviewedOn=z['reviewedOn'])
        have = hant['texts'][key]
        if have and {k: v for k, v in have.items() if k != 'translatedOn'} == \
                {k: v for k, v in want.items() if k != 'translatedOn'}:
            kept += 1
            continue
        hant['texts'][key] = want
        changed += 1
    missing = sum(1 for r in hant['texts'].values() if r is None)
    hant['failed'] = {}
    save_content('zh-Hant', hant)
    return changed, kept, missing


def valid_date(value):
    return bool(value) and bool(re.fullmatch(r'\d{4}-\d{2}-\d{2}', value)) and _parses(value)


def _parses(value):
    try:
        date.fromisoformat(value)
        return True
    except ValueError:
        return False
