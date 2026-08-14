"use client";

import { useState, useRef, useEffect } from "react";
import { Scissors, Download, Check, X, AlertTriangle } from "lucide-react";
import { RedlineResult, RedlineChange } from "@/types";
import { SessionHistory } from "@/components/attorney/SessionHistory";
import { EnclaveProcessing } from "@/components/attorney/EnclaveProcessing";
import { DocumentUploadZone } from "@/components/attorney/DocumentUploadZone";
import { DocStarField } from "@/components/attorney/DocStarField";
import { useDocTask } from "@/contexts/DocTaskContext";

const SEV = {
  critical: { bg: "rgba(200,50,50,0.08)", border: "rgba(200,50,50,0.25)", label: "#e07070", badge: "rgba(200,50,50,0.15)" },
  moderate: { bg: "rgba(200,140,40,0.08)", border: "rgba(200,140,40,0.25)", label: "#d4a84c", badge: "rgba(200,140,40,0.15)" },
  minor: { bg: "rgba(60,160,90,0.07)", border: "rgba(60,160,90,0.2)", label: "#6bc98a", badge: "rgba(60,160,90,0.12)" },
};

export default function RedlinePage() {
  const { tasks, startRedline, clearTask } = useDocTask();
  const redlineTask = tasks.REDLINE;

  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<RedlineResult | null>(null);
  const [originalText, setOriginalText] = useState("");
  const [filename, setFilename] = useState("");
  const [changes, setChanges] = useState<RedlineChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [instruction, setInstruction] = useState("");
  const [clientPosition, setClientPosition] = useState("neutral");

  // Hydrate local state when task completes
  useEffect(() => {
    if (redlineTask?.status === "done" && redlineTask.result && !result) {
      setResult(redlineTask.result);
      setOriginalText(redlineTask.originalText ?? "");
      setFilename(redlineTask.filename ?? "");
      setChanges(redlineTask.changes ?? []);
      setHistoryRefresh((n) => n + 1);
    }
    if (redlineTask?.status === "error" && redlineTask.error) {
      setError(redlineTask.error);
    }
  }, [redlineTask?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  function analyze() {
    if (!file) return;
    setError(null);
    setResult(null);
    setChanges([]);
    startRedline(file, instruction.trim() || undefined, clientPosition);
  }

  function accept(id: string) {
    setChanges((prev) => {
      const next = prev.map((c) => c.id === id ? { ...c, accepted: true } : c);
      saveChanges(next);
      return next;
    });
  }

  function reject(id: string) {
    setChanges((prev) => {
      const next = prev.map((c) => c.id === id ? { ...c, accepted: false } : c);
      saveChanges(next);
      return next;
    });
  }

  function acceptAll() {
    setChanges((prev) => {
      const next = prev.map((c) => ({ ...c, accepted: true }));
      saveChanges(next);
      return next;
    });
  }

  function rejectAll() {
    setChanges((prev) => {
      const next = prev.map((c) => ({ ...c, accepted: false }));
      saveChanges(next);
      return next;
    });
  }

  function saveChanges(updatedChanges: RedlineChange[]) {
    const sessionId = redlineTask?.sessionId;
    if (!sessionId || !result) return;
    fetch("/api/attorney/sessions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId,
        tool: "REDLINE",
        title: redlineTask?.title ?? filename,
        data: { result, originalText, filename, changes: updatedChanges },
      }),
    }).catch(() => {});
  }

  async function exportDocx() {
    if (exporting) return;
    setExporting(true);
    try {
      const acceptedChanges = changes.filter((c) => c.accepted === true);
      const res = await fetch("/api/attorney/redline/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ originalText, acceptedChanges, filename }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Redlined_${filename.replace(/\.[^.]+$/, "")}_Mizan.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  function handleRestore(data: unknown) {
    const d = data as { result: RedlineResult; originalText: string; filename: string; changes: RedlineChange[] };
    if (d?.result) {
      clearTask("REDLINE");
      setResult(d.result);
      setOriginalText(d.originalText ?? "");
      setFilename(d.filename ?? "");
      setChanges(d.changes ?? []);
      setFile(null);
      setError(null);
    }
  }

  function reset() {
    clearTask("REDLINE");
    setResult(null);
    setFile(null);
    setChanges([]);
    setError(null);
  }

  const loading = redlineTask?.status === "pending";
  const reviewed = changes.filter((c) => c.accepted !== undefined).length;
  const accepted = changes.filter((c) => c.accepted === true).length;
  const riskColor = result?.overallRisk === "high" ? "#e07070" : result?.overallRisk === "medium" ? "#d4a84c" : "#6bc98a";

  return (
    <div className="flex flex-col h-full" style={{ background: "#060d1a", position: "relative" }}>
      <DocStarField />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-cormorant)", fontSize: "22px", fontWeight: 300, color: "#e8d5a0", letterSpacing: "0.04em" }}>
            Contract Redlining
          </h1>
          <p style={{ fontSize: "11px", color: "#ffffff", marginTop: "2px", fontFamily: "var(--font-dm-sans)" }}>
            Inline suggested changes · Accept or reject individually · Export to Word
          </p>
          <p style={{ fontSize: "10px", color: "rgba(201,168,76,0.5)", marginTop: "3px", fontFamily: "var(--font-dm-sans)" }}>
            Fully local · 0 bytes leave your device
          </p>
        </div>
        <SessionHistory tool="REDLINE" onRestore={handleRestore} refreshTrigger={historyRefresh} />
      </div>

      <div className="flex-1 overflow-y-auto" style={{ position: "relative", zIndex: 1, padding: "28px 32px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent", display: "flex", flexDirection: "column" }}>
        <div style={{ maxWidth: "800px", margin: "auto", width: "100%", padding: "28px 0" }}>

          {/* Upload */}
          {!result && (
            <>
              <DocumentUploadZone
                onFile={(f) => { setFile(f); setError(null); }}
                file={file}
                disabled={loading}
              />

              {file && !loading && (
                <div style={{ marginTop: "20px" }}>
                  {/* Client position */}
                  <div style={{ marginBottom: "12px" }}>
                    <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "8px" }}>
                      Client Position
                    </label>
                    <div style={{ display: "flex", gap: "6px" }}>
                      {[["neutral", "Neutral"], ["supplier", "Favour Supplier"], ["buyer", "Favour Buyer"], ["employer", "Favour Employer"], ["employee", "Favour Employee"]].map(([val, label]) => (
                        <button key={val} onClick={() => setClientPosition(val)}
                          style={{ padding: "6px 12px", borderRadius: "7px", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", border: clientPosition === val ? "1px solid rgba(201,168,76,0.4)" : "1px solid rgba(255,255,255,0.08)", background: clientPosition === val ? "rgba(201,168,76,0.1)" : "transparent", color: clientPosition === val ? "#c9a84c" : "#ffffff", transition: "all 0.15s" }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Custom instruction */}
                  <div style={{ marginBottom: "16px" }}>
                    <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "6px" }}>
                      Custom Instructions <span style={{ color: "#ffffff" }}>(optional)</span>
                    </label>
                    <input
                      type="text"
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder="e.g. This is a Canadian law contract, focus on provincial requirements"
                      style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "8px", padding: "9px 13px", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", outline: "none" }}
                      onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
                      onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }}
                    />
                  </div>
                  <div style={{ display: "flex", justifyContent: "center", gap: "10px" }}>
                    <button onClick={() => { setFile(null); setError(null); }} style={{ padding: "8px 18px", borderRadius: "9px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                      Clear
                    </button>
                    <button onClick={analyze} style={{ padding: "8px 24px", borderRadius: "9px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: "7px" }}>
                      <Scissors size={13} /> Generate Redlines
                    </button>
                  </div>
                </div>
              )}

              {error && (
                <div style={{ marginTop: "20px", padding: "12px 16px", borderRadius: "10px", background: "rgba(200,50,50,0.08)", border: "1px solid rgba(200,50,50,0.2)", color: "#e07070", fontSize: "13px", fontFamily: "var(--font-dm-sans)" }}>
                  {error}
                </div>
              )}

              {loading && (
                <EnclaveProcessing
                  label="Analysing contract locally"
                  sublabel="This may take 20–40 seconds · Larger files will take longer · You can freely use other tools"
                />
              )}
            </>
          )}

          {/* Results */}
          {result && (
            <div>
              {/* Summary bar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", marginBottom: "24px" }}>
                <div>
                  <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: riskColor, marginBottom: "4px" }}>
                    {result.overallRisk.toUpperCase()} RISK
                  </p>
                  <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "17px", fontWeight: 300, color: "#e8d5a0" }}>
                    {result.summary}
                  </p>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <div style={{ fontSize: "11px", color: "#ffffff", fontFamily: "var(--font-dm-sans)" }}>
                    {reviewed}/{changes.length} reviewed · {accepted} accepted
                  </div>
                  <button onClick={acceptAll} style={{ padding: "6px 12px", borderRadius: "7px", background: "rgba(74,197,110,0.1)", border: "1px solid rgba(74,197,110,0.2)", color: "#6bc98a", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                    Accept All
                  </button>
                  <button onClick={rejectAll} style={{ padding: "6px 12px", borderRadius: "7px", background: "rgba(200,50,50,0.08)", border: "1px solid rgba(200,50,50,0.2)", color: "#e07070", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                    Reject All
                  </button>
                  <button onClick={exportDocx} disabled={exporting} style={{ display: "flex", alignItems: "center", gap: "5px", padding: "6px 14px", borderRadius: "7px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "11px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: exporting ? "default" : "pointer", opacity: exporting ? 0.6 : 1 }}>
                    <Download size={12} /> {exporting ? "Exporting…" : "Export .docx"}
                  </button>
                  <button onClick={reset} style={{ padding: "6px 12px", borderRadius: "7px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                    New File
                  </button>
                </div>
              </div>

              {/* Changes list */}
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {changes.map((change) => {
                  const s = SEV[change.severity] || SEV.minor;
                  const isAccepted = change.accepted === true;
                  const isRejected = change.accepted === false;
                  return (
                    <div key={change.id} style={{
                      padding: "16px 18px", borderRadius: "12px",
                      background: isAccepted ? "rgba(74,197,110,0.05)" : isRejected ? "rgba(255,255,255,0.02)" : s.bg,
                      border: `1px solid ${isAccepted ? "rgba(74,197,110,0.2)" : isRejected ? "rgba(255,255,255,0.07)" : s.border}`,
                      opacity: isRejected ? 0.55 : 1, transition: "all 0.2s",
                    }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "10px", marginBottom: "12px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                          <span style={{ fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: s.label, fontFamily: "var(--font-dm-sans)", padding: "2px 8px", borderRadius: "10px", background: s.badge }}>
                            {change.severity}
                          </span>
                          <span style={{ fontSize: "10px", color: "#ffffff", fontFamily: "var(--font-dm-sans)" }}>{change.category}</span>
                          {change.location && (
                            <span style={{ fontSize: "10px", color: "#ffffff", fontFamily: "var(--font-dm-sans)" }}>· {change.location}</span>
                          )}
                        </div>
                        <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                          <button onClick={() => accept(change.id)} title="Accept"
                            style={{ width: "28px", height: "28px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", background: isAccepted ? "rgba(74,197,110,0.2)" : "rgba(74,197,110,0.08)", border: `1px solid ${isAccepted ? "rgba(74,197,110,0.4)" : "rgba(74,197,110,0.15)"}`, cursor: "pointer" }}>
                            <Check size={12} style={{ color: "#6bc98a" }} />
                          </button>
                          <button onClick={() => reject(change.id)} title="Reject"
                            style={{ width: "28px", height: "28px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", background: isRejected ? "rgba(200,50,50,0.18)" : "rgba(200,50,50,0.07)", border: `1px solid ${isRejected ? "rgba(200,50,50,0.4)" : "rgba(200,50,50,0.14)"}`, cursor: "pointer" }}>
                            <X size={12} style={{ color: "#e07070" }} />
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
                        <div style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(200,50,50,0.07)", border: "1px solid rgba(200,50,50,0.15)" }}>
                          <div style={{ fontSize: "8px", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(224,112,112,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "6px" }}>Original</div>
                          <p style={{ fontSize: "12px", color: "rgba(224,180,180,0.85)", fontFamily: "var(--font-dm-sans)", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", textDecoration: "line-through", textDecorationColor: "rgba(224,112,112,0.4)" }}>
                            {change.originalText}
                          </p>
                        </div>
                        <div style={{ padding: "10px 12px", borderRadius: "8px", background: "rgba(74,197,110,0.06)", border: "1px solid rgba(74,197,110,0.15)" }}>
                          <div style={{ fontSize: "8px", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(74,197,110,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "6px" }}>Suggested</div>
                          <p style={{ fontSize: "12px", color: "rgba(180,224,195,0.85)", fontFamily: "var(--font-dm-sans)", lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {change.suggestedText}
                          </p>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: "6px", alignItems: "flex-start" }}>
                        <AlertTriangle size={11} style={{ color: s.label, flexShrink: 0, marginTop: "2px" }} />
                        <p style={{ fontSize: "11px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", lineHeight: 1.55 }}>
                          {change.reason}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
