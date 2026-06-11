import asyncio
import io
import json
import edge_tts
from http.server import BaseHTTPRequestHandler

# Voice map: language code -> { male, female }
VOICE_MAP = {
    "en":  {"male": "en-US-GuyNeural",        "female": "en-US-JennyNeural"},
    "hi":  {"male": "hi-IN-MadhurNeural",      "female": "hi-IN-SwaraNeural"},
    "ta":  {"male": "ta-IN-ValluvarNeural",     "female": "ta-IN-PallaviNeural"},
    "te":  {"male": "te-IN-MohanNeural",        "female": "te-IN-ShrutiNeural"},
    "kn":  {"male": "kn-IN-GaganNeural",        "female": "kn-IN-SapnaNeural"},
    "ml":  {"male": "ml-IN-MidhunNeural",       "female": "ml-IN-SobhanaNeural"},
    "mr":  {"male": "mr-IN-ManoharNeural",      "female": "mr-IN-AarohiNeural"},
    "bn":  {"male": "bn-IN-BashkarNeural",      "female": "bn-IN-TanishaaNeural"},
    "gu":  {"male": "gu-IN-NiranjanNeural",     "female": "gu-IN-DhwaniNeural"},
    "pa":  {"male": "pa-IN-OjasvNeural",        "female": "pa-IN-VaaniNeural"},
    "fr":  {"male": "fr-FR-HenriNeural",        "female": "fr-FR-DeniseNeural"},
    "de":  {"male": "de-DE-ConradNeural",       "female": "de-DE-KatjaNeural"},
    "es":  {"male": "es-ES-AlvaroNeural",       "female": "es-ES-ElviraNeural"},
    "it":  {"male": "it-IT-DiegoNeural",        "female": "it-IT-ElsaNeural"},
    "pt":  {"male": "pt-BR-AntonioNeural",      "female": "pt-BR-FranciscaNeural"},
    "ru":  {"male": "ru-RU-DmitryNeural",       "female": "ru-RU-SvetlanaNeural"},
    "zh":  {"male": "zh-CN-YunxiNeural",        "female": "zh-CN-XiaoxiaoNeural"},
    "ja":  {"male": "ja-JP-KeitaNeural",        "female": "ja-JP-NanamiNeural"},
    "ko":  {"male": "ko-KR-InJoonNeural",       "female": "ko-KR-SunHiNeural"},
    "ar":  {"male": "ar-SA-HamedNeural",        "female": "ar-SA-ZariyahNeural"},
}

async def generate_audio(text: str, lang: str, gender: str, rate: str) -> bytes:
    voice_gender = gender if gender in ("male", "female") else "female"
    lang_key = lang if lang in VOICE_MAP else "en"
    voice = VOICE_MAP[lang_key][voice_gender]

    rate_map = {"slow": "-20%", "normal": "+0%", "fast": "+30%"}
    rate_str = rate_map.get(rate, "+0%")

    communicate = edge_tts.Communicate(text, voice, rate=rate_str)
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    buf.seek(0)
    return buf.read()


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self._set_cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))
            text   = body.get("text", "")
            lang   = body.get("lang", "en")
            gender = body.get("gender", "female")
            rate   = body.get("rate", "normal")

            if not text.strip():
                self._error(400, "No text provided")
                return

            audio_bytes = asyncio.run(generate_audio(text, lang, gender, rate))

            self.send_response(200)
            self._set_cors()
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("Content-Disposition", f'attachment; filename="voiceforge_{lang}_{gender}.mp3"')
            self.send_header("Content-Length", str(len(audio_bytes)))
            self.end_headers()
            self.wfile.write(audio_bytes)

        except Exception as e:
            self._error(500, str(e))

    def _set_cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _error(self, code, msg):
        body = json.dumps({"error": msg}).encode()
        self.send_response(code)
        self._set_cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
