"use client";

import { useState, useEffect } from "react";
import { FileSearch, AlertTriangle, CheckCircle, Info } from "lucide-react";
import { DocumentReviewResult, ReviewRisk } from "@/types";
import { SessionHistory } from "@/components/attorney/SessionHistory";
import { EnclaveProcessing } from "@/components/attorney/EnclaveProcessing";
import { DocumentUploadZone } from "@/components/attorney/DocumentUploadZone";
import { DocStarField } from "@/components/attorney/DocStarField";
import { useDocTask } from "@/contexts/DocTaskContext";

const SEV_COLORS = {
  high: { bg: "rgba(200,50,50,0.1)", border: "rgba(200,50,50,0.3)", text: "#e07070", dot: "#e05555" },
  medium: { bg: "rgba(200,140,40,0.1)", border: "rgba(200,140,40,0.3)", text: "#d4a84c", dot: "#d4a84c" },
  low: { bg: "rgba(60,160,90,0.1)", border: "rgba(60,160,90,0.25)", text: "#6bc98a", dot: "#5ab87a" },
};

export default function ReviewPage() {
  const { tasks, startReview, clearTask } = useDocTask();
  const reviewTask = tasks.REVIEW;

  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<DocumentReviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoredName, setRestoredName] = useState<string | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [compareFile, setCompareFile] = useState<File | null>(null);
  const [compareResult, setCompareResult] = useState<DocumentReviewResult | null>(null);
  const [comparing, setComparing] = useState(false);

  // Hydrate local state when task completes
  useEffect(() => {
    if (reviewTask?.status === "done" && reviewTask.result && !result) {
      setResult(reviewTask.result);
      setRestoredName(null);
      setHistoryRefresh((n) => n + 1);
    }
    if (reviewTask?.status === "error" && reviewTask.error) {
      setError(reviewTask.error);
    }
  }, [reviewTask?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  function analyze() {
    if (!file) return;
    setError(null);
    setResult(null);
    setRestoredName(null);
    startReview(file);
  }

  function handleRestore(data: unknown) {
    const d = data as { result: DocumentReviewResult; documentName: string };
    if (d?.result) {
      clearTask("REVIEW");
      setResult(d.result);
      setRestoredName(d.documentName ?? null);
      setFile(null);
      setError(null);
    }
  }

  async function runComparison() {
    if (!compareFile || comparing) return;
    setComparing(true);
    try {
      const fd = new FormData();
      fd.append("file", compareFile);
      fd.append("language", localStorage.getItem("mizan-locale") || "en");
      const res = await fetch("/api/attorney/review", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analysis failed");
      setCompareResult(data.result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed");
    } finally {
      setComparing(false);
    }
  }

  function reset() {
    clearTask("REVIEW");
    setResult(null);
    setFile(null);
    setRestoredName(null);
    setError(null);
    setCompareFile(null);
    setCompareResult(null);
  }

  const loading = reviewTask?.status === "pending";

  return (
    <div className="flex flex-col h-full" style={{ background: "#060d1a", position: "relative" }}>
      <DocStarField />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-cormorant)", fontSize: "22px", fontWeight: 300, color: "#e8d5a0", letterSpacing: "0.04em" }}>
            Document Review
          </h1>
          <p style={{ fontSize: "11px", color: "#ffffff", marginTop: "2px", fontFamily: "var(--font-dm-sans)" }}>
            Structured risk analysis · PDF, DOCX, TXT · Attorney-grade output
          </p>
          <p style={{ fontSize: "10px", color: "rgba(201,168,76,0.5)", marginTop: "3px", fontFamily: "var(--font-dm-sans)" }}>
            Fully local · 0 bytes leave your device
          </p>
        </div>
        <SessionHistory tool="REVIEW" onRestore={handleRestore} refreshTrigger={historyRefresh} />
      </div>

      <div className="flex-1 overflow-y-auto" style={{ position: "relative", zIndex: 1, padding: "28px 32px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent", display: "flex", flexDirection: "column" }}>
        <div style={{ maxWidth: "760px", margin: "auto", width: "100%", padding: "28px 0" }}>

          {/* Upload zone */}
          {!result && (
            <DocumentUploadZone
              onFile={(f) => { setFile(f); setError(null); }}
              file={file}
              disabled={loading}
            />
          )}

          {file && !result && !loading && (
            <div style={{ display: "flex", justifyContent: "center", marginTop: "20px", gap: "10px" }}>
              <button
                onClick={() => { setFile(null); setError(null); }}
                style={{ padding: "8px 18px", borderRadius: "9px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}
              >
                Clear
              </button>
              <button
                onClick={analyze}
                style={{ padding: "8px 24px", borderRadius: "9px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: "pointer", transition: "all 0.15s", display: "flex", alignItems: "center", gap: "7px" }}
              >
                <FileSearch size={13} />
                Analyse Document
              </button>
            </div>
          )}

          {error && (
            <div style={{ marginTop: "20px", padding: "12px 16px", borderRadius: "10px", background: "rgba(200,50,50,0.08)", border: "1px solid rgba(200,50,50,0.2)", color: "#e07070", fontSize: "13px", fontFamily: "var(--font-dm-sans)" }}>
              {error}
            </div>
          )}

          {loading && (
            <EnclaveProcessing
              label="Analysing document locally"
              sublabel="This may take 15–30 seconds · Larger files will take longer · You can freely use other tools"
            />
          )}

          {/* Result */}
          {result && (
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* Top bar */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px" }}>
                <div>
                  <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", marginBottom: "4px" }}>
                    {result.documentType}
                  </p>
                  <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "20px", fontWeight: 300, color: "#e8d5a0" }}>
                    Review Complete{restoredName ? ` — ${restoredName}` : reviewTask?.documentName ? ` — ${reviewTask.documentName}` : ""}
                  </p>
                </div>
                <button
                  onClick={reset}
                  style={{ padding: "6px 12px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}
                >
                  New Review
                </button>
              </div>

              {/* Summary */}
              <div style={{ padding: "16px 20px", borderRadius: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "10px" }}>
                  <Info size={13} style={{ color: "rgba(201,168,76,0.7)" }} />
                  <span style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.7)", fontFamily: "var(--font-dm-sans)" }}>Summary</span>
                </div>
                <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "15px", fontWeight: 300, color: "#ffffff", lineHeight: 1.75 }}>
                  {result.summary}
                </p>
              </div>

              {/* Overall Assessment */}
              <div style={{ padding: "16px 20px", borderRadius: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "10px" }}>
                  <CheckCircle size={13} style={{ color: "rgba(74,197,110,0.7)" }} />
                  <span style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(74,197,110,0.7)", fontFamily: "var(--font-dm-sans)" }}>Overall Assessment</span>
                </div>
                <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "15px", fontWeight: 300, color: "#ffffff", lineHeight: 1.75 }}>
                  {result.overallAssessment}
                </p>
              </div>

              {/* Risks */}
              {result.risks.length > 0 && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "7px", marginBottom: "14px" }}>
                    <AlertTriangle size={13} style={{ color: "rgba(224,112,112,0.7)" }} />
                    <span style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(224,112,112,0.7)", fontFamily: "var(--font-dm-sans)" }}>
                      Identified Risks ({result.risks.length})
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {result.risks.map((risk: ReviewRisk, i: number) => {
                      const c = SEV_COLORS[risk.severity] || SEV_COLORS.medium;
                      return (
                        <div key={i} style={{ padding: "14px 16px", borderRadius: "10px", background: c.bg, border: `1px solid ${c.border}` }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                            <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: c.dot, flexShrink: 0 }} />
                            <span style={{ fontFamily: "var(--font-cormorant)", fontSize: "14px", color: c.text, fontWeight: 500 }}>{risk.clause}</span>
                            <span style={{ marginLeft: "auto", fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", color: c.text, fontFamily: "var(--font-dm-sans)", opacity: 0.8 }}>
                              {risk.severity}
                            </span>
                          </div>
                          <p style={{ fontSize: "12px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", lineHeight: 1.6, marginBottom: "6px" }}>
                            {risk.text}
                          </p>
                          <p style={{ fontSize: "11px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", lineHeight: 1.5 }}>
                            <span style={{ color: c.text, opacity: 0.9 }}>Recommendation: </span>{risk.recommendation}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Missing Clauses */}
              {result.missingClauses.length > 0 && (
                <div>
                  <div style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "10px" }}>
                    Missing / Recommended Clauses
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {result.missingClauses.map((clause: string, i: number) => (
                      <span key={i} style={{ padding: "5px 12px", borderRadius: "20px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.09)", color: "#ffffff", fontSize: "11px", fontFamily: "var(--font-dm-sans)" }}>
                        {clause}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Revised version comparison */}
              <div style={{ padding: "16px 20px", borderRadius: "12px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <div style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "12px" }}>
                  Compare with Revised Version
                </div>
                {compareResult ? (
                  <div>
                    <p style={{ fontSize: "12px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", lineHeight: 1.6 }}>{compareResult.overallAssessment}</p>
                    <button onClick={() => setCompareResult(null)} style={{ marginTop: "10px", fontSize: "11px", color: "#ffffff", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-dm-sans)" }}>
                      Clear comparison
                    </button>
                  </div>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <input type="file" accept=".pdf,.docx,.txt" style={{ display: "none" }} id="compare-upload"
                      onChange={(e) => { if (e.target.files?.[0]) setCompareFile(e.target.files[0]); }} />
                    <label htmlFor="compare-upload" style={{ padding: "7px 14px", borderRadius: "8px", background: "rgba(255,255,255,0.03)", border: "1px dashed rgba(255,255,255,0.1)", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                      {compareFile ? compareFile.name : "Upload revised version…"}
                    </label>
                    {compareFile && (
                      <button onClick={runComparison} disabled={comparing}
                        style={{ padding: "7px 14px", borderRadius: "8px", background: "rgba(201,168,76,0.12)", border: "1px solid rgba(201,168,76,0.25)", color: "#c9a84c", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: comparing ? "default" : "pointer", opacity: comparing ? 0.6 : 1 }}>
                        {comparing ? "Analysing…" : "Compare"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
