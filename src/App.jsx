import { useState, useRef, useCallback } from "react";

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

function WaveformBars({ active }) {
  const heights = [4, 10, 6, 14, 8, 12, 5, 10, 7, 13, 6, 9, 4];
  return (
    <svg width="52" height="20" viewBox="0 0 52 20" style={{ display: "block" }}>
      {heights.map((h, i) => (
        <rect
          key={i}
          x={i * 4}
          y={(20 - h) / 2}
          width={2.5}
          height={h}
          rx={1}
          style={{
            fill: active ? "#a78bfa" : "#3d3a6b",
            transformOrigin: `${i * 4 + 1.25}px 10px`,
            animation: active
              ? `wfbar ${0.5 + (i % 4) * 0.13}s ease-in-out ${i * 0.04}s infinite alternate`
              : "none",
          }}
        />
      ))}
    </svg>
  );
}

export default function App() {
  const [inputText, setInputText]       = useState("");
  const [targetLang, setTargetLang]     = useState("hi");
  const [voice, setVoice]               = useState("female");
  const [speed, setSpeed]               = useState("normal");
  const [translatedText, setTranslatedText] = useState("");
  const [step, setStep]                 = useState("idle");
  const [errorMsg, setErrorMsg]         = useState("");
  const [audioUrl, setAudioUrl]         = useState(null);
  const [isPlaying, setIsPlaying]       = useState(false);
  const [dragOver, setDragOver]         = useState(false);
  const [progress, setProgress]         = useState("");
  const fileRef  = useRef(null);
  const audioRef = useRef(null);

  const wordCount = inputText.trim() ? inputText.trim().split(/\s+/).length : 0;
  const charCount = inputText.length;

  const handleFile = (file) => {
    if (!file) return;
    if (!file.name.endsWith(".txt") && file.type !== "text/plain") {
      setErrorMsg("Please upload a .txt file.");
      setStep("error");
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => { setInputText(e.target.result); setStep("idle"); setErrorMsg(""); };
    reader.readAsText(file);
  };

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]);
  }, []);

  const handleConvert = async () => {
    if (!inputText.trim()) return;
    setStep("working");
    setTranslatedText("");
    setAudioUrl(null);
    setErrorMsg("");
    setIsPlaying(false);

    try {
      // Step 1: Translate
      setProgress("Translating text...");
      const langLabel = LANGUAGES.find((l) => l.code === targetLang)?.label || targetLang;
      const transRes = await fetch("/api/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are a professional translator. Translate the user's text accurately to ${langLabel}. Return ONLY the translated text, nothing else.`,
          messages: [{ role: "user", content: inputText }],
        }),
      });
      const transData = await transRes.json();
      if (transData.error) throw new Error(transData.error.message || transData.error);
      const translated = transData.content?.[0]?.text || "";
      setTranslatedText(translated);

      // Step 2: TTS → real MP3
      setProgress("Generating audio...");
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: translated, lang: targetLang, gender: voice, rate: speed }),
      });

      if (!ttsRes.ok) {
        const errJson = await ttsRes.json().catch(() => ({}));
        throw new Error(errJson.error || `TTS failed (${ttsRes.status})`);
      }

      const blob = await ttsRes.blob();
      const url  = URL.createObjectURL(blob);
      setAudioUrl(url);
      setStep("done");
      setProgress("");

    } catch (e) {
      setErrorMsg(e.message || "Something went wrong.");
      setStep("error");
      setProgress("");
    }
  };

  const handlePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) { audioRef.current.pause(); setIsPlaying(false); }
    else           { audioRef.current.play();  setIsPlaying(true);  }
  };

  const handleDownload = () => {
    if (!audioUrl) return;
    const a   = document.createElement("a");
    a.href    = audioUrl;
    a.download = `voiceforge_${targetLang}_${voice}.mp3`;
    a.click();
  };

  const handleClear = () => {
    setInputText(""); setTranslatedText(""); setStep("idle");
    setAudioUrl(null); setErrorMsg(""); setIsPlaying(false); setProgress("");
  };

  const isBusy = step === "working";

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f1a", color: "#e8e4ff", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500&display=swap');
        @keyframes wfbar  { from{transform:scaleY(0.4)} to{transform:scaleY(1)} }
        @keyframes spin    { to{transform:rotate(360deg)} }
        @keyframes fadeIn  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        *{box-sizing:border-box;margin:0;padding:0}
        .btn{cursor:pointer;border:none;outline:none;transition:all .18s;}
        .btn:hover:not(:disabled){filter:brightness(1.1);transform:translateY(-1px)}
        .btn:active:not(:disabled){transform:scale(0.97)}
        .btn:disabled{opacity:.4;cursor:not-allowed}
        select,textarea{background:#131320;border:1px solid #2a2848;color:#e8e4ff;border-radius:10px;outline:none;font-family:'Inter',sans-serif}
        select{padding:10px 14px;font-size:14px;cursor:pointer;width:100%}
        select:focus,textarea:focus{border-color:#7c6fe0}
        textarea{padding:16px;font-size:14px;line-height:1.7;resize:vertical;width:100%}
        textarea::placeholder{color:#3d3a6b}
        .chip{padding:7px 0;border-radius:22px;font-size:13px;font-weight:500;cursor:pointer;border:1.5px solid #2a2848;text-align:center;transition:all .15s;flex:1}
        .chip:hover{border-color:#7c6fe0}
        .dropzone{border:2px dashed #2a2848;border-radius:14px;padding:26px;text-align:center;cursor:pointer;transition:all .2s}
        .dropzone.over{border-color:#7c6fe0;background:#1a1a2e}
        .card{background:#131320;border:1px solid #2a2848;border-radius:14px;padding:20px;animation:fadeIn .3s ease}
        .spinner{width:18px;height:18px;border:2px solid #3d3a6b;border-top-color:#a78bfa;border-radius:50%;animation:spin .7s linear infinite;display:inline-block}
      `}</style>

      {/* Header */}
      <div style={{ background: "#0a0a16", borderBottom: "1px solid #1a1830", padding: "16px 28px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 38, height: 38, borderRadius: 10, background: "#5b4fcf", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        </div>
        <div>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: 19, color: "#f0ecff" }}>VoiceForge</div>
          <div style={{ fontSize: 12, color: "#4b4870", marginTop: 1 }}>Translate · Convert · Download MP3</div>
        </div>
      </div>

      <div style={{ maxWidth: 880, margin: "0 auto", padding: "32px 20px 60px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>

          {/* INPUT COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, color: "#5b4fcf", textTransform: "uppercase", letterSpacing: "0.1em" }}>Input text</div>

            <div className={`dropzone${dragOver ? " over" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}>
              <input ref={fileRef} type="file" accept=".txt,text/plain" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#3d3a6b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 8px", display: "block" }}>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <div style={{ fontSize: 13, color: "#4b4870" }}>Drop a <strong style={{ color: "#7c6fe0" }}>.txt file</strong> or click to upload</div>
            </div>

            <div style={{ textAlign: "center", fontSize: 11, color: "#2d2b52" }}>— or type below —</div>

            <textarea placeholder="Paste or type your text here... no length limit." value={inputText}
              onChange={(e) => { setInputText(e.target.value); if (step !== "idle") setStep("idle"); }}
              style={{ minHeight: 210 }} />

            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "#3d3a6b" }}>
              <span>{wordCount.toLocaleString()} words</span>
              <span>{charCount.toLocaleString()} chars</span>
            </div>
          </div>

          {/* SETTINGS COLUMN */}
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, color: "#5b4fcf", textTransform: "uppercase", letterSpacing: "0.1em" }}>Settings</div>

            <div>
              <div style={{ fontSize: 13, color: "#8884b8", marginBottom: 7, fontWeight: 500 }}>Target language</div>
              <select value={targetLang} onChange={(e) => setTargetLang(e.target.value)}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>

            <div>
              <div style={{ fontSize: 13, color: "#8884b8", marginBottom: 7, fontWeight: 500 }}>Voice</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["male", "female"].map((v) => (
                  <div key={v} className="chip" onClick={() => setVoice(v)}
                    style={{ background: voice === v ? "#1e1b3a" : "transparent", borderColor: voice === v ? "#7c6fe0" : "#2a2848", color: voice === v ? "#c4bcff" : "#4b4870" }}>
                    {v === "male" ? "♂ Male" : "♀ Female"}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 13, color: "#8884b8", marginBottom: 7, fontWeight: 500 }}>Speed</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["slow", "normal", "fast"].map((s) => (
                  <div key={s} className="chip" onClick={() => setSpeed(s)}
                    style={{ background: speed === s ? "#1e1b3a" : "transparent", borderColor: speed === s ? "#7c6fe0" : "#2a2848", color: speed === s ? "#c4bcff" : "#4b4870", textTransform: "capitalize" }}>
                    {s}
                  </div>
                ))}
              </div>
            </div>

            <button className="btn" disabled={!inputText.trim() || isBusy} onClick={handleConvert}
              style={{ marginTop: "auto", padding: "13px 0", borderRadius: 11, background: isBusy ? "#2a2848" : "#5b4fcf", color: "#fff", fontSize: 15, fontWeight: 600, fontFamily: "'Space Grotesk',sans-serif", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              {isBusy
                ? <><div className="spinner" />{progress || "Working..."}</>
                : <><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>Convert & Download</>
              }
            </button>

            {inputText && (
              <button className="btn" onClick={handleClear}
                style={{ padding: "10px 0", borderRadius: 10, background: "transparent", border: "1px solid #2a2848", color: "#4b4870", fontSize: 13 }}>
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* ERROR */}
        {step === "error" && (
          <div style={{ marginTop: 22, padding: "13px 16px", borderRadius: 11, background: "#1a0e0e", border: "1px solid #5c1a1a", color: "#f87171", fontSize: 14, display: "flex", gap: 10, alignItems: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {errorMsg}
          </div>
        )}

        {/* OUTPUT */}
        {(translatedText || audioUrl) && (
          <div style={{ marginTop: 30, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 11, fontWeight: 700, color: "#5b4fcf", textTransform: "uppercase", letterSpacing: "0.1em" }}>Output</div>

            {translatedText && (
              <div className="card">
                <div style={{ fontSize: 11, color: "#4b4870", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>
                  Translated → {LANGUAGES.find((l) => l.code === targetLang)?.label}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.75, color: "#b8b0f0", maxHeight: 180, overflowY: "auto" }}>{translatedText}</div>
              </div>
            )}

            {audioUrl && (
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
                <button className="btn" onClick={handlePlay}
                  style={{ width: 50, height: 50, borderRadius: "50%", background: "#5b4fcf", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {isPlaying
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                    : <svg width="16" height="16" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  }
                </button>

                <WaveformBars active={isPlaying} />

                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: "#c4bcff" }}>{voice === "male" ? "♂ Male" : "♀ Female"} · {speed} · {LANGUAGES.find((l) => l.code === targetLang)?.label}</div>
                  <div style={{ fontSize: 12, color: "#4b4870", marginTop: 2 }}>MP3 ready to download</div>
                </div>

                <button className="btn" onClick={handleDownload}
                  style={{ padding: "10px 18px", borderRadius: 10, background: "#1e1b3a", border: "1px solid #4b4870", color: "#a78bfa", fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download MP3
                </button>

                <audio ref={audioRef} src={audioUrl} onEnded={() => setIsPlaying(false)} style={{ display: "none" }} />
              </div>
            )}
          </div>
        )}

        {/* HOW IT WORKS */}
        {step === "idle" && !inputText && (
          <div style={{ marginTop: 44, display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 }}>
            {[
              { e: "✍️", t: "Paste or upload", d: "Drop any .txt file or type freely — no character limit." },
              { e: "🌐", t: "Choose language", d: "20 languages including all major Indian languages." },
              { e: "⬇️", t: "Download MP3", d: "Real audio file powered by Microsoft Edge TTS — completely free." },
            ].map((x, i) => (
              <div key={i} style={{ background: "#0a0a16", border: "1px solid #1a1830", borderRadius: 12, padding: "16px 14px" }}>
                <div style={{ fontSize: 24, marginBottom: 8 }}>{x.e}</div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, color: "#b8b0f0", marginBottom: 5 }}>{x.t}</div>
                <div style={{ fontSize: 12, color: "#4b4870", lineHeight: 1.6 }}>{x.d}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
