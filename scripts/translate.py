#!/usr/bin/env python3
"""Pipe text through a cheap LLM to translate it to English.

Usage:  some-command | scripts/translate.py
        scripts/translate.py < file.txt

Reads stdin; if it contains CJK text, translates to English via OpenRouter
(env var OPENROUTER_API), preserving line structure, numbers, IDs and code as-is.
If the input contains no CJK, or the API fails, prints the input unchanged
(with a warning on stderr in the failure case).

Model: override with TRANSLATE_MODEL (default google/gemini-2.5-flash-lite,
falls back to openai/gpt-4o-mini if the default errors).
"""
import json
import os
import re
import sys
import urllib.request

MAX_CHARS = 60000  # keep well under request limits; truncate beyond this


def has_cjk(s: str) -> bool:
    return re.search(r'[一-鿿㐀-䶿]', s) is not None


def call_openrouter(model: str, key: str, text: str) -> str:
    req = urllib.request.Request(
        'https://openrouter.ai/api/v1/chat/completions',
        data=json.dumps({
            'model': model,
            'messages': [
                {'role': 'system', 'content': (
                    'Translate the user text to English. It is command/console/API output: '
                    'keep the exact line structure, whitespace layout, numbers, error codes, '
                    'URLs, identifiers, and any already-English text unchanged. Translate only '
                    'the natural-language (Chinese) parts. Output the translated text only, '
                    'no commentary, no code fences.')},
                {'role': 'user', 'content': text},
            ],
            'temperature': 0,
        }).encode(),
        headers={
            'Authorization': f'Bearer {key}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        data = json.loads(r.read().decode())
    return data['choices'][0]['message']['content']


def main() -> int:
    text = sys.stdin.read()
    if not text.strip() or not has_cjk(text):
        sys.stdout.write(text)
        return 0
    key = os.environ.get('OPENROUTER_API') or os.environ.get('OPENROUTER_API_KEY')
    if not key:
        sys.stdout.write(text)
        print('[translate.py] OPENROUTER_API not set - printed original', file=sys.stderr)
        return 1
    clipped = text[:MAX_CHARS]
    models = [os.environ.get('TRANSLATE_MODEL', 'google/gemini-2.5-flash-lite'),
              'openai/gpt-4o-mini']
    for model in models:
        try:
            out = call_openrouter(model, key, clipped)
            sys.stdout.write(out)
            if not out.endswith('\n'):
                sys.stdout.write('\n')
            if len(text) > MAX_CHARS:
                print(f'[translate.py] input truncated at {MAX_CHARS} chars', file=sys.stderr)
            return 0
        except Exception as e:  # noqa: BLE001 - fall through to next model
            err = e
            continue
    sys.stdout.write(text)
    print(f'[translate.py] translation failed ({err}) - printed original', file=sys.stderr)
    return 1


if __name__ == '__main__':
    sys.exit(main())
