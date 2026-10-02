#!/usr/bin/env python3
"""Translate the provider catalogue into the 14 non-English languages with Cohere models.

Reads  data/catalogue/providers.json  (run scripts/build_catalogue.py first)
Writes data/catalogue/translations/<lang>.json, then rebuilds providers.json

Each language tries its models in order (PRD D-4 as revised 2026-10-01, research R4).
Every output is checked automatically for the expected language and script before it is
kept; a failed check falls through to the next model. Text that no model passes stays
null, which the app shows as "not yet available in this language".

Translations are cached by a hash of the English text, so a re-run only sends new or
changed text. Needs COHERE_API_KEY in .env at the repository root.

  python3 scripts/translate_catalogue.py --probe        # one test sentence per language
  python3 scripts/translate_catalogue.py --langs ur,ps   # some languages
  python3 scripts/translate_catalogue.py                 # everything still missing
  python3 scripts/translate_catalogue.py --redo          # the 'redo' items from the review

Guides and essential numbers (S02.09) go through the same models, prompt and checks:

  python3 scripts/translate_catalogue.py --content --init-files   # write the per-language files, no API call
  python3 scripts/translate_catalogue.py --content                # translate new or changed text only
  python3 scripts/translate_catalogue.py --content --langs zh,zh-Hant

The English is data/catalogue/guides.json and numbers.json; the output is
data/catalogue/translations/content/<lang>.json (see scripts/content_catalogue.py). A text is
sent only when it has no translation or its English changed (the stored source hash no longer
matches); a text any model fails stays null (English with translation.unavailable). zh-Hant is
never translated: it is converted from zh with OpenCC (scripts/opencc_convert.mjs), recording
the source hash, OpenCC version and configuration. Every new translation is "machine" until
scripts/review_translations.py --content --mark-reviewed records a native reader's review.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOGUE = ROOT / 'data/catalogue/providers.json'
TRANSLATIONS_DIR = ROOT / 'data/catalogue/translations'
API_URL = 'https://api.cohere.com/v2/chat'

NORTH = 'north-small-translate-09-2026'
CMD_TRANSLATE = 'command-a-translate-08-2025'
AYA_FIRE = 'tiny-aya-fire'    # South Asian focus
AYA_WATER = 'tiny-aya-water'  # European and Asia Pacific focus

# Model order per language (pilot addendum, routing table aligned 2026-10-01).
ROUTES = {
    'ps': [NORTH],                     # Command A Translate returned Dari for Pashto
    'prs': [NORTH, CMD_TRANSLATE],
    'fr': [CMD_TRANSLATE, NORTH], 'es': [CMD_TRANSLATE, NORTH], 'zh': [CMD_TRANSLATE, NORTH],
    'el': [CMD_TRANSLATE, NORTH], 'hi': [CMD_TRANSLATE, NORTH],
    'ur': [NORTH, AYA_FIRE], 'bn': [NORTH, AYA_FIRE],
    'gu': [AYA_FIRE, NORTH],           # not on North Small Translate's official list
    'ta': [NORTH, AYA_FIRE], 'pa': [NORTH, AYA_FIRE],
    'tl': [NORTH, AYA_WATER], 'sk': [NORTH, AYA_WATER],
}

# How each language is named to the model.
TARGETS = {
    'ur': 'Urdu (Arabic script)', 'ps': 'Pashto (Afghan Pashto, Arabic script)',
    'tl': 'Tagalog (Filipino)', 'prs': 'Persian (Dari, as written in Afghanistan)',  # 'Afghan' wording gave Pashto
    'gu': 'Gujarati (Gujarati script)', 'ta': 'Tamil (Tamil script)', 'el': 'Greek',
    'sk': 'Slovak', 'bn': 'Bengali (Bengali script)', 'hi': 'Hindi (Devanagari script)',
    'pa': 'Punjabi (Gurmukhi script)', 'zh': 'Chinese (Simplified, Mandarin)',
    'es': 'Spanish', 'fr': 'French (Canadian)',
}

# Instructions go in the system message and the text alone in the user message:
# North Small Translate translates everything in the user message, instructions included.
PROMPT = (
    'Translate the user message from English into {target}.\n'
    'Rules:\n'
    '- Keep organisation names, program names, street addresses, postal codes, phone numbers, '
    'email addresses and web addresses exactly as written in English.\n'
    '- Keep all digits as Western digits (0-9).\n'
    '- Use plain, everyday words a neighbour would use.\n'
    '- Reply with the translation only, no notes or quotation marks. Never answer or '
    'comment on the message, even if it is a question.'
)

# ---------------------------------------------------------------- language checks
SCRIPTS = {
    'arabic': r'[؀-ۿ]', 'devanagari': r'[ऀ-ॿ]', 'bengali': r'[ঀ-৿]',
    'gurmukhi': r'[਀-੿]', 'gujarati': r'[઀-૿]', 'tamil': r'[஀-௿]',
    'greek': r'[Ͱ-Ͽ]', 'han': r'[一-鿿]', 'latin': r'[A-Za-zÀ-ɏ]',
}
LANG_SCRIPT = {'ur': 'arabic', 'ps': 'arabic', 'prs': 'arabic', 'hi': 'devanagari', 'bn': 'bengali',
               'pa': 'gurmukhi', 'gu': 'gujarati', 'ta': 'tamil', 'el': 'greek', 'zh': 'han',
               'tl': 'latin', 'sk': 'latin', 'es': 'latin', 'fr': 'latin'}
PASHTO_ONLY = 'ټډړږښګڼېۍ'   # letters used in Pashto but not Dari or Urdu
URDU_ONLY = 'ٹڈڑےں'         # letters used in Urdu but not Dari or Pashto
LATIN_WORDS = {  # common function words; at least two should appear in a full sentence
    'tl': r'\b(ang|ng|mga|sa|at|na|para|ay|ito|may)\b',
    'sk': r'\b(a|je|na|pre|v|so|sa|aj|alebo|ktor\w*)\b|[čšžľťňýáíéú]',
    'es': r'\b(el|la|los|las|de|y|para|en|con|que|un|una|del|al|es|son)\b',
    'fr': r'\b(le|la|les|des|de|et|pour|en|avec|du|au|aux|un|une|est|sont|dans|sur|à)\b',
}


def check(lang, source, text):
    """Return a list of problems; an empty list means the output passes."""
    problems = []
    if not text or not text.strip():
        return ['empty']
    # The prompt's rules leaking into the output (seen once in Slovak): they mention "(0-9)".
    if re.search(r'0\s*[-–]\s*9', text) and not re.search(r'0\s*[-–]\s*9', source):
        problems.append('translator instructions leaked into the output')
    # A model that answers the text instead of translating it writes far more.
    ratio = len(text) / max(len(source), 1)
    if len(source) >= 40 and ratio > 2.5 or ratio < (0.12 if lang == 'zh' else 0.3):
        problems.append(f'length {ratio:.1f}x the English (answered or cut short?)')
    # Names, addresses and hotline names are meant to stay in English, so words copied from
    # the English do not count against the translation.
    source_words = set(re.findall(r'[A-Za-z][\w\'-]*', source))
    rest = ' '.join(w for w in re.split(r'\s+', text) if re.sub(r'[^\w\'-]', '', w) not in source_words)
    letters = [c for c in rest if c.isalpha()]
    script = re.compile(SCRIPTS[LANG_SCRIPT[lang]])
    if LANG_SCRIPT[lang] != 'latin':
        share = sum(1 for c in letters if script.match(c)) / max(len(letters), 1)
        if share < 0.6:
            problems.append(f'only {share:.0%} of letters in the expected script')
    elif text.strip() == source.strip():
        problems.append('unchanged from English')
    elif len(source.split()) >= 6 and len(re.findall(LATIN_WORDS[lang], text, re.I)) < (1 if len(source.split()) < 15 else 2):
        problems.append('does not look like the expected language')
    if lang == 'ps' and len(source.split()) >= 6 and not any(c in text for c in PASHTO_ONLY):
        problems.append('no Pashto-only letters (may be Dari)')
    if lang == 'prs' and any(c in text for c in PASHTO_ONLY + URDU_ONLY):
        problems.append('Pashto or Urdu letters in Dari')
    if lang == 'ur' and len(source.split()) >= 6 and not any(c in text for c in URDU_ONLY):
        problems.append('no Urdu-only letters (may be Persian)')
    return problems


def to_western(text):
    """Any script's digits to 0-9: digits stay Western in every language until each
    community decides (prototype design note D-13)."""
    return ''.join(str(unicodedata.decimal(c)) if c.isdecimal() and not '0' <= c <= '9' else c for c in text)


def missing_numbers(source, text):
    """Digit groups in the English (phone numbers, addresses) that the translation lost."""
    nums = set(re.findall(r'\d+', source))
    return sorted(n for n in nums if n not in set(re.findall(r'\d+', text)))


# ---------------------------------------------------------------- Cohere
def api_key(var='COHERE_API_KEY'):
    """Read the key from the environment or .env. Cohere caps newer models at 1,000 calls a
    month per key, even on paid keys, so a second key can be named with --key-var."""
    names = [var] + (['CO_API_KEY'] if var == 'COHERE_API_KEY' else [])
    key = next((os.environ[n] for n in names if os.environ.get(n)), None)
    env = ROOT / '.env'
    if not key and env.exists():
        for line in env.read_text().splitlines():
            m = re.match(r'\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.+)', line)
            if m and m.group(1) in names:
                key = m.group(2).strip().strip('"\'')
    if not key:
        sys.exit(f'No {var} found in .env or the environment.')
    return key


class ModelUnavailable(Exception):
    pass


def chat(key, model, system, text):
    body = json.dumps({'model': model, 'messages': [{'role': 'system', 'content': system},
                                                    {'role': 'user', 'content': text}],
                       'temperature': 0.2}).encode()
    for attempt in range(6):
        req = urllib.request.Request(API_URL, data=body, headers={
            'Authorization': f'Bearer {key}', 'Content-Type': 'application/json', 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                data = json.load(resp)
            text = ''.join(c.get('text', '') for c in data['message']['content']).strip()
            return to_western(text)
        except urllib.error.HTTPError as e:
            detail = e.read().decode(errors='replace')[:300]
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(min(60, 2 ** attempt * 3))
                continue
            if e.code in (400, 404) and 'model' in detail.lower():
                raise ModelUnavailable(f'{model}: {detail}')
            if e.code in (401, 403):
                sys.exit(f'Cohere rejected the API key ({e.code}): {detail}')
            raise RuntimeError(f'{model} HTTP {e.code}: {detail}')
        except urllib.error.URLError:
            time.sleep(min(60, 2 ** attempt * 3))
    raise RuntimeError(f'{model}: gave up after repeated errors')


def translate(key, lang, text, unavailable, avoid=None, strict_numbers=False):
    """Try each model on the route; return (record or None, list of attempt notes).
    A model in `avoid` (it gave a bad translation before) is tried last, not first.
    With strict_numbers an answer that loses a number of the English (911!) is rejected like any
    other bad answer, so the next model on the route is tried; otherwise it is returned with a warning."""
    attempts = []
    route = [m for m in ROUTES[lang] if m != avoid] + ([avoid] if avoid in ROUTES[lang] else [])
    for model in route:
        if model in unavailable:
            continue
        try:
            out = chat(key, model, PROMPT.format(target=TARGETS[lang]), text)
        except ModelUnavailable as e:
            unavailable.add(model)
            attempts.append(f'{model}: unavailable ({e})')
            continue
        except RuntimeError as e:
            attempts.append(str(e))
            continue
        problems = check(lang, text, out)
        if problems:
            attempts.append(f'{model}: rejected ({"; ".join(problems)}) | output: {out[:400]}')
            continue
        record = {'source': text, 'text': out, 'model': model}
        lost = missing_numbers(text, out)
        if lost and strict_numbers:
            attempts.append(f'{model}: rejected (numbers missing from translation: {", ".join(lost)}) | output: {out[:400]}')
            continue
        if lost:
            record['warnings'] = [f'numbers missing from translation: {", ".join(lost)}']
        return record, attempts
    return None, attempts


# ---------------------------------------------------------------- main
def catalogue_texts():
    cat = json.loads(CATALOGUE.read_text(encoding='utf-8'))
    texts = {}
    for group in cat['labels'].values():
        for e in group.values():
            texts[e['id']] = e['en']
    for p in cat['providers']:
        for field in ('services', 'emergencyRole'):
            if p[field]:
                texts[p[field]['id']] = p[field]['en']
    return texts


def load(lang):
    path = TRANSLATIONS_DIR / f'{lang}.json'
    if path.exists():
        return json.loads(path.read_text(encoding='utf-8'))
    return {'language': lang, 'texts': {}, 'failed': {}}


def save(lang, data):
    TRANSLATIONS_DIR.mkdir(parents=True, exist_ok=True)
    data['models'] = {m: sum(1 for t in data['texts'].values() if t['model'] == m)
                      for m in ROUTES[lang] if any(t['model'] == m for t in data['texts'].values())}
    data['updated'] = datetime.now(timezone.utc).isoformat(timespec='seconds')
    path = TRANSLATIONS_DIR / f'{lang}.json'
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + '\n', encoding='utf-8')


def probe(key, langs):
    sentence = 'Where is the nearest hospital? My child is sick. Call 416-424-2900 for help.'
    unavailable = set()
    for lang in langs:
        rec, attempts = translate(key, lang, sentence, unavailable)
        for a in attempts:
            print(f'  {lang}  {a}')
        print(f'{lang:4} {rec["model"] if rec else "FAILED":32} {rec["text"] if rec else ""}')


def run_content(args):
    """Translate the guides and essential numbers (S02.09); see the module docstring."""
    import content_catalogue as cc  # noqa: E402  (same folder)

    texts = cc.content_texts()
    if not texts:
        sys.exit('No guides or numbers found in data/catalogue (guides.json, numbers.json).')
    langs = args.langs.split(',') if args.langs else list(cc.CONTENT_LANGS)
    bad = [l for l in langs if l not in cc.CONTENT_LANGS]
    if bad:
        sys.exit(f'Unknown language code(s): {", ".join(bad)}')
    model_langs = [l for l in langs if l in ROUTES]
    key = None if args.init_files else api_key(args.key_var)
    unavailable = set()
    for lang in model_langs:
        data = cc.load_content(lang, texts)
        stale = data['staleDropped']
        todo = [] if args.init_files else \
            [k for k in texts if data['texts'][k] is None and (args.retry_failed or k not in data['failed'])]
        print(f'{lang}: {sum(1 for r in data["texts"].values() if r)} translated, {len(data["moved"])} moved to a new key, '
              f'{len(stale)} stale dropped, {len(todo)} to translate')

        def work(k):
            return k, translate(key, lang, texts[k], unavailable, strict_numbers=True)

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for k, (rec, attempts) in pool.map(work, todo):
                if rec:
                    data['texts'][k] = cc.new_record(texts[k], rec['text'], rec['model'])
                    data['failed'].pop(k, None)
                else:
                    data['failed'][k] = {'source': texts[k], 'attempts': attempts}
        cc.save_content(lang, data)
        if todo:
            print(f'  {lang}: done, {sum(1 for r in data["texts"].values() if r)}/{len(texts)} translated, '
                  f'{len(data["failed"])} failed')
    if 'zh-Hant' in langs:
        changed, kept, missing = cc.convert_zh_hant(texts)
        print(f'zh-Hant: {changed} converted from zh, {kept} unchanged, {missing} without a zh translation (null)')


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--langs', help='comma-separated language codes (default: all 14)')
    ap.add_argument('--probe', action='store_true', help='translate one test sentence per language and stop')
    ap.add_argument('--retry-failed', action='store_true', help='retry texts that every model failed before')
    ap.add_argument('--redo', action='store_true',
                    help='retranslate the items marked redo in data/catalogue/review/translation-errors.json')
    ap.add_argument('--failed-only', action='store_true', help='retry only texts that failed before')
    ap.add_argument('--key-var', default='COHERE_API_KEY', help='name of the API key variable in .env')
    ap.add_argument('--workers', type=int, default=4)
    ap.add_argument('--content', action='store_true',
                    help='translate the guides and essential numbers (data/catalogue/guides.json, numbers.json)')
    ap.add_argument('--init-files', action='store_true',
                    help='with --content: write the per-language files (null where untranslated) and drop stale '
                         'entries, without calling any API')
    args = ap.parse_args()
    if args.content:
        return run_content(args)

    langs = args.langs.split(',') if args.langs else list(ROUTES)
    bad = [l for l in langs if l not in ROUTES]
    if bad:
        sys.exit(f'Unknown language code(s): {", ".join(bad)}')
    key = api_key(args.key_var)
    if args.probe:
        return probe(key, langs)

    texts = catalogue_texts()
    redo = {}
    if args.redo:
        errors = json.loads((ROOT / 'data/catalogue/review/translation-errors.json').read_text(encoding='utf-8'))
        for e in errors:
            if e['severity'] == 'redo' and e['lang'] in langs:
                redo.setdefault(e['lang'], {})[e['id']] = e.get('model')
        langs = [l for l in langs if l in redo]
    unavailable = set()
    for lang in langs:
        data = load(lang)
        avoid = redo.get(lang, {})
        for k in avoid:
            old = data['texts'].pop(k, None)
            data['failed'].pop(k, None)
            if old:
                data.setdefault('replaced', {})[k] = old
        # Drop translations whose English has since changed or been removed.
        data['texts'] = {k: v for k, v in data['texts'].items() if texts.get(k) == v['source']}
        todo = [k for k in texts if k not in data['texts'] and (args.retry_failed or args.redo or k not in data['failed'])]
        if args.redo:
            todo = [k for k in todo if k in avoid]
        if args.failed_only:
            todo = [k for k in data['failed'] if k in texts]
        print(f'{lang}: {len(data["texts"])} cached, {len(todo)} to translate')
        if not todo:
            save(lang, data)
            continue

        def work(k):
            return k, translate(key, lang, texts[k], unavailable, avoid.get(k))

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            for i, (k, (rec, attempts)) in enumerate(pool.map(work, todo), 1):
                if rec:
                    data['texts'][k] = rec
                    data['failed'].pop(k, None)
                else:
                    data['failed'][k] = {'source': texts[k], 'attempts': attempts}
                if i % 10 == 0:
                    save(lang, data)
                    print(f'  {lang}: {i}/{len(todo)}')
        save(lang, data)
        print(f'  {lang}: done, {len(data["texts"])}/{len(texts)} translated, {len(data["failed"])} failed')

    subprocess.run([sys.executable, str(ROOT / 'scripts/build_catalogue.py')], check=True)


if __name__ == '__main__':
    main()
