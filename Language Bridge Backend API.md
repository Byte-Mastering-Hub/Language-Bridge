# 🌐 Language Bridge Backend API

The Language Bridge backend provides the **translation engine** used by the browser extension.

It processes messages sent from the extension and returns translated text in real time.

---

# 🚀 Features

- Language detection
- Real-time text translation
- API for browser extension
- Voice transcription support (planned)

---

# 🧠 API Workflow

1. Browser extension captures chat message
2. Message sent to backend API
3. API detects language
4. API translates message
5. Translation returned to extension
6. Extension displays translation

---

# 🏗 System Architecture

Extension
│
▼
Translation API (FastAPI)
│
├── Language Detection
├── Translation Service
└── Speech-to-text (future)

---

# 📂 Backend Structure

backend
app/
main.py
services/
translation_service.py
language_detection.py
speech_service.py
models/
translation_model.py
requirements.txt


---

# ⚙️ Setup

### 1 Install dependencies

pip install -r requirements.txt


---

### 2 Run backend server

uvicorn app.main:app --reload


Server will start at:

http://127.0.0.1:8000

---

# 📡 API Endpoint

### Translate Message

POST /translate


Request:

{
"text": "Hola amigo"
}

Response:

{
"translation": "Hello friend"
}

---

# 🛠 Technologies Used

- Python
- FastAPI
- Uvicorn
- Langdetect
- Deep Translator
- Whisper (planned)

---

# 🔮 Future Improvements

- IndicTrans2 integration for Indian languages
- NLLB multilingual translation
- Whisper voice transcription
- Meeting subtitle translation

---

# 👨‍💻 Authors

Language Bridge – Hackathon Project

Sumit Tak  
Ayekpam Prithiviraj  
Vishal Kumar  
Ayush
