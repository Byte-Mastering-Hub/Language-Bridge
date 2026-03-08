# 🌐 Language Bridge – Browser Extension

Language Bridge is a browser extension that enables **real-time language translation across chat platforms**. It helps users understand messages written in different languages without leaving the chat application.

The extension automatically detects incoming messages and translates them into the user’s preferred language directly inside the webpage.

---

# 🚀 Features

### 🌍 Real-Time Translation
Automatically translates messages on supported platforms such as:

- WhatsApp Web
- Instagram
- Facebook Messenger

Messages appear with translated text directly below the original message.

Example:

Original Message:
Hola amigo

Translation:
🌐 Hello friend

---

### 🇮🇳 Indian Language Support

Language Bridge prioritizes Indian regional languages including:

- Hindi
- Tamil
- Telugu
- Marathi
- Gujarati
- Bengali
- Kannada
- Malayalam
- Punjabi
- Urdu

---

### 🌎 International Language Support

The extension also supports global languages such as:

- English
- Spanish
- French
- German
- Chinese
- Japanese
- Arabic
- Portuguese

---

### 🔄 Runtime Language Switching

Users can change their preferred language at any time from the extension popup.

Translations will automatically update for future messages without refreshing the page.

---

# 🧠 How It Works

1. The extension detects messages from chat platforms.
2. The message text is extracted using a **content script**.
3. The message is sent to the backend translation API.
4. The API detects the language and translates the message.
5. The translated text is inserted back into the webpage as an overlay.

---

# 🏗 Extension Architecture

Browser
│  
▼  
Language Bridge Extension  
│  
├── Content Script  
│   Reads chat messages from the webpage  
│  
├── Background Script  
│   Sends messages to translation API  
│  
└── Popup UI  
    Language selection and settings  

---

# 📂 Folder Structure

language-bridge-extension

manifest.json
background.js
content.js
popup.html
popup.js
styles.css

icons/
icon.png

---

# ⚙️ Installation

### Step 1: Open Chrome Extensions

Open:

chrome://extensions

Enable **Developer Mode**.

---

### Step 2: Load Extension

Click:

Load Unpacked

Select folder:

language-bridge-extension

---

### Step 3: Configure Language

Click the **Language Bridge icon**.

Choose preferred language:

- Indian Languages
- International Languages

Click **Save Settings**.

---

# 🧪 Testing

Open:

https://web.whatsapp.com

Send a message in another language:

Example:

Hola amigo

The extension should display:

🌐 Hello friend

---

# 🛠 Technologies Used

- JavaScript
- Chrome Extension API (Manifest v3)
- HTML / CSS
- FastAPI backend
- Language Detection
- Translation API

---

# 🔮 Future Improvements

- Voice message transcription
- Google Meet live subtitle translation
- Cultural context detection
- Tone analysis
- Full conversation translation

---

# 👨‍💻 Authors

Language Bridge – Hackathon Project

**Team:**
- Sumit Tak  
- Ayekpam Prithiviraj  
- Vishal Kumar  
- Ayush
