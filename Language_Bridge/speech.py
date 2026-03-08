"""
Speech-to-text service using Google Speech Recognition (fallback)
Works without downloading large models
"""
import os
import tempfile
import speech_recognition as sr
from config import Config

class VoxtralSpeechService:
    """
    Speech recognition using Google's free API
    """
    
    def __init__(self):
        self.recognizer = sr.Recognizer()
        print("[OK] Speech recognition initialized (Google Web Speech API)")
    
    def transcribe_file(self, audio_path, language='en'):
        """
        Transcribe audio file using Google Speech Recognition
        """
        try:
            with sr.AudioFile(audio_path) as source:
                # Adjust for ambient noise
                self.recognizer.adjust_for_ambient_noise(source, duration=0.5)
                audio_data = self.recognizer.record(source)
                
                # Map language codes
                lang_map = {
                    'en': 'en-US',
                    'ja': 'ja-JP',
                    'ko': 'ko-KR',
                    'es': 'es-ES',
                    'fr': 'fr-FR',
                    'de': 'de-DE',
                    'hi': 'hi-IN',
                    'ar': 'ar-SA',
                    'zh': 'zh-CN'
                }
                
                google_lang = lang_map.get(language, 'en-US')
                
                # Use Google Speech Recognition (free, no API key needed)
                text = self.recognizer.recognize_google(audio_data, language=google_lang)
                
                return {
                    'text': text,
                    'language': language,
                    'success': True
                }
                
        except sr.UnknownValueError:
            return {
                'text': '',
                'error': 'Could not understand audio',
                'success': False
            }
        except sr.RequestError as e:
            return {
                'text': '',
                'error': f'Speech recognition service error: {str(e)}',
                'success': False
            }
        except Exception as e:
            return {
                'text': '',
                'error': str(e),
                'success': False
            }
    
    def transcribe_stream(self, audio_bytes, language='en'):
        """
        Transcribe streaming audio bytes
        """
        with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
            temp_path = f.name
        
        try:
            # Save bytes to temp file
            with open(temp_path, 'wb') as f:
                f.write(audio_bytes)
            
            # Transcribe
            result = self.transcribe_file(temp_path, language)
            return result
            
        finally:
            # Cleanup
            if os.path.exists(temp_path):
                os.remove(temp_path)
    
    def get_supported_languages(self):
        """Return languages supported by Google Speech Recognition"""
        return ['en', 'ja', 'ko', 'es', 'fr', 'de', 'hi', 'ar', 'zh']