"""
LinguaBridge Unified Server
FastAPI backend connecting all services: translation, speech-to-text, real-time chat
"""

import os
import base64
import uuid
import json
from datetime import datetime

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional
import socketio

from config import Config
from translator import TranslationService
from speech import VoxtralSpeechService

# ─── App Setup ────────────────────────────────────────────────

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins="*")

app = FastAPI(
    title="LinguaBridge API",
    description="Unified backend for real-time multilingual chat with translation and speech-to-text",
    version="3.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Services ─────────────────────────────────────────────────

translator = TranslationService()
speech_service = VoxtralSpeechService()

# ─── In-Memory Storage ────────────────────────────────────────

users = {}            # user_id -> user info
active_connections = {}  # user_id -> WebSocket
user_languages = {}   # user_id -> preferred language

# ─── Pydantic Models ─────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: Optional[str] = None

class RegisterRequest(BaseModel):
    username: str
    password: str
    language: str = "en"

class TranslationRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)
    source_lang: str = "auto"
    target_lang: str = "en"

class DetectLanguageRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=5000)

class MessageRequest(BaseModel):
    text: str
    chatId: Optional[str] = None
    targetLang: Optional[str] = None

# ─── WebSocket Connection Manager ────────────────────────────

class ConnectionManager:
    """Manages WebSocket connections for real-time chat."""

    def __init__(self):
        self.active: dict[str, WebSocket] = {}

    async def connect(self, user_id: str, websocket: WebSocket):
        await websocket.accept()
        self.active[user_id] = websocket

    def disconnect(self, user_id: str):
        self.active.pop(user_id, None)
        users.pop(user_id, None)
        user_languages.pop(user_id, None)

    async def send_personal(self, user_id: str, data: dict):
        ws = self.active.get(user_id)
        if ws:
            await ws.send_json(data)

    async def broadcast(self, data: dict, exclude: str | None = None):
        for uid, ws in list(self.active.items()):
            if uid != exclude:
                try:
                    await ws.send_json(data)
                except Exception:
                    self.disconnect(uid)

manager = ConnectionManager()

# ─── Frontend Serving ─────────────────────────────────────────

FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "Language Bridge", "frontend")

@app.get("/")
async def serve_index():
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

@app.get("/register.html")
async def serve_register():
    return FileResponse(os.path.join(FRONTEND_DIR, "register.html"))

@app.get("/chat.html")
async def serve_chat():
    return FileResponse(os.path.join(FRONTEND_DIR, "chat.html"))

# Serve static frontend assets (css, js, images)
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="frontend_static")

# ─── Auth Endpoints ──────────────────────────────────────────

@app.post("/api/login")
async def login(req: LoginRequest):
    username = req.username.strip()
    if not username:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user_id = str(uuid.uuid4())
    user = {"id": user_id, "username": username, "language": "en"}
    users[user_id] = user
    return {"success": True, "user": user}

@app.post("/api/register")
async def register(req: RegisterRequest):
    username = req.username.strip()
    password = req.password
    language = req.language

    if not username or not password:
        raise HTTPException(status_code=400, detail="Invalid data")

    user_id = str(uuid.uuid4())
    user = {"id": user_id, "username": username, "language": language}
    users[user_id] = user
    return {"success": True, "user": user}

@app.post("/api/logout")
async def logout():
    return {"success": True}

@app.get("/api/current-user")
async def current_user():
    return {
        "user": {
            "id": "1",
            "username": "John Doe",
            "language": "en",
        }
    }

# ─── Contacts & Chat History ─────────────────────────────────

@app.get("/api/contacts")
async def get_contacts():
    return [
        {
            "id": "1",
            "username": "Maria Kim",
            "online": True,
            "lastMessage": "Hello! How are you?",
            "lastSeen": "2m",
        },
        {
            "id": "2",
            "username": "Yuki Tanaka",
            "online": False,
            "lastMessage": "Thanks for your help!",
            "lastSeen": "1h",
        },
        {
            "id": "3",
            "username": "Carlos Silva",
            "online": False,
            "lastMessage": "Como estas?",
            "lastSeen": "3h",
        },
    ]

@app.get("/api/chat-history/{contact_id}")
async def chat_history(contact_id: str):
    return [
        {
            "id": "1",
            "senderId": "2",
            "senderName": "Maria Kim",
            "text": "Hello! How are you today?",
            "translatedText": "Hola! Como estas hoy?",
            "timestamp": datetime.now().isoformat(),
        },
        {
            "id": "2",
            "senderId": "1",
            "senderName": "John Doe",
            "text": "I'm doing great, thanks!",
            "translatedText": "Estoy muy bien, gracias!",
            "timestamp": datetime.now().isoformat(),
        },
    ]

# ─── Translation Endpoints ───────────────────────────────────

@app.post("/api/translate")
async def translate_text(req: TranslationRequest):
    try:
        result = translator.translate(req.text, req.source_lang, req.target_lang)
        return result
    except Exception as exc:
        print(f"[server] /api/translate error: {exc}")
        return {
            "original_text":   req.text,
            "translated_text": req.text,
            "source_lang":     req.source_lang,
            "target_lang":     req.target_lang,
            "error":           str(exc),
        }

@app.post("/api/detect-language")
async def detect_language(req: DetectLanguageRequest):
    result = translator.detect_language(req.text)
    return result

@app.get("/api/languages")
async def get_languages():
    return {"languages": Config.SUPPORTED_LANGUAGES}

# ─── Speech-to-Text Endpoint ─────────────────────────────────

@app.post("/api/speech-to-text")
async def speech_to_text(audio: UploadFile = File(...), language: str = Form("en")):
    temp_path = os.path.join(Config.TEMP_AUDIO_DIR, f"{uuid.uuid4()}.wav")
    try:
        contents = await audio.read()
        with open(temp_path, "wb") as f:
            f.write(contents)
        result = speech_service.transcribe_file(temp_path, language)
        return result
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

@app.get("/api/speech-languages")
async def get_speech_languages():
    return {"languages": speech_service.get_supported_languages()}

# ─── Health / Info ────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "services": {
            "translation": "Google Translate (free)",
            "speech": "Google Web Speech API",
        },
        "supported_languages": len(Config.SUPPORTED_LANGUAGES),
    }

# ─── WebSocket Real-Time Chat ────────────────────────────────

@app.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    await manager.connect(user_id, websocket)
    print(f"[+] Client connected: {user_id}")

    # Notify others
    await manager.broadcast(
        {"event": "user_joined", "userId": user_id, "timestamp": datetime.now().isoformat()},
        exclude=user_id,
    )

    try:
        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            event = data.get("event", "")

            # ── join ──────────────────────────────
            if event == "join":
                username = data.get("username", f"User-{user_id[:4]}")
                language = data.get("language", "en")
                users[user_id] = {
                    "username": username,
                    "language": language,
                    "joined_at": datetime.now().isoformat(),
                }
                user_languages[user_id] = language
                await manager.broadcast(
                    {"event": "user_joined", "userId": user_id, "username": username, "language": language},
                    exclude=user_id,
                )
                print(f"[+] User joined: {username} ({language})")

            # ── send-message ──────────────────────
            elif event == "send-message":
                text = data.get("text", "").strip()
                if not text:
                    continue

                sender = users.get(user_id, {})
                sender_name = sender.get("username", "Unknown")
                source_lang = sender.get("language", "en")
                target_lang = data.get("targetLang", "en")

                translation_result = translator.translate(text, source_lang, target_lang)

                message = {
                    "event": "new-message",
                    "id": str(uuid.uuid4()),
                    "senderId": user_id,
                    "sender": sender_name,
                    "text": text,
                    "translatedText": translation_result.get("translated_text", text),
                    "sourceLang": source_lang,
                    "targetLang": target_lang,
                    "timestamp": datetime.now().isoformat(),
                }
                await manager.broadcast(message)
                print(f"[msg] {sender_name}: {text}")

            # ── voice-message ─────────────────────
            elif event == "voice-message":
                audio_data = data.get("audio", "")
                if not audio_data:
                    continue

                sender = users.get(user_id, {})
                sender_name = sender.get("username", "Unknown")
                source_lang = sender.get("language", "en")
                target_lang = data.get("targetLang", source_lang)
                duration = data.get("duration", 0)

                try:
                    audio_bytes = base64.b64decode(
                        audio_data.split(",")[-1] if "," in audio_data else audio_data
                    )
                    transcription = speech_service.transcribe_stream(audio_bytes, source_lang)

                    if transcription.get("success"):
                        transcribed_text = transcription["text"]
                        translated_text = transcribed_text

                        if target_lang and target_lang != source_lang:
                            tr = translator.translate(transcribed_text, source_lang, target_lang)
                            translated_text = tr.get("translated_text", transcribed_text)

                        message = {
                            "event": "new-voice-message",
                            "id": str(uuid.uuid4()),
                            "type": "voice",
                            "senderId": user_id,
                            "sender": sender_name,
                            "text": transcribed_text,
                            "translatedText": translated_text,
                            "sourceLang": source_lang,
                            "targetLang": target_lang,
                            "duration": duration,
                            "audio": audio_data,
                            "timestamp": datetime.now().isoformat(),
                        }
                        await manager.broadcast(message)
                        print(f"[voice] {sender_name}: {transcribed_text}")
                    else:
                        err = transcription.get("error", "Unknown error")
                        print(f"[warn] Transcription failed: {err}")
                        await manager.send_personal(
                            user_id,
                            {"event": "error", "message": f"Transcription failed: {err}"},
                        )
                except Exception as e:
                    print(f"[error] Voice message error: {e}")
                    await manager.send_personal(
                        user_id,
                        {"event": "error", "message": f"Voice processing error: {str(e)}"},
                    )

            # ── typing ────────────────────────────
            elif event == "typing":
                sender = users.get(user_id, {})
                await manager.broadcast(
                    {
                        "event": "user-typing",
                        "userId": user_id,
                        "username": sender.get("username", "Unknown"),
                        "isTyping": data.get("isTyping", False),
                    },
                    exclude=user_id,
                )

            # ── file-shared ───────────────────────
            elif event == "file-shared":
                sender = users.get(user_id, {})
                await manager.broadcast(
                    {
                        "event": "new-file",
                        "senderId": user_id,
                        "sender": sender.get("username", "Unknown"),
                        "fileInfo": data.get("fileInfo", {}),
                        "timestamp": datetime.now().isoformat(),
                    }
                )

    except WebSocketDisconnect:
        manager.disconnect(user_id)
        print(f"[-] Client disconnected: {user_id}")
        await manager.broadcast(
            {"event": "user_left", "userId": user_id, "timestamp": datetime.now().isoformat()}
        )

# ─── Catch-all: serve frontend files by path ─────────────────

@app.get("/{filepath:path}")
async def serve_frontend(filepath: str):
    file_path = os.path.join(FRONTEND_DIR, filepath)
    if os.path.isfile(file_path):
        return FileResponse(file_path)
    raise HTTPException(status_code=404, detail="File not found")

# ─── Socket.IO Event Handlers ────────────────────────────────

@sio.event
async def connect(sid, environ):
    print(f"[+] Socket.IO client connected: {sid}")

@sio.event
async def disconnect(sid):
    print(f"[-] Socket.IO client disconnected: {sid}")
    users.pop(sid, None)
    user_languages.pop(sid, None)
    await sio.emit("user_left", {"userId": sid, "timestamp": datetime.now().isoformat()})

@sio.on("user-online")
async def handle_user_online(sid, user_id):
    print(f"[+] User online: {user_id} (sid={sid})")

@sio.on("join")
async def handle_join(sid, data):
    username = data.get("username", f"User-{sid[:4]}")
    language = data.get("language", "en")
    users[sid] = {
        "username": username,
        "language": language,
        "joined_at": datetime.now().isoformat(),
    }
    user_languages[sid] = language
    await sio.emit(
        "user_joined",
        {"userId": sid, "username": username, "language": language},
        skip_sid=sid,
    )
    print(f"[+] User joined: {username} ({language})")

@sio.on("send-message")
async def handle_send_message(sid, data):
    text = data.get("text", "").strip()
    if not text:
        return

    sender = users.get(sid, {})
    sender_name = sender.get("username", "Unknown")
    source_lang = sender.get("language", "en")
    target_lang = data.get("targetLang", "en")

    translation_result = translator.translate(text, source_lang, target_lang)

    message = {
        "event": "new-message",
        "id": str(uuid.uuid4()),
        "senderId": sid,
        "sender": sender_name,
        "text": text,
        "translatedText": translation_result.get("translated_text", text),
        "sourceLang": source_lang,
        "targetLang": target_lang,
        "timestamp": datetime.now().isoformat(),
    }
    await sio.emit("new-message", message, skip_sid=sid)
    print(f"[msg] {sender_name}: {text}")

@sio.on("voice-message")
async def handle_voice_message(sid, data):
    audio_data = data.get("audio", "")
    if not audio_data:
        return

    sender = users.get(sid, {})
    sender_name = sender.get("username", "Unknown")
    source_lang = sender.get("language", "en")
    target_lang = data.get("targetLang", source_lang)
    duration = data.get("duration", 0)

    try:
        audio_bytes = base64.b64decode(
            audio_data.split(",")[-1] if "," in audio_data else audio_data
        )
        transcription = speech_service.transcribe_stream(audio_bytes, source_lang)

        if transcription.get("success"):
            transcribed_text = transcription["text"]
            translated_text = transcribed_text

            if target_lang and target_lang != source_lang:
                tr = translator.translate(transcribed_text, source_lang, target_lang)
                translated_text = tr.get("translated_text", transcribed_text)

            message = {
                "event": "new-voice-message",
                "id": str(uuid.uuid4()),
                "type": "voice",
                "senderId": sid,
                "sender": sender_name,
                "text": transcribed_text,
                "translatedText": translated_text,
                "sourceLang": source_lang,
                "targetLang": target_lang,
                "duration": duration,
                "audio": audio_data,
                "timestamp": datetime.now().isoformat(),
            }
            await sio.emit("new-voice-message", message)
            print(f"[voice] {sender_name}: {transcribed_text}")
        else:
            err = transcription.get("error", "Unknown error")
            print(f"[warn] Transcription failed: {err}")
            await sio.emit("error", {"message": f"Transcription failed: {err}"}, to=sid)
    except Exception as e:
        print(f"[error] Voice message error: {e}")
        await sio.emit("error", {"message": f"Voice processing error: {str(e)}"}, to=sid)

@sio.on("typing")
async def handle_typing(sid, data):
    sender = users.get(sid, {})
    await sio.emit(
        "user-typing",
        {
            "userId": sid,
            "username": sender.get("username", "Unknown"),
            "isTyping": data.get("isTyping", False),
        },
        skip_sid=sid,
    )

@sio.on("file-shared")
async def handle_file_shared(sid, data):
    sender = users.get(sid, {})
    await sio.emit("new-file", {
        "senderId": sid,
        "sender": sender.get("username", "Unknown"),
        "fileInfo": data.get("fileInfo", {}),
        "timestamp": datetime.now().isoformat(),
    })

# ─── Wrap FastAPI with Socket.IO ASGI app ─────────────────────

combined_app = socketio.ASGIApp(sio, other_asgi_app=app)

# ─── Run Server ──────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    print("=" * 60)
    print("  LINGUABRIDGE UNIFIED SERVER")
    print("=" * 60)
    print(f"  Translation : Google Translate (free)")
    print(f"  Speech STT  : Google Web Speech API")
    print(f"  Languages   : {len(Config.SUPPORTED_LANGUAGES)} supported")
    print(f"  WebSocket   : FastAPI native (/ws/{{user_id}})")
    print("=" * 60)
    print(f"  HTTP  -> http://localhost:{Config.PORT}")
    print(f"  WS    -> ws://localhost:{Config.PORT}/ws/{{user_id}}")
    print("=" * 60)

    uvicorn.run(combined_app, host="0.0.0.0", port=Config.PORT)
