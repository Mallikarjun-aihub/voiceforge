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

const STYLES = [
  { id: "natural", label: "Natural" },
  { id: "news", label: "News reader" },
  { id: "podcast", label: "Podcast host" },
  { id: "story", label: "Storyteller" },
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


const SEGMENT_CHARS = 1800; // keeps each server call well under Vercel's time and size limits
const SENTENCE_END = /(?<=[.!?।॥。！？؟])\s+/;

// Strip markdown so notes don't get read aloud as "hash", "asterisk", etc.
function cleanForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Split long text into parts on paragraph / sentence boundaries.
function splitSegments(text, limit = SEGMENT_CHARS) {
  const units = [];
  for (const line of text.split("\n")) {
    if (line.length <= limit) { units.push(line); continue; }
    for (let sent of line.split(SENTENCE_END)) {
      while (sent.length > limit) { units.push(sent.slice(0, limit)); sent = sent.slice(limit); }
      units.push(sent);
    }
  }
  const parts = [];
  let cur = "";
  for (const u of units) {
    const next = cur ? cur + "\n" + u : u;
    if (next.length <= limit) cur = next;
    else { if (cur.trim()) parts.push(cur); cur = u; }
  }
  if (cur.trim()) parts.push(cur);
  return parts.filter((x) => x.trim());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// POST with retries for rate limits / temporary server errors
async function postWithRetry(url, payload, signal, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      if (res.ok) return res;
      const err = await readJson(res);
      lastErr = new Error(err.error || `Request failed (${res.status}).`);
      if (![429, 500, 502, 503, 504].includes(res.status)) throw lastErr;
    } catch (e) {
      if (e.name === "AbortError") throw e;
      lastErr = e;
    }
    if (i < tries - 1) await sleep(1500 * (i + 1));
  }
  throw lastErr;
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
  const [engine, setEngine] = useState(() => (localStorage.getItem("vf_engine") === "standard" ? "standard" : "realistic"));
  const [engineNote, setEngineNote] = useState("");
  const [style, setStyle] = useState(() => {
    const saved = localStorage.getItem("vf_style");
    return STYLES.some((s) => s.id === saved) ? saved : "natural";
  });
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
  const [translate, setTranslate] = useState(() => localStorage.getItem("vf_translate") !== "0");
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || "dark");
  const [partInfo, setPartInfo] = useState({ done: 0, total: 0 });

  const fileRef = useRef(null);
  const audioRef = useRef(null);
  const resultRef = useRef(null);
  const abortRef = useRef(null);

  const busy = step === "working";
  const lang = LANGUAGES.find((l) => l.code === targetLang);
  const wordCount = inputText.trim() ? inputText.trim().split(/\s+/).length : 0;
  const duration = wave.duration || audioRef.current?.duration || 0;

  useEffect(() => { localStorage.setItem("vf_lang", targetLang); }, [targetLang]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem("vf_theme", theme); } catch { /* storage blocked */ }
  }, [theme]);
  useEffect(() => { localStorage.setItem("vf_style", style); }, [style]);
  useEffect(() => { localStorage.setItem("vf_engine", engine); }, [engine]);
  useEffect(() => { localStorage.setItem("vf_translate", translate ? "1" : "0"); }, [translate]);

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
    setPartInfo({ done: 0, total: 0 });
    setEngineNote("");
  };

  const handleFile = (file) => {
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) && file.type !== "text/plain") {
      setErrorMsg("Only .txt or .md files can be loaded. Save your notes as .txt and try again.");
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
    const text = cleanForSpeech(inputText);
    if (!text || busy) return;
    resetOutput();
    setStep("working");

    const controller = new AbortController();
    abortRef.current = controller;
    const parts = splitSegments(text);
    const total = parts.length;
    const texts = new Array(total).fill(null);
    const audios = new Array(total).fill(null);
    const engines = new Array(total).fill(null);
    const reasons = new Array(total).fill("");
    let done = 0;
    let next = 0;
    setPartInfo({ done: 0, total });
    setProgress(total > 1 ? `Converting ${total} parts…` : translate ? "Translating…" : "Generating audio…");

    const worker = async () => {
      while (next < total) {
        const i = next++;
        let spoken = parts[i];
        if (translate) {
          const r = await postWithRetry("/api/translate", { text: parts[i], lang: targetLang, style }, controller.signal);
          const d = await readJson(r);
          spoken = d.text || "";
          if (!spoken) throw new Error(`Translation of part ${i + 1} came back empty.`);
        }
        texts[i] = spoken;
        let k = 0;
        while (k < total && texts[k] !== null) k++;
        setTranslatedText(texts.slice(0, k).join("\n\n"));

        const t = await postWithRetry("/api/tts",
          { text: spoken, lang: targetLang, gender: voice, rate: speed, style, engine }, controller.signal);
        audios[i] = await t.blob();
        engines[i] = t.headers.get("X-TTS-Engine") || "edge";
        if (engines[i] !== "gemini") reasons[i] = t.headers.get("X-TTS-Reason") || "";
        done++;
        setPartInfo({ done, total });
      }
    };

    try {
      await Promise.all([worker(), worker()]);

      if (engine === "realistic") {
        const fallback = engines.filter((e) => e !== "gemini").length;
        if (fallback > 0) {
          const why = reasons.filter(Boolean).pop() || "";
          console.warn("VoiceForge: realistic voice unavailable:", why);
          setEngineNote(
            `${fallback} of ${total} ${total === 1 ? "part" : "parts"} used the standard voice because the realistic voice was unavailable` +
            `${why ? ` (${why})` : ""}. Wait a minute and convert again to retry.`
          );
        }
      }

      const blob = new Blob(audios, { type: "audio/mpeg" });
      try { setWave(await analyseAudio(blob)); }
      catch { setWave({ peaks: Array(BUCKETS).fill(0.45), duration: 0 }); }
      setAudioUrl(URL.createObjectURL(blob));
      setStep("done");
      setProgress("");
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (e) {
      controller.abort();
      if (e.name === "AbortError") {
        setStep("idle"); setErrorMsg("");
      } else {
        setErrorMsg(`${e.message || "Something went wrong."} Try again; if it keeps failing, split your text into smaller pieces.`);
        setStep("error");
      }
      setProgress("");
    } finally {
      abortRef.current = null;
    }
  };

  const handleCancel = () => abortRef.current?.abort();

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
        <div className="top-right">
          <p className="tag">Translate text into 20 languages and download it as an MP3.</p>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title={theme === "dark" ? "Light theme" : "Dark theme"}
          >
            {theme === "dark"
              ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
              : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>}
          </button>
        </div>
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
              <button className="ghost" onClick={() => fileRef.current?.click()}>Upload file</button>
              <button className="ghost" onClick={handleClear} disabled={!inputText && step === "idle"}>Clear</button>
            </div>
            <input ref={fileRef} type="file" accept=".txt,.md,text/plain,text/markdown" hidden
              onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ""; }} />
          </div>

          <textarea
            aria-label="Text to convert"
            placeholder="Paste your notes or book summary here, or drop a .txt or .md file on this panel."
            value={inputText}
            onChange={(e) => { setInputText(e.target.value); if (step === "error") setStep("idle"); }}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleConvert(); }}
          />

          <div className="pane-foot">
            <span>{wordCount.toLocaleString()} words</span>
            <span>{inputText.length.toLocaleString()} characters</span>
          </div>
          {dragOver && <div className="drop-hint">Drop file to load it</div>}
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
            {busy && (
              <div className="working-wrap">
                <div className="working">
                  <span className="spinner" />
                  {partInfo.total > 1 ? `Part ${Math.min(partInfo.done + 1, partInfo.total)} of ${partInfo.total}` : progress}
                  <button className="ghost" onClick={handleCancel}>Cancel</button>
                </div>
                {partInfo.total > 1 && (
                  <div className="bar-track" aria-hidden="true">
                    <div className="bar-fill" style={{ width: `${(partInfo.done / partInfo.total) * 100}%` }} />
                  </div>
                )}
              </div>
            )}

            {step === "error" && (
              <div className="error" role="alert">
                <b>Couldn’t finish the conversion</b>
                {errorMsg}
              </div>
            )}

            {translatedText && (
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
          {engineNote && <p className="note" role="status">{engineNote}</p>}
        </section>
      </main>

      {/* CONTROLS */}
      <div className="console">
        <div className="field">
          <label htmlFor="lang">{translate ? "Translate to" : "Read aloud in"}</label>
          <select id="lang" value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
            {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>

        <div className="field">
          <span className="label" id="translate-label">Translation</span>
          <div className="seg" role="group" aria-labelledby="translate-label">
            <button aria-pressed={translate} onClick={() => setTranslate(true)}>On</button>
            <button aria-pressed={!translate} onClick={() => setTranslate(false)}>Off</button>
          </div>
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
          <span className="label" id="engine-label">Voice quality</span>
          <div className="seg" role="group" aria-labelledby="engine-label">
            <button aria-pressed={engine === "realistic"} onClick={() => setEngine("realistic")}>Realistic</button>
            <button aria-pressed={engine === "standard"} onClick={() => setEngine("standard")}>Standard</button>
          </div>
        </div>

        <div className="field">
          <label htmlFor="style">Reading style</label>
          <select id="style" className="select-sm" value={style} onChange={(e) => setStyle(e.target.value)}>
            {STYLES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
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
          {busy ? <><span className="spinner" />{partInfo.total > 1 ? `${partInfo.done}/${partInfo.total} done` : "Working…"}</> : "Convert to MP3"}
        </button>
      </div>
      <p className="hint">Tip: press Ctrl + Enter in the text box to convert.</p>
    </div>
  );
}
