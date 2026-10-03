import asyncio
import base64
import io
import json
import os
import re
import time
import urllib.error
import urllib.request
import wave
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


# ---------------------------------------------------------------------------
# Realistic voices: Gemini TTS (needs GEMINI_API_KEY). Falls back to edge-tts.
# ---------------------------------------------------------------------------

# Prebuilt Gemini voices are multilingual: the same voice speaks every language
# and the language is detected from the text. Swap the names freely after
# auditioning voices in Google AI Studio (aistudio.google.com/generate-speech).
GEMINI_VOICES = {
    "natural": {"male": "Charon", "female": "Kore"},
    "news":    {"male": "Orus",   "female": "Kore"},
    "podcast": {"male": "Achird", "female": "Sulafat"},
    "story":   {"male": "Algieba", "female": "Gacrux"},
}

# Delivery directions go in speech_metadata.style (never spoken aloud).
GEMINI_STYLE = {
    "natural": "",
    "news": "calm, clear and authoritative, like a professional news anchor",
    "podcast": "warm, relaxed and conversational, like a friendly podcast host",
    "story": "expressive and unhurried, like an audiobook narrator",
}
GEMINI_PACE = {"slow": "speaking slowly", "normal": "", "fast": "speaking at a brisk pace"}


def _gemini_tts_models():
    names = [os.environ.get("GEMINI_TTS_MODEL"), "gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"]
    seen, out = set(), []
    for n in names:
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def _prep_for_gemini(text):
    # Paragraph breaks become a short pause so notes sound read, not rushed.
    return re.sub(r"\n\s*\n+", " <short pause> ", text.strip())


def _pcm_from_audio(raw):
    """Return (pcm_bytes, sample_rate). Accepts raw L16 or a WAV with RIFF header."""
    if raw[:4] == b"RIFF":
        with wave.open(io.BytesIO(raw), "rb") as w:
            return w.readframes(w.getnframes()), w.getframerate()
    return raw, 24000


def _pcm_to_mp3(pcm, rate):
    import lameenc  # imported lazily so a packaging problem only disables this engine

    enc = lameenc.Encoder()
    enc.set_bit_rate(96)
    enc.set_in_sample_rate(rate)
    enc.set_channels(1)
    enc.set_quality(2)
    return bytes(enc.encode(pcm)) + bytes(enc.flush())


def gemini_tts(text, gender, rate, style):
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GEMINI_API_KEY is not set")
    voice_gender = gender if gender in ("male", "female") else "female"
    style_key = style if style in GEMINI_VOICES else "natural"
    voice = GEMINI_VOICES[style_key][voice_gender]
    style_text = ", ".join(x for x in (GEMINI_STYLE[style_key], GEMINI_PACE.get(rate, "")) if x)

    block = {"type": "text", "text": _prep_for_gemini(text)}
    if style_text:
        block["annotations"] = [{"type": "speech_metadata", "style": style_text}]
    body = json.dumps({
        "input": [{"type": "user_input", "content": [block]}],
        "response_format": {"type": "audio", "mime_type": "audio/l16", "sample_rate": 24000},
        "generation_config": {"speech_config": [{"voice": voice}]},
    })

    deadline = time.time() + 45  # stay inside the 60s function limit
    errors = []
    for model in _gemini_tts_models():
        budget = min(40, deadline - time.time())
        if budget < 5:
            break
        payload = json.loads(body)
        payload["model"] = model
        req = urllib.request.Request(
            "https://generativelanguage.googleapis.com/v1beta/interactions",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json", "x-goog-api-key": key},
        )
        try:
            with urllib.request.urlopen(req, timeout=budget) as r:
                data = json.loads(r.read())
            audio_b64 = None
            for step in data.get("steps", []):
                for c in step.get("content", []) or []:
                    if c.get("type") == "audio" and c.get("data"):
                        audio_b64 = c["data"]
            if not audio_b64:
                raise RuntimeError("no audio in response")
            pcm, sr = _pcm_from_audio(base64.b64decode(audio_b64))
            if not pcm:
                raise RuntimeError("empty audio")
            return _pcm_to_mp3(pcm, sr)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "ignore")[:120].replace("\n", " ")
            errors.append(f"{model} HTTP {e.code} {detail}")
        except Exception as e:
            errors.append(f"{model} {e}")
    raise RuntimeError("; ".join(errors) or "no time left")


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
            engine = body.get("engine", "realistic")

            if not text.strip():
                self._error(400, "No text provided")
                return

            audio_bytes, used, reason = None, "edge", ""
            if engine == "realistic":
                try:
                    audio_bytes = gemini_tts(text, gender, rate, style)
                    used = "gemini"
                except Exception as e:  # fall back to the standard voice
                    reason = str(e)
            if audio_bytes is None:
                audio_bytes = asyncio.run(generate_audio(text, lang, gender, rate, style))

            self.send_response(200)
            self._set_cors()
            self.send_header("Content-Type", "audio/mpeg")
            self.send_header("X-TTS-Engine", used)
            if reason:
                safe = reason.encode("latin-1", "ignore").decode("latin-1").replace("\r", " ").replace("\n", " ")[:180]
                self.send_header("X-TTS-Reason", safe)
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
        self.send_header("Access-Control-Expose-Headers", "X-TTS-Engine, X-TTS-Reason")

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
