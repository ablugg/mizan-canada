"use client";

import { useState } from "react";
import { Languages, Copy, Check, ChevronDown, FileText, AlignLeft, FilePlus } from "lucide-react";
import type { TranslateResult, TranslateMode } from "@/types";
import { TRANSLATE_MODES } from "@/types";
import { DocStarField } from "@/components/attorney/DocStarField";
import { DocumentUploadZone } from "@/components/attorney/DocumentUploadZone";
import { EnclaveProcessing } from "@/components/attorney/EnclaveProcessing";

type Direction = "auto" | "fr-en" | "en-fr";
type InputMode = "text" | "document";

const DIR_LABELS: Record<Direction, string> = {
  auto: "Auto-detect",
  "fr-en": "French → English",
  "en-fr": "English → French",
};

function highlightText(text: string, terms: Set<string>): React.ReactNode[] {
  if (terms.size === 0) return [text];
  // Sort longest first to handle overlapping terms correctly
  const sorted = [...terms].filter((t) => t.trim()).sort((a, b) => b.length - a.length);
  const pattern = sorted.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const parts = text.split(new RegExp(`(${pattern})`, "gi"));
  return parts.map((part, i) => {
    const isMatch = sorted.some((t) => part.toLowerCase() === t.toLowerCase());
    return isMatch ? (
      <mark
        key={i}
        style={{
          background: "rgba(201,168,76,0.32)",
          color: "inherit",
          borderRadius: "3px",
          padding: "0 2px",
          boxShadow: "0 0 0 1px rgba(201,168,76,0.4)",
        }}
      >
        {part}
      </mark>
    ) : (
      part
    );
  });
}

export default function TranslatePage() {
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [inputText, setInputText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [direction, setDirection] = useState<Direction>("auto");
  const [mode, setMode] = useState<TranslateMode>("General Legal");
  const [result, setResult] = useState<TranslateResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showDirMenu, setShowDirMenu] = useState(false);
  const [activeTerms, setActiveTerms] = useState<Set<string>>(new Set());

  const canTranslate = inputMode === "text" ? !!inputText.trim() : !!file;
  const hasResult = !!result && !loading;
  // After doc translation: remove source zone; show wide translation + side key terms
  const docResultMode = hasResult && inputMode === "document";

  async function translate() {
    if (!canTranslate || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setActiveTerms(new Set());
    try {
      let res: Response;
      if (inputMode === "document" && file) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("direction", direction);
        fd.append("mode", mode);
        res = await fetch("/api/attorney/translate", { method: "POST", credentials: "include", body: fd });
      } else {
        res = await fetch("/api/attorney/translate", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: inputText, direction, mode }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Translation failed");
      setResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Translation failed");
    } finally {
      setLoading(false);
    }
  }

  function copyTranslation() {
    if (!result) return;
    navigator.clipboard.writeText(result.translatedText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function reset() {
    setInputText("");
    setFile(null);
    setResult(null);
    setError(null);
    setActiveTerms(new Set());
  }

  function newDocument() {
    setFile(null);
    setResult(null);
    setError(null);
    setActiveTerms(new Set());
  }

  const hasGlossary = result && result.glossary.length > 0;

  return (
    <div className="flex flex-col h-full" style={{ background: "#060d1a", position: "relative" }}>
      <DocStarField />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-cormorant)", fontSize: "22px", fontWeight: 300, color: "#e8d5a0", letterSpacing: "0.04em" }}>
            Legal Translation
          </h1>
          <p style={{ fontSize: "11px", color: "#ffffff", marginTop: "2px", fontFamily: "var(--font-dm-sans)" }}>
            French ↔ English · Legal terminology · Key term glossary
          </p>
          <p style={{ fontSize: "10px", color: "rgba(201,168,76,0.5)", marginTop: "3px", fontFamily: "var(--font-dm-sans)" }}>
            Fully local · 0 bytes leave your device
          </p>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        style={{
          position: "relative", zIndex: 1,
          padding: "28px 32px",
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(255,255,255,0.08) transparent",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Container widens after a doc translation */}
        <div style={{ maxWidth: docResultMode ? "1200px" : "800px", margin: "auto", width: "100%", padding: "28px 0", transition: "max-width 0.3s ease" }}>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px", flexWrap: "wrap" }}>
            {/* Input mode toggle (hidden once doc result is showing) */}
            {!docResultMode && (
              <div style={{ display: "flex", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
                {([["text", <AlignLeft size={11} key="i" />, "Text"], ["document", <FileText size={11} key="i" />, "Document"]] as [InputMode, React.ReactNode, string][]).map(([val, icon, lbl]) => (
                  <button
                    key={val}
                    onClick={() => { setInputMode(val); setResult(null); setError(null); setActiveTerms(new Set()); }}
                    style={{
                      display: "flex", alignItems: "center", gap: "5px",
                      padding: "6px 12px", fontSize: "11px", fontFamily: "var(--font-dm-sans)",
                      cursor: "pointer", border: "none",
                      background: inputMode === val ? "rgba(201,168,76,0.12)" : "transparent",
                      color: inputMode === val ? "#c9a84c" : "#ffffff",
                      transition: "all 0.15s",
                    }}
                  >
                    {icon} {lbl}
                  </button>
                ))}
              </div>
            )}

            {/* Direction picker */}
            <div style={{ position: "relative" }}>
              <button
                onClick={() => setShowDirMenu((v) => !v)}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "8px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}
              >
                <Languages size={12} /> {DIR_LABELS[direction]} <ChevronDown size={11} />
              </button>
              {showDirMenu && (
                <>
                  <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setShowDirMenu(false)} />
                  <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 20, background: "#0c1628", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", overflow: "hidden", minWidth: "160px" }}>
                    {(["auto", "fr-en", "en-fr"] as Direction[]).map((d) => (
                      <button key={d} onClick={() => { setDirection(d); setShowDirMenu(false); }}
                        style={{ display: "block", width: "100%", textAlign: "left", padding: "9px 14px", background: direction === d ? "rgba(201,168,76,0.08)" : "transparent", color: direction === d ? "#c9a84c" : "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", border: "none", cursor: "pointer" }}>
                        {DIR_LABELS[d]}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* New Document button — shown after a doc translation */}
            {docResultMode && (
              <button
                onClick={newDocument}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 12px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", transition: "all 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.5)"; e.currentTarget.style.color = "#c9a84c"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.25)"; e.currentTarget.style.color = "rgba(201,168,76,0.8)"; }}
              >
                <FilePlus size={12} /> New Document
              </button>
            )}

            {/* Mode chips */}
            {!docResultMode && (
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {TRANSLATE_MODES.map((m) => (
                  <button key={m} onClick={() => setMode(m)}
                    style={{ padding: "5px 11px", borderRadius: "20px", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", border: mode === m ? "1px solid rgba(201,168,76,0.35)" : "1px solid rgba(255,255,255,0.07)", background: mode === m ? "rgba(201,168,76,0.08)" : "transparent", color: mode === m ? "#c9a84c" : "#ffffff", transition: "all 0.15s" }}>
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Enclave animation while loading */}
          {loading && (
            <EnclaveProcessing
              label="Translating locally"
              sublabel={inputMode === "document" ? "This may take 20–40 seconds · Larger files will take longer" : "This may take a few seconds"}
            />
          )}

          {/* ── Doc result layout: translation (wide) + key terms (sidebar) ── */}
          {docResultMode && result && (
            <div style={{ display: "grid", gridTemplateColumns: hasGlossary ? "1fr 320px" : "1fr", gap: "20px", alignItems: "start" }}>
              {/* Translation panel */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                  <div style={{ fontSize: "9px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)" }}>
                    Translation · {result.detectedLanguage === "fr" ? "French → English" : "English → French"}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button onClick={copyTranslation}
                      style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px 10px", borderRadius: "6px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "#ffffff", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                      {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                    </button>
                  </div>
                </div>
                <div style={{ background: "rgba(4,8,20,0.7)", border: "1px solid rgba(201,168,76,0.12)", borderRadius: "12px", padding: "20px 24px", color: "#ffffff", fontSize: "14px", fontFamily: "var(--font-dm-sans)", lineHeight: 1.8, whiteSpace: "pre-wrap", wordBreak: "break-word", direction: "ltr", minHeight: "420px" }}>
                  {activeTerms.size > 0 ? highlightText(result.translatedText, activeTerms) : result.translatedText}
                </div>
              </div>

              {/* Key Terms sidebar — sticky so it follows scroll */}
              {hasGlossary && (
                <div style={{ position: "sticky", top: "0", alignSelf: "start" }}>
                  <div style={{ fontSize: "9px", letterSpacing: "0.18em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "10px" }}>
                    Key Terms · <span style={{ color: "#ffffff", textTransform: "none", letterSpacing: 0 }}>click to highlight</span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    {result.glossary.map((g, i) => {
                      const isActive = activeTerms.has(g.translation);
                      return (
                        <button
                          key={i}
                          onClick={() => setActiveTerms((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.translation)) next.delete(g.translation);
                            else next.add(g.translation);
                            return next;
                          })}
                          style={{
                            textAlign: "left", padding: "10px 13px", borderRadius: "10px", cursor: "pointer",
                            background: isActive ? "rgba(201,168,76,0.1)" : "rgba(255,255,255,0.02)",
                            border: isActive ? "1px solid rgba(201,168,76,0.35)" : "1px solid rgba(255,255,255,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "baseline", gap: "7px", marginBottom: g.notes ? "4px" : 0, flexWrap: "wrap" }}>
                            <span style={{ fontFamily: "var(--font-cormorant)", fontSize: "13px", color: "#e8d5a0" }}>{g.term}</span>
                            <span style={{ fontSize: "10px", color: "#ffffff" }}>→</span>
                            <span style={{ fontFamily: "var(--font-cormorant)", fontSize: "13px", color: isActive ? "#c9a84c" : "rgba(201,168,76,0.75)" }}>{g.translation}</span>
                          </div>
                          {g.notes && (
                            <p style={{ fontSize: "10px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", lineHeight: 1.5, margin: 0 }}>{g.notes}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Text mode / pre-result layout ── */}
          {!docResultMode && !loading && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: hasResult ? "1fr 1fr" : "1fr", gap: "16px" }}>
                {/* Input */}
                <div>
                  <div style={{ fontSize: "9px", letterSpacing: "0.18em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "8px" }}>
                    Source {inputMode === "document" ? "Document" : "Text"}
                  </div>
                  {inputMode === "document" ? (
                    <DocumentUploadZone onFile={setFile} file={file} disabled={loading} />
                  ) : (
                    <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      placeholder="Paste or type the legal text to translate…"
                      style={{ width: "100%", minHeight: "320px", background: "rgba(4,8,20,0.7)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "12px", padding: "16px", color: "#ffffff", fontSize: "14px", fontFamily: "var(--font-dm-sans)", lineHeight: 1.7, resize: "vertical", outline: "none" }}
                      onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.25)"; }}
                      onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.07)"; }}
                    />
                  )}
                </div>

                {/* Output (text mode) */}
                {result && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
                      <div style={{ fontSize: "9px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)" }}>
                        Translation · {result.detectedLanguage === "fr" ? "French → English" : "English → French"}
                      </div>
                      <button onClick={copyTranslation}
                        style={{ display: "flex", alignItems: "center", gap: "5px", padding: "4px 10px", borderRadius: "6px", background: "transparent", border: "1px solid rgba(255,255,255,0.08)", color: "#ffffff", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                        {copied ? <><Check size={10} /> Copied</> : <><Copy size={10} /> Copy</>}
                      </button>
                    </div>
                    <div style={{ minHeight: "320px", background: "rgba(4,8,20,0.7)", border: "1px solid rgba(201,168,76,0.12)", borderRadius: "12px", padding: "16px", color: "#ffffff", fontSize: "14px", fontFamily: "var(--font-dm-sans)", lineHeight: 1.7, whiteSpace: "pre-wrap", wordBreak: "break-word", direction: "ltr" }}>
                      {activeTerms.size > 0 ? highlightText(result.translatedText, activeTerms) : result.translatedText}
                    </div>
                  </div>
                )}
              </div>

              {/* Action row */}
              <div style={{ display: "flex", justifyContent: "center", gap: "10px", marginTop: "16px" }}>
                {result && (
                  <button onClick={reset}
                    style={{ padding: "9px 18px", borderRadius: "9px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                    Clear
                  </button>
                )}
                <button onClick={translate} disabled={!canTranslate || loading}
                  style={{ padding: "9px 28px", borderRadius: "9px", background: canTranslate && !loading ? "#c9a84c" : "rgba(201,168,76,0.2)", border: "none", color: canTranslate && !loading ? "#0b0b10" : "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: canTranslate && !loading ? "pointer" : "default", display: "flex", alignItems: "center", gap: "7px" }}>
                  <Languages size={13} /> {loading ? "Translating…" : "Translate"}
                </button>
              </div>

              {error && (
                <div style={{ marginTop: "16px", padding: "12px 16px", borderRadius: "10px", background: "rgba(200,50,50,0.08)", border: "1px solid rgba(200,50,50,0.2)", color: "#e07070", fontSize: "13px", fontFamily: "var(--font-dm-sans)" }}>
                  {error}
                </div>
              )}

              {/* Key Terms (text mode — beside translation via row layout) */}
              {result && hasGlossary && (
                <div style={{ marginTop: "24px" }}>
                  <div style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "12px" }}>
                    Key Terms · <span style={{ color: "#ffffff", textTransform: "none", letterSpacing: 0 }}>click to highlight</span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "8px" }}>
                    {result.glossary.map((g, i) => {
                      const isActive = activeTerms.has(g.translation);
                      return (
                        <button
                          key={i}
                          onClick={() => setActiveTerms((prev) => {
                            const next = new Set(prev);
                            if (next.has(g.translation)) next.delete(g.translation);
                            else next.add(g.translation);
                            return next;
                          })}
                          style={{
                            textAlign: "left", padding: "10px 14px", borderRadius: "10px", cursor: "pointer",
                            background: isActive ? "rgba(201,168,76,0.1)" : "rgba(255,255,255,0.02)",
                            border: isActive ? "1px solid rgba(201,168,76,0.35)" : "1px solid rgba(255,255,255,0.06)",
                            transition: "all 0.15s",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginBottom: g.notes ? "4px" : 0 }}>
                            <span style={{ fontFamily: "var(--font-cormorant)", fontSize: "13px", color: "#e8d5a0" }}>{g.term}</span>
                            <span style={{ fontSize: "10px", color: "#ffffff" }}>→</span>
                            <span style={{ fontFamily: "var(--font-cormorant)", fontSize: "13px", color: isActive ? "#c9a84c" : "rgba(201,168,76,0.85)" }}>{g.translation}</span>
                          </div>
                          {g.notes && (
                            <p style={{ fontSize: "10px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", lineHeight: 1.5, margin: 0 }}>{g.notes}</p>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Doc result error */}
          {docResultMode && error && (
            <div style={{ marginTop: "16px", padding: "12px 16px", borderRadius: "10px", background: "rgba(200,50,50,0.08)", border: "1px solid rgba(200,50,50,0.2)", color: "#e07070", fontSize: "13px", fontFamily: "var(--font-dm-sans)" }}>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
