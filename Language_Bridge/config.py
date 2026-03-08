import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Server settings
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key-change-in-production')
    DEBUG = os.getenv('DEBUG', 'True').lower() == 'true'
    PORT = int(os.getenv('PORT', 5000))
    
    # Translation settings
    DEFAULT_SOURCE_LANG = 'en'
    DEFAULT_TARGET_LANG = 'es'
    
    # Supported languages
    SUPPORTED_LANGUAGES = {
        'en': 'English',
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'ja': 'Japanese',
        'ko': 'Korean',
        'zh-cn': 'Chinese (Simplified)',
        'hi': 'Hindi',
        'ar': 'Arabic',
        'pt': 'Portuguese',
        'ru': 'Russian',
        'it': 'Italian',
        'nl': 'Dutch',
        'pl': 'Polish',
        'tr': 'Turkish',
        'vi': 'Vietnamese',
        'th': 'Thai',
        'id': 'Indonesian'
    }
    
    # Audio settings
    AUDIO_SAMPLE_RATE = 16000
    AUDIO_CHANNELS = 1
    AUDIO_FORMAT = 'int16'
    MAX_AUDIO_DURATION = 30  # seconds
    TEMP_AUDIO_DIR = 'uploads/temp'
    
    # Local Facebook/Meta translation model (NLLB-200 or M2M100)
    # Set TRANSLATION_MODEL_PATH to the folder where your model is saved.
    # Leave empty to fall back to Google Translate (no API key needed).
    # Example: TRANSLATION_MODEL_PATH=C:/models/nllb-200-distilled-600M
    TRANSLATION_MODEL_PATH = os.getenv('TRANSLATION_MODEL_PATH', '')
    TRANSLATION_DEVICE = os.getenv('TRANSLATION_DEVICE', 'cpu')

    # Voxtral settings
    VOXTRAL_MODEL_PATH = os.getenv('VOXTRAL_MODEL_PATH', 'models/voxtral')
    VOXTRAL_DEVICE = os.getenv('VOXTRAL_DEVICE', 'cpu')
    
    # Create temp directory if it doesn't exist
    os.makedirs(TEMP_AUDIO_DIR, exist_ok=True)