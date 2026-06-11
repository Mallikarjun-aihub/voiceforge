import json
from http.server import BaseHTTPRequestHandler
from deep_translator import GoogleTranslator

LANG_MAP = {
    "en":"english",
    "hi":"hindi",
    "ta":"tamil",
    "te":"telugu",
    "kn":"kannada",
    "ml":"malayalam",
    "mr":"marathi",
    "bn":"bengali",
    "gu":"gujarati",
    "pa":"punjabi",
    "fr":"french",
    "de":"german",
    "es":"spanish",
    "it":"italian",
    "pt":"portuguese",
    "ru":"russian",
    "zh":"chinese (simplified)",
    "ja":"japanese",
    "ko":"korean",
    "ar":"arabic"
}

class handler(BaseHTTPRequestHandler):

    def do_OPTIONS(self):
        self.send_response(200)
        self._cors()
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length))

            text = body["messages"][0]["content"]

            system_prompt = body.get("system", "").lower()

            lang_code = "en"
            for code, name in LANG_MAP.items():
                if name.split()[0] in system_prompt:
                    lang_code = code
                    break

            translated = GoogleTranslator(
                source="auto",
                target=lang_code
            ).translate(text)

            response = {
                "content": [
                    {
                        "text": translated
                    }
                ]
            }

            data = json.dumps(response).encode()

            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        except Exception as e:
            err = json.dumps({"error": str(e)}).encode()

            self.send_response(500)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(err)))
            self.end_headers()
            self.wfile.write(err)

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def log_message(self, *args):
        pass