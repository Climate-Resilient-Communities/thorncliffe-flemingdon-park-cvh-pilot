"""Runs scripts/translate_catalogue.py with a stubbed translator, for test/content-scripts.test.ts.

No API is called: the Cohere key lookup and the chat call are replaced. Every call is appended to
the file named by STUB_CALL_LOG as one JSON line {"model", "text"}. The stub answers in the
target language's script (so the script checks pass) and keeps the digits of the English, or,
with STUB_MODE=english, answers with the English unchanged (which the checks reject).

  CVH_CATALOGUE_DIR=<folder> STUB_CALL_LOG=<file> python3 stub_translate.py --content --langs ur,zh
"""
import json
import os
import re
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import translate_catalogue as t  # noqa: E402

WORDS = {
    'ur': 'ٹھیک ہے ',
    'zh': '软件 网络 信息 ',
    'es': 'el la los de y para en con que un una ',
    'fr': 'le la les des de et pour en avec du au ',
}
lock = threading.Lock()


def fake_chat(key, model, system, text):
    with lock, open(os.environ['STUB_CALL_LOG'], 'a', encoding='utf-8') as log:
        log.write(json.dumps({'model': model, 'text': text}, ensure_ascii=False) + '\n')
    if os.environ.get('STUB_MODE') == 'english':
        return text
    lang = next(l for l, target in t.TARGETS.items() if target in system)
    out = ''
    while len(out) < len(text) * 0.9:
        out += WORDS[lang]
    return (out.strip() + ' ' + ' '.join(sorted(set(re.findall(r'\d+', text))))).strip()


t.api_key = lambda *args, **kwargs: 'stub-key'
t.chat = fake_chat
sys.argv = ['translate_catalogue.py'] + sys.argv[1:]
t.main()
