import re
from typing import Optional

try:
    from langdetect import DetectorFactory, LangDetectException, detect
except Exception:  # pragma: no cover - runtime fallback
    DetectorFactory = None
    LangDetectException = Exception
    detect = None

if DetectorFactory:
    DetectorFactory.seed = 0

SCRIPT_HINTS = [
    (r"[\u0980-\u09FF]", "bn"),  # Bengali
    (r"[\u0B80-\u0BFF]", "ta"),  # Tamil
    (r"[\u0C00-\u0C7F]", "te"),  # Telugu
    (r"[\u0A80-\u0AFF]", "gu"),  # Gujarati
    (r"[\u0C80-\u0CFF]", "kn"),  # Kannada
    (r"[\u0D00-\u0D7F]", "ml"),  # Malayalam
    (r"[\u0A00-\u0A7F]", "pa"),  # Punjabi (Gurmukhi)
    (r"[\u0600-\u06FF]", "ur"),  # Urdu / Arabic scripts
    (r"[\u0900-\u097F]", "hi"),  # Hindi / Marathi (Devanagari)
]

NORMALIZATION_MAP = {
    "zh-cn": "zh",
    "zh-tw": "zh",
    "pt-br": "pt",
    "pt-pt": "pt",
    "jp": "ja",
}


def normalize_language_code(code: Optional[str]) -> str:
    if not code:
        return "unknown"
    lowered = code.strip().lower()
    return NORMALIZATION_MAP.get(lowered, lowered)


def script_based_guess(text: str) -> Optional[str]:
    for pattern, code in SCRIPT_HINTS:
        if re.search(pattern, text):
            return code
    return None


def detect_language(text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return "unknown"

    guess = script_based_guess(cleaned)
    if guess:
        return guess

    if detect is None:
        return "unknown"

    try:
        code = detect(cleaned)
        return normalize_language_code(code)
    except LangDetectException:
        return "unknown"
