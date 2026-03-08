import base64
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.services.language_detection import detect_language
from app.services.speech_service import SpeechService
from app.services.translation_service import TranslationService

app = FastAPI(
    title="Language Bridge API",
    version="0.1.0",
    description="Backend services for translation, language detection, and speech transcription.",
)

translation_service = TranslationService()
speech_service = SpeechService()


class TranslateRequest(BaseModel):
    text: str = Field(..., min_length=1, description="Source text to translate")
    source_language: Optional[str] = Field(default=None, description="ISO language code")
    target_language: str = Field(..., min_length=2, description="ISO language code")
    platform: Optional[str] = Field(default=None, description="Origin platform")


class TranslateResponse(BaseModel):
    original_text: str
    translated_text: str
    detected_language: str
    target_language: str
    model: str
    degraded: bool = False


class DetectRequest(BaseModel):
    text: str = Field(..., min_length=1)


class DetectResponse(BaseModel):
    language: str


class TranscribeBase64Request(BaseModel):
    audio_base64: str = Field(..., min_length=1)
    filename: str = Field(default="audio.wav")
    target_language: str = Field(default="en", min_length=2)
    source_language: Optional[str] = Field(default=None)


@app.get("/health")
def health_check() -> dict:
    return {"status": "ok"}


@app.post("/detect", response_model=DetectResponse)
def detect_endpoint(payload: DetectRequest) -> DetectResponse:
    language = detect_language(payload.text)
    return DetectResponse(language=language)


@app.post("/translate", response_model=TranslateResponse)
def translate_endpoint(payload: TranslateRequest) -> TranslateResponse:
    detected_language = payload.source_language or detect_language(payload.text)

    result = translation_service.translate_text(
        text=payload.text,
        source_language=detected_language,
        target_language=payload.target_language,
    )

    return TranslateResponse(
        original_text=payload.text,
        translated_text=result["translated_text"],
        detected_language=detected_language,
        target_language=result["target_language"],
        model=result["model"],
        degraded=result["degraded"],
    )


@app.post("/transcribe")
async def transcribe_endpoint(
    audio: UploadFile = File(...),
    target_language: str = Form("en"),
    source_language: Optional[str] = Form(default=None),
):
    audio_bytes = await audio.read()
    return transcribe_and_translate(
        audio_bytes=audio_bytes,
        filename=audio.filename or "audio.wav",
        target_language=target_language,
        source_language=source_language,
    )


@app.post("/transcribe/base64")
def transcribe_base64_endpoint(payload: TranscribeBase64Request):
    try:
        audio_bytes = base64.b64decode(payload.audio_base64, validate=True)
    except Exception as error:
        raise HTTPException(status_code=400, detail="Invalid base64 audio payload") from error

    return transcribe_and_translate(
        audio_bytes=audio_bytes,
        filename=payload.filename,
        target_language=payload.target_language,
        source_language=payload.source_language,
    )


def transcribe_and_translate(
    audio_bytes: bytes,
    filename: str,
    target_language: str,
    source_language: Optional[str],
) -> dict:
    try:
        transcript = speech_service.transcribe(
            audio_bytes=audio_bytes,
            filename=filename,
            language=source_language,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    detected_language = source_language or detect_language(transcript)
    translation_result = translation_service.translate_text(
        text=transcript,
        source_language=detected_language,
        target_language=target_language,
    )

    return {
        "transcript": transcript,
        "detected_language": detected_language,
        "target_language": translation_result["target_language"],
        "translated_text": translation_result["translated_text"],
        "model": translation_result["model"],
        "degraded": translation_result["degraded"],
    }
