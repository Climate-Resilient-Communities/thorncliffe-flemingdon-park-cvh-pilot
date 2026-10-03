#!/usr/bin/env python3
"""Clean the TPCH community assets spreadsheet and build the provider catalogue JSON.

Reads  data/seed/TPCH_Community_Assets_v2.csv
Writes data/catalogue/providers.json

One record per place (organisation + street address), using the prototype's asset IDs
(M001...) from design/prototype/cvh/data.js so translations plug into the prototype.

Cleanup:
- Research notes ("page would not load; details from web search") are moved out of the
  resident-facing text into sourceNotes, for Hub staff only.
- "No emergency-specific services listed" style sentences are dropped; a place with no
  emergency role gets emergencyRole: null.
- Rows repeated for each category a place appears under are merged.

Translations are added by scripts/translate_catalogue.py, which fills the per-language
fields from data/catalogue/translations/<lang>.json. Re-running this script keeps them.
"""
import csv
import difflib
import hashlib
import json
import re
from collections import OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / 'data/seed/TPCH_Community_Assets_v2.csv'
PROTO_DATA = ROOT / 'design/prototype/cvh/data.js'
OUT_DIR = ROOT / 'data/catalogue'
OUT_PATH = OUT_DIR / 'providers.json'
TRANSLATIONS_DIR = OUT_DIR / 'translations'

# Order from the prototype (brief 3.2.2): by community size, English last.
LANGUAGES = ['ur', 'ps', 'tl', 'prs', 'gu', 'ta', 'el', 'sk', 'bn', 'hi', 'pa', 'zh', 'es', 'fr', 'en']

# A parenthetical is a research note if it talks about where the details came from.
NOTE_PATTERN = re.compile(
    r'would not load|could not be loaded|failed to render|not load directly|via search|web search|'
    r'failed to load|returned minimal|search results did not|no official website found|uncertainty|details from|'
    r'specifics from|homepage did not', re.I)
# Unbracketed sentences addressed to Hub staff.
INTERNAL_PATTERN = re.compile(r'before publishing|not currently listed on the official', re.I)
# Sentences that only say there is no emergency role.
NO_ROLE_PATTERN = re.compile(
    r'^No (emergency-specific|911-style|separate emergency|other emergency|dedicated emergency)[^.]*\.?$', re.I)


def text_id(text):
    """Stable key for a piece of English text, so an edit triggers a fresh translation."""
    return hashlib.sha1(text.encode('utf-8')).hexdigest()[:12]


def tidy(text):
    text = re.sub(r'\s+', ' ', text).strip()
    text = re.sub(r'\s+([.,;:])', r'\1', text)
    text = re.sub(r'\.\.+', '.', text)
    return text


def split_notes(text):
    """Return (resident text, [research notes]) with notes taken out of parentheses."""
    notes = []

    def take(m):
        inner = m.group(1).strip()
        if NOTE_PATTERN.search(inner):
            notes.append(inner)
            return ''
        return m.group(0)

    text = re.sub(r'\(([^()]*)\)', take, text)
    # Sentences written for the Hub, not residents ("verify before publishing").
    for sentence in split_sentences(text):
        if INTERNAL_PATTERN.search(sentence):
            notes.append(sentence.strip())
            text = text.replace(sentence, '')
    # A closing "Note: ..." about where the details came from, outside parentheses.
    m = re.search(r'\bNote:\s*(.*)$', text)
    if m and NOTE_PATTERN.search(m.group(1)):
        notes.append(m.group(1).strip())
        text = text[:m.start()]
    return tidy(text), notes


def split_sentences(text):
    return [s for s in re.split(r'(?<=[.!?])\s+(?=[A-Z])', text) if s]


def clean_emergency(text):
    text, notes = split_notes(text)
    kept = [s for s in split_sentences(text) if not NO_ROLE_PATTERN.match(s.strip())]
    return tidy(' '.join(kept)) or None, notes


def unique(values):
    return list(OrderedDict.fromkeys(v for v in values if v))


def merge_texts(texts, sep):
    """Join the texts of merged rows, dropping sentences an earlier row already said."""
    seen, parts = set(), []
    for text in unique(texts):
        kept = [s for s in split_sentences(text) if s.strip() not in seen]
        seen.update(s.strip() for s in kept)
        if kept:
            parts.append(' '.join(kept))
    return sep.join(parts)


def norm_street(street):
    return re.sub(r'\s*\([^)]*\)', '', street).strip()


def load_proto_ids():
    src = PROTO_DATA.read_text(encoding='utf-8')
    data = json.loads(src[src.index('{'):src.rindex('}') + 1])
    return {(a['name'], norm_street(a['street'])): a['id'] for a in data['assets'] if a.get('source') == 'csv'}


def load_translations():
    out = {}
    for lang in LANGUAGES:
        path = TRANSLATIONS_DIR / f'{lang}.json'
        if path.exists():
            out[lang] = json.loads(path.read_text(encoding='utf-8'))
    return out


def localized(text, translations):
    """{"id": ..., "en": text, "<lang>": translation or null} for every language."""
    if text is None:
        return None
    key = text_id(text)
    entry = {'id': key, 'en': text}
    for lang in LANGUAGES:
        if lang != 'en':
            tr = translations.get(lang, {}).get('texts', {}).get(key)
            entry[lang] = tr['text'] if tr and tr.get('source') == text else None
    return entry


def main():
    with CSV_PATH.open(encoding='utf-8-sig') as f:
        rows = [{k: (v or '').strip() for k, v in r.items()} for r in csv.DictReader(f)]

    proto_ids = load_proto_ids()
    groups = OrderedDict()
    for r in rows:
        groups.setdefault((r['Organization'], r['Street Address']), []).append(r)

    translations = load_translations()
    providers, unmatched, all_notes = [], [], 0
    for (name, street), group in groups.items():
        pid = proto_ids.get((name, norm_street(street)))
        if not pid:
            # A corrected spelling in the spreadsheet: match the closest name at the same address.
            same_street = {n: i for (n, st), i in proto_ids.items() if st == norm_street(street)}
            close = difflib.get_close_matches(name, list(same_street), n=1, cutoff=0.9)
            pid = same_street[close[0]] if close else None
        if not pid:
            unmatched.append(name)
            continue
        first = group[0]

        services, emergency, notes = [], [], []
        for r in group:
            s, n = split_notes(r['Day-to-Day Services & Programs'])
            services.append(s)
            notes += n
            e, n = clean_emergency(r['Emergency Services & Role'])
            emergency.append(e)
            notes += n
        notes = unique(notes)
        all_notes += len(notes)

        providers.append({
            'id': pid,
            'name': name,
            'categories': unique(r['Category'] for r in group),
            'subcategories': unique(r['Subcategory'] for r in group),
            'address': {'street': norm_street(street), 'city': first['City'], 'postal': first['Postal Code'] or None},
            'location': {'lat': float(first['Y-Field (Lat)']), 'lng': float(first['X-Field (Long)'])},
            'contact': {
                'phone': unique(r['Phone Number'] for r in group),
                'email': unique(r['Email Address'] for r in group),
                'social': unique(r['Social Media'] for r in group),
                'web': unique(r['Website'] for r in group),
            },
            'services': localized(merge_texts(services, '\n\n'), translations),
            'emergencyRole': localized(merge_texts(emergency, ' ') or None, translations),
            'sourceNotes': notes,
            'lastConfirmed': None,
        })

    providers.sort(key=lambda p: p['id'])
    # Keep the order of the committed catalogue: the providers seed stores each category's
    # display order from it, so moving a row in the spreadsheet must not reorder the directory.
    previous = json.loads(OUT_PATH.read_text(encoding='utf-8'))['labels'] if OUT_PATH.exists() else {}

    def ordered(kind, names):
        names = unique(names)
        kept = [n for n in previous.get(kind, {}) if n in names]
        return kept + [n for n in names if n not in kept]

    labels = {
        'categories': {c: localized(c, translations) for c in ordered('categories', (r['Category'] for r in rows))},
        'subcategories': {c: localized(c, translations) for c in ordered('subcategories', (r['Subcategory'] for r in rows))},
    }
    models = {lang: t.get('models', {}) for lang, t in translations.items()}

    catalogue = {
        'meta': {
            'source': str(CSV_PATH.relative_to(ROOT)),
            'languages': LANGUAGES,
            'note': 'English is the source. Other languages are machine translations (Cohere), not yet '
                    'reviewed by native readers. A null translation means not yet available in that language.',
            'translationModels': models,
            'counts': {'rows': len(rows), 'providers': len(providers)},
        },
        'labels': labels,
        'providers': providers,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(catalogue, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')

    texts = {e['id'] for p in providers for e in (p['services'], p['emergencyRole']) if e}
    texts |= {e['id'] for group in labels.values() for e in group.values()}
    print(f'{len(rows)} rows -> {len(providers)} providers, {len(texts)} distinct texts to translate, '
          f'{all_notes} research notes moved to sourceNotes')
    if unmatched:
        print('WARNING: no prototype ID for:', ', '.join(unmatched))
    for lang in LANGUAGES[:-1]:
        done = sum(1 for p in providers for e in (p['services'], p['emergencyRole']) if e and e[lang])
        need = sum(1 for p in providers for e in (p['services'], p['emergencyRole']) if e)
        print(f'  {lang}: {done}/{need} provider texts translated')


if __name__ == '__main__':
    main()
