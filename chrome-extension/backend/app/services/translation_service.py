from typing import Optional

from app.models.translation_model import (
    GLOBAL_MODEL,
    INDIAN_MODEL,
    INDIAN_LANGUAGE_CODES,
)
from app.services.language_detection import normalize_language_code

try:
    from deep_translator import GoogleTranslator
except Exception:  # pragma: no cover - runtime fallback
    GoogleTranslator = None

PROVIDER_CODE_MAP = {
    "zh": "zh-CN",
}


class TranslationService:
    def __init__(self) -> None:
        self.indian_languages = set(INDIAN_LANGUAGE_CODES)

    def choose_model(self, source_language: str, target_language: str) -> str:
        if source_language in self.indian_languages or target_language in self.indian_languages:
            return INDIAN_MODEL
        return GLOBAL_MODEL

    def translate_text(
        self,
        text: str,
        source_language: Optional[str],
        target_language: str,
    ) -> dict:
        source = normalize_language_code(source_language)
        target = normalize_language_code(target_language)
        model = self.choose_model(source, target)

        if source == target:
            return {
                "translated_text": text,
                "target_language": target,
                "model": model,
                "degraded": False,
            }

        if GoogleTranslator is None:
            return {
                "translated_text": text,
                "target_language": target,
                "model": f"{model} (fallback)",
                "degraded": True,
            }

        provider_source = self.to_provider_language(source, default_auto=True)
        provider_target = self.to_provider_language(target, default_auto=False)

        try:
            translated_text = GoogleTranslator(
                source=provider_source,
                target=provider_target,
            ).translate(text)

            return {
                "translated_text": translated_text,
                "target_language": target,
                "model": model,
                "degraded": False,
            }
        except Exception:
            return {
                "translated_text": text,
                "target_language": target,
                "model": f"{model} (fallback)",
                "degraded": True,
            }

    def to_provider_language(self, code: str, default_auto: bool) -> str:
        if code in {"", "unknown"}:
            return "auto" if default_auto else "en"
        return PROVIDER_CODE_MAP.get(code, code)
