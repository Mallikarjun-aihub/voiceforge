import { useState, useRef, useCallback, useEffect } from "react";
import "./App.css";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi (हिन्दी)" },
  { code: "ta", label: "Tamil (தமிழ்)" },
  { code: "te", label: "Telugu (తెలుగు)" },
  { code: "kn", label: "Kannada (ಕನ್ನಡ)" },
  { code: "ml", label: "Malayalam (മലയാളം)" },
  { code: "mr", label: "Marathi (मराठी)" },
  { code: "bn", label: "Bengali (বাংলা)" },
  { code: "gu", label: "Gujarati (ગુજરાતી)" },
  { code: "pa", label: "Punjabi (ਪੰਜਾਬੀ)" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "es", label: "Spanish" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "zh", label: "Chinese (中文)" },
  { code: "ja", label: "Japanese (日本語)" },
  { code: "ko", label: "Korean (한국어)" },
  { code: "ar", label: "Arabic (العربية)" },
];

const BUCKETS = 64;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const fmt = (s) => {
  if (!Number.isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
};

// Decode the MP3 so the waveform shows the real audio, not a fake animation.
async function analyseAudio(blob) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buf.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / BUCKETS));
    const peaks = [];
    for (let i = 0; i < BUCKETS; i++) {
      let sum = 0, n = 0;
      for (let j = i * size; j < (i + 1) * size && j < data.length; j += 8) {
        sum += Math.abs(data[j]);
        n++;
      }
      peaks.push(n ? sum / n : 0);
    }
    const max = Math.max(...peaks) || 1;
    return { peaks: peaks.map((p) => Math.sqrt(p / max)), duration: buf.duration };
  } finally {
    ctx.close?.();
  }
}

async function readJson(res) {
  try { return await res.json(); } catch { return {}; }
}

function Waveform({ peaks, progress, onSeek }) {
  const ref = useRef(null);
  const dragging = useRef(false);

  const seekFrom = (e) => {
    const r = ref.current.getBoundingClientRect();
    onSeek(clamp((e.clientX - r.left) / r.width, 0, 1));
  };

  return (
    <div
      ref={ref}
      className="wave"
      role="slider"
      tabIndex={0}
      aria-label="Seek audio"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress * 100)}
      onPointerDown={(e) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        seekFrom(e);
      }}
      onPointerMove={(e) => dragging.current && seekFrom(e)}
      onPointerUp={() => (dragging.current = false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); onSeek(clamp(progress + 0.05, 0, 1)); }
        if (e.key === "ArrowLeft") { e.preventDefault(); onSeek(clamp(progress - 0.05, 0, 1)); }
      }}
    >
      {peaks.map((p, i) => (
        <span
          key={i}
          className={`bar${(i + 0.5) / peaks.length <= progress ? " played" : ""}`}
          style={{ height: `${Math.max(10, p * 100)}%` }}
        />
      ))}
    </div>
  );
}

export default function App() {
  const [inputText, setInputText] = useState("");
  const [targetLang, setTargetLang] = useState(() => localStorage.getItem("vf_lang") || "hi");
  const [voice, setVoice] = useState("female");
  const [speed, setSpeed] = useState("normal");
  const [translatedText, setTranslatedText] = useState("");
  const [step, setStep] = useState("idle"); // idle | working | done | error
  const [progress, setProgress] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [audioUrl, setAudioUrl] = useState(null);
  const [wave, setWave] = useState({ peaks: Array(BUCKETS).fill(0.3), duration: 0 });
  const [isPlaying, setIsPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [copied, setCopied] = useState(false);

  const fileRef = useRef(null);
  const audioRef = useRef(null);
  const resultRef = useRef(null);

  const busy = step === "working";
  const lang = LANGUAGES.find((l) => l.code === targetLang);
  const wordCount = inputText.trim() ? inputText.trim().split(/\s+/).length : 0;
  const duration = wave.duration || audioRef.current?.duration || 0;

  useEffect(() => { localStorage.setItem("vf_lang", targetLang); }, [targetLang]);

  // Smooth playhead while playing
  useEffect(() => {
    if (!isPlaying) return;
    let raf;
    const tick = () => {
      if (audioRef.current) setCurrent(audioRef.current.currentTime);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // Free the previous blob URL
  useEffect(() => () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }, [audioUrl]);

  const resetOutput = () => {
    setTranslatedText(""); setAudioUrl(null); setErrorMsg("");
    setIsPlaying(false); setCurrent(0); setProgress("");
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".txt") && file.type !== "text/plain") {
      setErrorMsg("Only .txt files can be loaded. Save your text as .txt and try again.");
      setStep("error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => { setInputText(String(e.target.result)); setStep("idle"); setErrorMsg(""); };
    reader.readAsText(file);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  }, []);

  const handleConvert = async () => {
    const text = inputText.trim();
    if (!text || busy) return;
    resetOutput();
    setStep("working");

    try {
      setProgress("Translating…");
      const transRes = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, lang: targetLang }),
      });
      const transData = await readJson(transRes);
      if (!transRes.ok) throw new Error(transData.error || `Translation failed (${transRes.status}). Try again.`);
      const translated = transData.text || "";
      if (!translated) throw new Error("Translation came back empty. Try different text.");
      setTranslatedText(translated);

      setProgress("Generating audio…");
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: translated, lang: targetLang, gender: voice, rate: speed }),
      });
      if (!ttsRes.ok) {
        const err = await readJson(ttsRes);
        throw new Error(err.error || `Audio generation failed (${ttsRes.status}). Try again.`);
      }

      const blob = await ttsRes.blob();
      try { setWave(await analyseAudio(blob)); }
      catch { setWave({ peaks: Array(BUCKETS).fill(0.45), duration: 0 }); }
      setAudioUrl(URL.createObjectURL(blob));
      setStep("done");
      setProgress("");
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      setErrorMsg(e.message || "Something went wrong. Try again.");
      setStep("error");
      setProgress("");
    }
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { if (a.ended) a.currentTime = 0; a.play(); }
    else a.pause();
  };

  const seek = (fraction) => {
    const a = audioRef.current;
    const d = duration;
    if (!a || !d) return;
    a.currentTime = fraction * d;
    setCurrent(a.currentTime);
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a = document.createElement("a");
    a.href = audioUrl;
    a.download = `voiceforge_${targetLang}_${voice}.mp3`;
    a.click();
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  };

  const handleClear = () => { setInputText(""); resetOutput(); setStep("idle"); };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="mark" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="4" y1="10" x2="4" y2="14" /><line x1="8" y1="6" x2="8" y2="18" />
              <line x1="12" y1="3" x2="12" y2="21" /><line x1="16" y1="7" x2="16" y2="17" />
              <line x1="20" y1="10" x2="20" y2="14" />
            </svg>
          </span>
          <span className="name">VoiceForge</span>
        </div>
        <p className="tag">Translate text into 20 languages and download it as an MP3.</p>
      </header>

      <main className="bench">
        {/* SOURCE */}
        <section
          className={`pane${dragOver ? " over" : ""}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOver(false); }}
          onDrop={handleDrop}
        >
          <div className="pane-head">
            <h2>Your text</h2>
            <div className="pane-actions">
              <button className="ghost" onClick={() => fileRef.current?.click()}>Upload .txt</button>
              <button className="ghost" onClick={handleClear} disabled={!inputText && step === "idle"}>Clear</button>
            </div>
            <input ref={fileRef} type="file" accept=".txt,text/plain" hidden
              onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ""; }} />
          </div>

          <textarea
            aria-label="Text to convert"
            placeholder="Type or paste text here, or drop a .txt file on this panel."
            value={inputText}
            onChange={(e) => { setInputText(e.target.value); if (step === "error") setStep("idle"); }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleConvert(); }}
          />

          <div className="pane-foot">
            <span>{wordCount.toLocaleString()} words</span>
            <span>{inputText.length.toLocaleString()} characters</span>
          </div>
          {dragOver && <div className="drop-hint">Drop .txt to load it</div>}
        </section>

        {/* RESULT */}
        <section className="pane" ref={resultRef} aria-live="polite">
          <div className="pane-head">
            <h2>{lang?.label}</h2>
            {translatedText && (
              <button className="ghost" onClick={handleCopy}>{copied ? "Copied" : "Copy text"}</button>
            )}
          </div>

          <div className="result-body">
            {busy && <div className="working"><span className="spinner" />{progress}</div>}

            {step === "error" && (
              <div className="error" role="alert">
                <b>Couldn’t finish the conversion</b>
                {errorMsg}
              </div>
            )}

            {!busy && translatedText && (
              <p className="translated" lang={targetLang}>{translatedText}</p>
            )}

            {step === "idle" && !translatedText && (
              <p className="empty">
                <strong>Your translation appears here</strong>, with an MP3 player under it.
                Pick a language, voice and speed below, then press Convert to MP3.
              </p>
            )}
          </div>

          {audioUrl && (
            <div className="player">
              <button className="play" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
                {isPlaying
                  ? <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
                  : <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" /></svg>}
              </button>

              <Waveform peaks={wave.peaks} progress={duration ? current / duration : 0} onSeek={seek} />

              <div className="player-meta">
                <span>{fmt(current)} / {fmt(duration)}</span>
                <button className="download" onClick={handleDownload}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download MP3
                </button>
              </div>

              <audio
                ref={audioRef}
                src={audioUrl}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => { setIsPlaying(false); setCurrent(0); }}
                onLoadedMetadata={() => setCurrent(0)}
                hidden
              />
            </div>
          )}
        </section>
      </main>

      {/* CONTROLS */}
      <div className="console">
        <div className="field">
          <label htmlFor="lang">Target language</label>
          <select id="lang" value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>

        <div className="field">
          <span className="label" id="voice-label">Voice</span>
          <div className="seg" role="group" aria-labelledby="voice-label">
            {["male", "female"].map((v) => (
              <button key={v} aria-pressed={voice === v} onClick={() => setVoice(v)}>
                {v === "male" ? "Male" : "Female"}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="label" id="speed-label">Speed</span>
          <div className="seg" role="group" aria-labelledby="speed-label">
            {["slow", "normal", "fast"].map((s) => (
              <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>
                {s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <button className="convert" onClick={handleConvert} disabled={!inputText.trim() || busy}>
          {busy ? <><span className="spinner" />{progress || "Working…"}</> : "Convert to MP3"}
        </button>
      </div>
      <p className="hint">Tip: press Ctrl + Enter in the text box to convert.</p>
    </div>
  );
}
