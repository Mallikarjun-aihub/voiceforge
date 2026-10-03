import asyncio
import io
import json
import edge_tts
from http.server import BaseHTTPRequestHandler

# Voice map: language code -> { male, female }
VOICE_MAP = {
    "en": {
    "male": "en-US-DavisNeural",
    "female": "en-US-AriaNeural"
},
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

# Reader styles: offsets applied on top of the speed setting.
# rate/volume are in %, pitch is in Hz.
STYLES = {
    "natural": {"rate": 0,   "pitch": 0,  "volume": 0},
    "news":    {"rate": -6,  "pitch": -3, "volume": 5},   # measured, clear, authoritative
    "podcast": {"rate": 3,   "pitch": 1,  "volume": 0},   # warm, conversational
    "story":   {"rate": -12, "pitch": -2, "volume": -3},  # slower, audiobook narrator
}

# English has several voices, so style can also pick a different speaker.
# If a voice isn't available, we fall back to the default voice for the language.
EN_STYLE_VOICES = {
    "news":    {"male": "en-US-GuyNeural",              "female": "en-US-JennyNeural"},
    "podcast": {"male": "en-US-AndrewMultilingualNeural", "female": "en-US-AvaMultilingualNeural"},
    "story":   {"male": "en-GB-RyanNeural",             "female": "en-GB-SoniaNeural"},
}

SPEED_RATE = {"slow": -20, "normal": 0, "fast": 30}


async def _synth(text, voice, rate, pitch, volume):
    communicate = edge_tts.Communicate(
        text, voice,
        rate=f"{rate:+d}%", pitch=f"{pitch:+d}Hz", volume=f"{volume:+d}%",
    )
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    data = buf.getvalue()
    if not data:
        raise RuntimeError("no audio returned")
    return data


async def generate_audio(text: str, lang: str, gender: str, rate: str, style: str = "natural") -> bytes:
    voice_gender = gender if gender in ("male", "female") else "female"
    lang_key = lang if lang in VOICE_MAP else "en"
    style_key = style if style in STYLES else "natural"
    st = STYLES[style_key]

    total_rate = max(-50, min(100, SPEED_RATE.get(rate, 0) + st["rate"]))

    voices = []
    if lang_key == "en" and style_key in EN_STYLE_VOICES:
        voices.append(EN_STYLE_VOICES[style_key][voice_gender])
    voices.append(VOICE_MAP[lang_key][voice_gender])

    last_err = None
    for voice in voices:
        try:
            return await _synth(text, voice, total_rate, st["pitch"], st["volume"])
        except Exception as e:  # try the default voice next
            last_err = e
    raise last_err


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
            style  = body.get("style", "natural")

            if not text.strip():
                self._error(400, "No text provided")
                return

            audio_bytes = asyncio.run(generate_audio(text, lang, gender, rate, style))

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
