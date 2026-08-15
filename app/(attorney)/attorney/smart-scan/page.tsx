"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { ScanSearch, X, Sparkles, ShieldAlert, ListChecks, FileText, Upload } from "lucide-react";
import { DocumentUploadZone } from "@/components/attorney/DocumentUploadZone";
import { DocStarField } from "@/components/attorney/DocStarField";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Explanation {
  id: string;
  highlight: string;
  mode: string;
  content: string;
  isStreaming: boolean;
}

const MODES = [
  { key: "explain", label: "Explain", icon: Sparkles },
  { key: "risks", label: "Risks", icon: ShieldAlert },
  { key: "obligations", label: "Obligations", icon: ListChecks },
  { key: "simplify", label: "Simplify", icon: FileText },
] as const;

export default function SmartScanPage() {
  const [file, setFile] = useState<File | null>(null);
  const [documentText, setDocumentText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [explanations, setExplanations] = useState<Explanation[]>([]);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [activeMode, setActiveMode] = useState<string>("explain");
  const docRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Extract text from uploaded file
  async function handleFile(f: File) {
    setFile(f);
    setError(null);
    setExtracting(true);
    setDocumentText("");
    setExplanations([]);

    try {
      if (f.name.endsWith(".txt")) {
        const text = await f.text();
        setDocumentText(text);
      } else {
        const extractFd = new FormData();
        extractFd.append("file", f);
        const extractRes = await fetch("/api/attorney/smart-scan/extract", {
          method: "POST",
          body: extractFd,
          credentials: "include",
        });
        if (!extractRes.ok) {
          const errData = await extractRes.json().catch(() => null);
          throw new Error(errData?.error || "Failed to extract text");
        }
        const data = await extractRes.json();
        setDocumentText(data.text);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to extract text from document");
    } finally {
      setExtracting(false);
    }
  }

  // Listen for text selection in the document area
  const handleMouseUp = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !docRef.current) {
      setTooltip(null);
      return;
    }

    // Only handle selections within the document area
    const range = selection.getRangeAt(0);
    if (!docRef.current.contains(range.commonAncestorContainer)) {
      setTooltip(null);
      return;
    }

    const text = selection.toString().trim();
    if (text.length < 3) {
      setTooltip(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    setTooltip({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      text,
    });
  }, []);

  useEffect(() => {
    document.addEventListener("mouseup", handleMouseUp);
    return () => document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseUp]);

  // Get surrounding context for the highlight
  function getSurroundingContext(highlight: string): string {
    const idx = documentText.indexOf(highlight);
    if (idx === -1) return "";
    const start = Math.max(0, idx - 500);
    const end = Math.min(documentText.length, idx + highlight.length + 500);
    return documentText.slice(start, end);
  }

  // Send highlighted text for explanation
  async function explainHighlight(text: string, mode: string) {
    setTooltip(null);
    window.getSelection()?.removeAllRanges();

    const id = crypto.randomUUID();
    const explanation: Explanation = {
      id,
      highlight: text.slice(0, 200),
      mode,
      content: "",
      isStreaming: true,
    };
    setExplanations((prev) => [explanation, ...prev]);

    // Scroll panel to top
    setTimeout(() => panelRef.current?.scrollTo({ top: 0, behavior: "smooth" }), 50);

    try {
      abortRef.current = new AbortController();
      const res = await fetch("/api/attorney/smart-scan", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          highlight: text,
          context: getSurroundingContext(text),
          mode,
          language: localStorage.getItem("mizan-locale") || "en",
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error("Request failed");
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setExplanations((prev) =>
          prev.map((e) => (e.id === id ? { ...e, content: e.content + chunk } : e))
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setExplanations((prev) =>
          prev.map((e) =>
            e.id === id ? { ...e, content: "Failed to generate explanation. Please try again." } : e
          )
        );
      }
    } finally {
      setExplanations((prev) =>
        prev.map((e) => (e.id === id ? { ...e, isStreaming: false } : e))
      );
      abortRef.current = null;
    }
  }

  function reset() {
    abortRef.current?.abort();
    setFile(null);
    setDocumentText("");
    setExplanations([]);
    setError(null);
    setTooltip(null);
  }

  const modeLabel = MODES.find((m) => m.key === activeMode)?.label || "Explain";

  return (
    <div className="flex flex-col h-full" style={{ background: "#060d1a", position: "relative" }}>
      <DocStarField />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-cormorant)", fontSize: "22px", fontWeight: 300, color: "#e8d5a0", letterSpacing: "0.04em" }}>
            Smart Scan
          </h1>
          <p style={{ fontSize: "11px", color: "#ffffff", marginTop: "2px", fontFamily: "var(--font-dm-sans)" }}>
            Upload a document · Highlight any text · Get instant AI analysis
          </p>
          <p style={{ fontSize: "10px", color: "rgba(201,168,76,0.5)", marginTop: "3px", fontFamily: "var(--font-dm-sans)" }}>
            Fully local · 0 bytes leave your device
          </p>
        </div>
        {documentText && (
          <button
            onClick={reset}
            style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", cursor: "pointer", fontSize: "11px", fontFamily: "var(--font-dm-sans)" }}
          >
            <Upload size={11} /> New Document
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden" style={{ position: "relative", zIndex: 1, display: "flex" }}>
        {!documentText ? (
          /* Upload state */
          <div className="flex-1 overflow-y-auto" style={{ padding: "28px 32px", display: "flex", flexDirection: "column" }}>
            <div style={{ maxWidth: "760px", margin: "auto", width: "100%", padding: "28px 0" }}>
              <DocumentUploadZone
                onFile={handleFile}
                file={file}
                disabled={extracting}
              />

              {extracting && (
                <div style={{ marginTop: "24px", textAlign: "center" }}>
                  <div style={{ display: "inline-flex", alignItems: "center", gap: "10px", padding: "12px 20px", borderRadius: "10px", background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.15)" }}>
                    <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: "spin 1s linear infinite" }}>
                      <circle cx="7" cy="7" r="5.5" stroke="rgba(201,168,76,0.6)" strokeWidth="1.5" fill="none" strokeDasharray="20 14" strokeLinecap="round" />
                    </svg>
                    <span style={{ fontSize: "12px", color: "rgba(201,168,76,0.8)", fontFamily: "var(--font-dm-sans)" }}>
                      Extracting text from document…
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div style={{ marginTop: "20px", padding: "12px 16px", borderRadius: "10px", background: "rgba(200,50,50,0.08)", border: "1px solid rgba(200,50,50,0.2)", color: "#e07070", fontSize: "13px", fontFamily: "var(--font-dm-sans)" }}>
                  {error}
                </div>
              )}

              {/* How it works */}
              {!file && !extracting && (
                <div style={{ marginTop: "40px", maxWidth: "520px", margin: "40px auto 0" }}>
                  <p style={{ fontSize: "10px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(201,168,76,0.5)", fontFamily: "var(--font-dm-sans)", marginBottom: "16px", textAlign: "center" }}>
                    How it works
                  </p>
                  <div style={{ display: "flex", gap: "16px" }}>
                    {[
                      { step: "1", title: "Upload", desc: "Drop a PDF, DOCX, or TXT file" },
                      { step: "2", title: "Highlight", desc: "Select any text with your cursor" },
                      { step: "3", title: "Understand", desc: "AI explains, flags risks, or simplifies" },
                    ].map((s) => (
                      <div key={s.step} style={{ flex: 1, padding: "16px", borderRadius: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", textAlign: "center" }}>
                        <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: "rgba(201,168,76,0.1)", border: "1px solid rgba(201,168,76,0.2)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px", fontSize: "12px", color: "#c9a84c", fontFamily: "var(--font-dm-sans)", fontWeight: 600 }}>
                          {s.step}
                        </div>
                        <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "14px", color: "#e8d5a0", marginBottom: "4px" }}>{s.title}</p>
                        <p style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", fontFamily: "var(--font-dm-sans)" }}>{s.desc}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Document viewer + explanation panel */
          <>
            {/* Document text pane */}
            <div className="flex-1 overflow-y-auto" style={{ padding: "24px 32px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
              <div style={{ maxWidth: "720px", margin: "0 auto" }}>
                {/* Mode selector bar */}
                <div style={{ display: "flex", gap: "6px", marginBottom: "20px", padding: "4px", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", width: "fit-content" }}>
                  {MODES.map((m) => {
                    const Icon = m.icon;
                    const active = activeMode === m.key;
                    return (
                      <button
                        key={m.key}
                        onClick={() => setActiveMode(m.key)}
                        style={{
                          display: "flex", alignItems: "center", gap: "5px", padding: "5px 12px",
                          borderRadius: "7px", border: "none",
                          background: active ? "rgba(201,168,76,0.15)" : "transparent",
                          color: active ? "#c9a84c" : "rgba(180,190,210,0.5)",
                          fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer",
                          transition: "all 0.15s",
                        }}
                      >
                        <Icon size={11} />
                        {m.label}
                      </button>
                    );
                  })}
                </div>

                {/* Instruction */}
                <div style={{ marginBottom: "20px", padding: "10px 14px", borderRadius: "8px", background: "rgba(201,168,76,0.04)", border: "1px solid rgba(201,168,76,0.12)", display: "flex", alignItems: "center", gap: "8px" }}>
                  <ScanSearch size={13} style={{ color: "rgba(201,168,76,0.6)", flexShrink: 0 }} />
                  <span style={{ fontSize: "11px", color: "rgba(201,168,76,0.7)", fontFamily: "var(--font-dm-sans)" }}>
                    Highlight any text below to {modeLabel.toLowerCase()} it · {file?.name}
                  </span>
                </div>

                {/* Document text — selectable */}
                <div
                  ref={docRef}
                  style={{
                    fontFamily: "var(--font-dm-sans)",
                    fontSize: "13.5px",
                    lineHeight: "1.85",
                    color: "rgba(220,228,240,0.88)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    cursor: "text",
                    userSelect: "text",
                    padding: "20px 24px",
                    borderRadius: "12px",
                    background: "rgba(255,255,255,0.015)",
                    border: "1px solid rgba(255,255,255,0.05)",
                  }}
                >
                  {documentText}
                </div>
              </div>
            </div>

            {/* Explanations panel */}
            <div
              ref={panelRef}
              style={{
                width: explanations.length > 0 ? "380px" : "0px",
                flexShrink: 0,
                borderLeft: explanations.length > 0 ? "1px solid rgba(255,255,255,0.06)" : "none",
                overflowY: "auto",
                overflowX: "hidden",
                scrollbarWidth: "thin",
                scrollbarColor: "rgba(255,255,255,0.06) transparent",
                transition: "width 0.3s cubic-bezier(0.4,0,0.2,1)",
                background: "rgba(3,6,14,0.5)",
              }}
            >
              {explanations.length > 0 && (
                <div style={{ padding: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                    <p style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.5)", fontFamily: "var(--font-dm-sans)" }}>
                      Explanations ({explanations.length})
                    </p>
                    <button
                      onClick={() => setExplanations([])}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(180,190,210,0.3)", display: "flex", padding: "2px" }}
                    >
                      <X size={12} />
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {explanations.map((exp) => (
                      <div
                        key={exp.id}
                        style={{
                          padding: "14px 16px",
                          borderRadius: "10px",
                          background: "rgba(255,255,255,0.02)",
                          border: `1px solid ${exp.isStreaming ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.06)"}`,
                        }}
                      >
                        {/* Highlighted text quote */}
                        <div style={{ marginBottom: "10px", padding: "8px 12px", borderLeft: "2px solid rgba(201,168,76,0.3)", background: "rgba(201,168,76,0.04)", borderRadius: "0 6px 6px 0" }}>
                          <p style={{ fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(201,168,76,0.5)", fontFamily: "var(--font-dm-sans)", marginBottom: "4px" }}>
                            {MODES.find((m) => m.key === exp.mode)?.label || "Explain"}
                          </p>
                          <p style={{ fontSize: "11px", color: "rgba(220,228,240,0.7)", fontFamily: "var(--font-dm-sans)", lineHeight: 1.5, fontStyle: "italic" }}>
                            &ldquo;{exp.highlight}&rdquo;
                          </p>
                        </div>

                        {/* AI explanation */}
                        <div className="research-md" style={{ fontSize: "12px", lineHeight: 1.7, color: "rgba(220,228,240,0.85)" }}>
                          {exp.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
                              {exp.content}
                            </ReactMarkdown>
                          ) : exp.isStreaming ? (
                            <span style={{ color: "rgba(201,168,76,0.6)" }}>Analysing…</span>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Floating tooltip on selection */}
      {tooltip && (
        <div
          style={{
            position: "fixed",
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: "translate(-50%, -100%)",
            zIndex: 9999,
            display: "flex",
            gap: "4px",
            padding: "4px",
            borderRadius: "10px",
            background: "rgba(8,16,30,0.95)",
            border: "1px solid rgba(201,168,76,0.3)",
            boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
            backdropFilter: "blur(8px)",
          }}
        >
          {MODES.map((m) => {
            const Icon = m.icon;
            const isActive = activeMode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => explainHighlight(tooltip.text, m.key)}
                title={m.label}
                style={{
                  display: "flex", alignItems: "center", gap: "5px",
                  padding: "6px 10px", borderRadius: "7px", border: "none",
                  background: isActive ? "rgba(201,168,76,0.2)" : "transparent",
                  color: isActive ? "#c9a84c" : "rgba(180,190,210,0.7)",
                  fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer",
                  transition: "all 0.12s",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.15)"; e.currentTarget.style.color = "#c9a84c"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? "rgba(201,168,76,0.2)" : "transparent"; e.currentTarget.style.color = isActive ? "#c9a84c" : "rgba(180,190,210,0.7)"; }}
              >
                <Icon size={11} />
                {m.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
