# 🎙️ VoiceForge

VoiceForge turns your notes, book summaries, or any text into natural-sounding speech. Paste text, optionally translate it into one of 20 languages, pick a voice, and download the result as a single MP3.

**Live demo:** https://voiceforge-theta.vercel.app

## ✨ Features

* 📝 **Built for long text:** paste notes or whole book summaries. The text is split into parts, converted in parallel, and stitched into one MP3
* 🌍 **20 languages:** English, Hindi, Kannada, Tamil, Telugu, Malayalam, Marathi, Bengali, Gujarati, Punjabi, French, German, Spanish, Italian, Portuguese, Russian, Chinese, Japanese, Korean, Arabic
* 🔁 **Translation on/off:** translate before speaking, or read your text as is
* 🎧 **Natural neural voices:** male and female voice for every language
* ⏱️ **Speed control:** slow, normal, or fast
* 📊 **Waveform player:** real waveform from the generated audio, click or drag to seek, time counter
* 📥 **One-click MP3 download**, plus a copy button for the translated text
* 📄 **File upload:** drop a `.txt` or `.md` file; markdown symbols are stripped so they aren't read aloud
* 🧩 **Progress and cancel:** see "Part 3 of 8" while it works, and cancel any time
* 🌗 **Dark and light themes:** dark by default, your choice is remembered
* 📱 **Responsive:** works on desktop and mobile browsers

## 🛠️ Built With

* **Frontend:** React 18, Vite, plain CSS (design tokens, no UI framework)
* **Backend:** Python serverless functions on Vercel (`api/`)
* **Text-to-speech:** [`edge-tts`](https://github.com/rany2/edge-tts) (Microsoft Edge neural voices)
* **Translation:** Google Gemini API (primary), with Microsoft Edge translator and Google Translate (`deep-translator`) as fallbacks
* **Hosting:** Vercel

## 🧠 How It Works

```text
Text  →  clean markdown  →  split into ~1,800-char parts
      →  for each part (2 at a time):  translate  →  text-to-speech
      →  join the MP3 parts  →  waveform player + download
```

Splitting keeps every request short enough for serverless time limits, and failed parts are retried automatically.

## 🚀 Getting Started

Clone the repository:

```bash
git clone https://github.com/Mallikarjun-aihub/voiceforge.git
cd voiceforge
```

Install dependencies:

```bash
npm install
```

Get a free Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and create a `.env.local` file in the project root:

```bash
GEMINI_API_KEY=your_key_here
```

Run locally with the Vercel CLI so the Python API routes work too:

```bash
npm install -g vercel
vercel dev
```

> `npm run dev` starts only the frontend. Translation and audio need the `/api` functions, so use `vercel dev`.

## ☁️ Deploying to Vercel

1. Push the repo to GitHub and import it in Vercel.
2. Add the environment variable `GEMINI_API_KEY` (type: Secret) under Project → Settings → Environment Variables.
3. Redeploy so the variable is picked up.

Optional: set `GEMINI_MODEL` to override the default Gemini model.

## 📁 Project Structure

```text
voiceforge/
├── api/
│   ├── translate.py     # Translation: Gemini → Microsoft → Google fallback, chunking
│   └── tts.py           # Text-to-speech with edge-tts (voice, speed)
├── public/
├── src/
│   ├── App.jsx          # UI, long-text pipeline, waveform player, theme toggle
│   ├── App.css          # Design tokens and styles (light + dark)
│   └── main.jsx
├── index.html
├── requirements.txt     # edge-tts, deep-translator
├── vercel.json          # 60s function timeout, routing
├── vite.config.js
└── package.json
```

## ⚠️ Notes

* The Gemini free tier has rate limits and is not intended for commercial use; your input may be used by Google to improve its products. Avoid pasting private text, and use a paid key for production.
* Very long texts translate more slowly on the free tier. Turning translation off skips Gemini entirely.

## 🔮 Future Enhancements

* Pitch control and more voice options
* Audio history
* PDF and EPUB upload
* Per-part retry and resume for very long texts
* Follow system theme automatically
* User authentication

## 📄 License

This project is licensed under the MIT License.

## 👤 Author

**Mallikarjun B**

CSE (AI & Machine Learning) Student

Passionate about AI, Cloud Computing.
