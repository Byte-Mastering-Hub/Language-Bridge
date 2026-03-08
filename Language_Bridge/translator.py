"""
Translation service.

Primary  : Local Facebook/Meta model (NLLB-200 or M2M-100) loaded from the
           path in config.TRANSLATION_MODEL_PATH via HuggingFace transformers.
Fallback : Google Translate public endpoint using only Python stdlib (urllib),
           so the app still works even when no local model is configured.
"""

import hashlib
import json
import urllib.parse
import urllib.request
from config import Config

# ── Google Translate fallback helpers ─────────────────────────────────────────

_GT_HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/120.0.0.0 Safari/537.36'
    )
}

_GOOGLE_CODES = {
    'zh':    'zh-CN',
    'zh-cn': 'zh-CN',
    'zh-tw': 'zh-TW',
}

# ── NLLB-200 language codes ────────────────────────────────────────────────────

_NLLB_CODES = {
    'en':    'eng_Latn',
    'es':    'spa_Latn',
    'fr':    'fra_Latn',
    'de':    'deu_Latn',
    'ja':    'jpn_Jpan',
    'ko':    'kor_Hang',
    'zh':    'zho_Hans',
    'zh-cn': 'zho_Hans',
    'hi':    'hin_Deva',
    'ar':    'arb_Arab',
    'pt':    'por_Latn',
    'ru':    'rus_Cyrl',
    'it':    'ita_Latn',
    'nl':    'nld_Latn',
    'pl':    'pol_Latn',
    'tr':    'tur_Latn',
    'vi':    'vie_Latn',
    'th':    'tha_Thai',
    'id':    'ind_Latn',
}


class TranslationService:
    def __init__(self):
        self.cache = {}
        self.supported_languages = Config.SUPPORTED_LANGUAGES
        self._model      = None
        self._tokenizer  = None
        self._model_type = None   # 'nllb' or 'm2m'
        self._device     = getattr(Config, 'TRANSLATION_DEVICE', 'cpu')
        self._load_local_model()

    # ── model loading ──────────────────────────────────────────────────────────

    def _load_local_model(self):
        model_path = getattr(Config, 'TRANSLATION_MODEL_PATH', '') or ''
        if not model_path:
            print('[translator] No local model path set — using Google Translate fallback.')
            return

        try:
            import torch
            from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

            print(f'[translator] Loading Facebook model from: {model_path}')
            self._tokenizer = AutoTokenizer.from_pretrained(model_path)
            self._model     = AutoModelForSeq2SeqLM.from_pretrained(model_path)
            self._model.eval()

            if self._device != 'cpu':
                self._model = self._model.to(self._device)

            # Detect model type from path or tokenizer class name
            mp = model_path.lower()
            tok_cls = type(self._tokenizer).__name__.lower()
            if 'nllb' in mp or 'nllb' in tok_cls:
                self._model_type = 'nllb'
            else:
                self._model_type = 'm2m'

            print(f'[translator] Model ready ({self._model_type}).')

        except Exception as exc:
            print(f'[translator] Could not load local model: {exc}')
            print('[translator] Falling back to Google Translate.')
            self._model     = None
            self._tokenizer = None

    # ── translation backends ───────────────────────────────────────────────────

    def _translate_model(self, text, source_lang, target_lang):
        """Translate with the loaded transformers model."""
        import torch

        if self._model_type == 'nllb':
            src_code = _NLLB_CODES.get(source_lang.lower(), source_lang)
            tgt_code = _NLLB_CODES.get(target_lang.lower(), target_lang)

            self._tokenizer.src_lang = src_code
            inputs = self._tokenizer(text, return_tensors='pt', padding=True)

            if self._device != 'cpu':
                inputs = {k: v.to(self._device) for k, v in inputs.items()}

            forced_id = self._tokenizer.lang_code_to_id[tgt_code]
            with torch.no_grad():
                output = self._model.generate(
                    **inputs,
                    forced_bos_token_id=forced_id,
                    max_new_tokens=512,
                )

        else:  # m2m / mbart
            self._tokenizer.src_lang = source_lang
            inputs = self._tokenizer(text, return_tensors='pt', padding=True)

            if self._device != 'cpu':
                inputs = {k: v.to(self._device) for k, v in inputs.items()}

            forced_id = self._tokenizer.get_lang_id(target_lang)
            with torch.no_grad():
                output = self._model.generate(
                    **inputs,
                    forced_bos_token_id=forced_id,
                    max_new_tokens=512,
                )

        return self._tokenizer.batch_decode(output, skip_special_tokens=True)[0]

    def _translate_google(self, text, source_lang, target_lang):
        """Fallback: Google Translate via stdlib urllib (no API key needed)."""
        src  = 'auto' if source_lang == 'auto' else _GOOGLE_CODES.get(source_lang.lower(), source_lang)
        dest = _GOOGLE_CODES.get(target_lang.lower(), target_lang)

        params = urllib.parse.urlencode({
            'client': 'gtx',
            'sl':     src,
            'tl':     dest,
            'dt':     't',
            'q':      text,
        })
        url = f'https://translate.googleapis.com/translate_a/single?{params}'
        req = urllib.request.Request(url, headers=_GT_HEADERS)

        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))

        return ''.join(chunk[0] for chunk in data[0] if chunk[0])

    # ── public interface ───────────────────────────────────────────────────────

    def _get_cache_key(self, text, source_lang, target_lang):
        return hashlib.md5(f'{text}|{source_lang}|{target_lang}'.encode()).hexdigest()

    def translate(self, text, source_lang='auto', target_lang='en'):
        """Translate text from source_lang to target_lang."""
        if not text or not text.strip():
            return {
                'original_text':   text,
                'translated_text': text,
                'source_lang':     source_lang,
                'target_lang':     target_lang,
            }

        cache_key = self._get_cache_key(text, source_lang, target_lang)
        if cache_key in self.cache:
            return self.cache[cache_key]

        try:
            if self._model is not None and source_lang != 'auto':
                translated = self._translate_model(text, source_lang, target_lang)
                method = 'model'
            else:
                translated = self._translate_google(text, source_lang, target_lang)
                method = 'google'

            result = {
                'original_text':   text,
                'translated_text': translated,
                'source_lang':     source_lang,
                'target_lang':     target_lang,
                'method':          method,
            }
            self.cache[cache_key] = result
            return result

        except Exception as exc:
            print(f'[translator] Translation error: {exc}')
            return {
                'original_text':   text,
                'translated_text': text,
                'source_lang':     source_lang,
                'target_lang':     target_lang,
                'error':           str(exc),
            }

    def detect_language(self, text):
        """Detect the language of text using langdetect."""
        try:
            from langdetect import detect
            return {'language': detect(text), 'confidence': 1.0}
        except Exception as exc:
            print(f'[translator] Language detection error: {exc}')
            return {'language': 'unknown', 'confidence': 0}
