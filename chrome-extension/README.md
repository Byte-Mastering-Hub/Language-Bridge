# Language Bridge

Language Bridge is a Chrome Extension + Python backend that translates chat messages and subtitles on:

- WhatsApp Web
- Instagram Web
- Facebook Messenger
- Google Meet (live subtitle translation)

It prioritizes Indian regional languages while supporting global languages.

## Project Structure

```text
language-bridge-extension/
  manifest.json
  background.js
  content.js
  popup.html
  popup.js
  styles.css
  icons/icon.png

backend/
  app/
    main.py
    services/
      translation_service.py
      speech_service.py
      language_detection.py
    models/
      translation_model.py
      speech_model.py
  requirements.txt
```

## Run Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Optional speech transcription setup (Whisper):

```bash
# Use Python 3.11 or 3.12 for best Whisper compatibility
pip install -r requirements-whisper.txt
```

Health check:

```bash
curl http://127.0.0.1:8000/health
```

## Load Extension

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select folder: `language-bridge-extension`.

## Configure Language

1. Open extension popup.
2. Pick a language from either:
   - Indian Languages
   - International Languages
3. Click **Save Settings**.

New messages/subtitles translate automatically without page refresh.

## API Endpoints

- `POST /detect` detects language.
- `POST /translate` translates text with Indian-language model routing.
- `POST /transcribe` transcribes audio (Whisper), then translates.
- `POST /transcribe/base64` transcribes base64-encoded audio from extension content scripts.

## Notes

- If backend translation is unavailable, the extension gracefully shows original text.
- `openai-whisper` requires FFmpeg and compatible runtime dependencies.
- `openai-whisper` may fail on Python 3.14; use Python 3.11/3.12 for transcription features.
- Voice-note transcription depends on accessible `<audio>` sources on each supported web app.
