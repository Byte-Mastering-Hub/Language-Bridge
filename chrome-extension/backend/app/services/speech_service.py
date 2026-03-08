import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Optional

from app.models.speech_model import DEFAULT_WHISPER_MODEL

try:
    import whisper
except Exception:  # pragma: no cover - runtime fallback
    whisper = None


class SpeechService:
    def __init__(self, model_name: str = DEFAULT_WHISPER_MODEL) -> None:
        self.model_name = model_name

    @lru_cache(maxsize=1)
    def _get_model(self):
        if whisper is None:
            raise RuntimeError("Whisper is not installed. Install openai-whisper to enable transcription.")
        return whisper.load_model(self.model_name)

    def transcribe(self, audio_bytes: bytes, filename: str, language: Optional[str] = None) -> str:
        if not audio_bytes:
            raise RuntimeError("Audio file is empty.")

        extension = Path(filename).suffix or ".wav"

        with tempfile.NamedTemporaryFile(delete=False, suffix=extension) as temp_file:
            temp_file.write(audio_bytes)
            temp_path = temp_file.name

        try:
            model = self._get_model()
            options = {}
            if language and language != "unknown":
                options["language"] = language

            result = model.transcribe(temp_path, **options)
            text = (result.get("text") or "").strip()

            if not text:
                raise RuntimeError("Whisper returned an empty transcript.")

            return text
        finally:
            if os.path.exists(temp_path):
                os.remove(temp_path)
