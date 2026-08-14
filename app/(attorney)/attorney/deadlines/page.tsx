"use client";

import { useState } from "react";
import { CalendarClock, Download, AlertTriangle, Clock, RotateCcw } from "lucide-react";
import type { DeadlineEntry } from "@/types";
import { DocumentUploadZone } from "@/components/attorney/DocumentUploadZone";
import { DocStarField } from "@/components/attorney/DocStarField";
import { EnclaveProcessing } from "@/components/attorney/EnclaveProcessing";

const TYPE_LABELS: Record<DeadlineEntry["deadlineType"], string> = {
  fixed: "Fixed Date",
  relative: "Relative Period",
  triggered: "Triggered",
  recurring: "Recurring",
};

const TYPE_COLORS: Record<DeadlineEntry["deadlineType"], string> = {
  fixed: "rgba(201,168,76,0.7)",
  relative: "rgba(100,160,255,0.7)",
  triggered: "rgba(180,120,255,0.7)",
  recurring: "rgba(74,197,110,0.7)",
};

const TYPE_BG: Record<DeadlineEntry["deadlineType"], string> = {
  fixed: "rgba(201,168,76,0.08)",
  relative: "rgba(100,160,255,0.08)",
  triggered: "rgba(180,120,255,0.08)",
  recurring: "rgba(74,197,110,0.08)",
};

const PRIORITY_COLOR: Record<DeadlineEntry["priority"], string> = {
  high: "#e07070",
  medium: "#c9a84c",
  low: "#ffffff",
};

const PRIORITY_BG: Record<DeadlineEntry["priority"], string> = {
  high: "rgba(200,80,80,0.08)",
  medium: "rgba(201,168,76,0.08)",
  low: "rgba(140,160,190,0.05)",
};

export default function DeadlinesPage() {
  const [file, setFile] = useState<File | null>(null);
  const [entries, setEntries] = useState<DeadlineEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<DeadlineEntry["priority"] | "all">("all");
  const [filterType, setFilterType] = useState<DeadlineEntry["deadlineType"] | "all">("all");

  async function extract() {
    if (!file || loading) return;
    setLoading(true);
    setError(null);
    setEntries(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("language", localStorage.getItem("mizan-locale") || "en");
      const res = await fetch("/api/attorney/deadlines", { method: "POST", credentials: "include", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      setEntries(data.entries);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setFile(null);
    setEntries(null);
    setError(null);
    setFilterPriority("all");
    setFilterType("all");
  }

  function exportCsv() {
    if (!entries) return;
    const rows = [
      ["Priority", "Obligation", "Party", "Deadline", "Type", "Clause", "Consequence"],
      ...entries.map((e) => [
        e.priority,
        `"${e.obligation.replace(/"/g, '""')}"`,
        `"${e.party.replace(/"/g, '""')}"`,
        `"${e.deadline.replace(/"/g, '""')}"`,
        e.deadlineType,
        e.clauseRef ?? "",
        `"${(e.consequence ?? "").replace(/"/g, '""')}"`,
      ]),
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mizan_Deadlines_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const filtered = entries
    ? entries.filter((e) =>
        (filterPriority === "all" || e.priority === filterPriority) &&
        (filterType === "all" || e.deadlineType === filterType)
      )
    : [];

  const counts = entries
    ? {
        high: entries.filter((e) => e.priority === "high").length,
        medium: entries.filter((e) => e.priority === "medium").length,
        low: entries.filter((e) => e.priority === "low").length,
      }
    : null;

  return (
    <div className="flex flex-col h-full" style={{ background: "#060d1a", position: "relative" }}>
      <DocStarField />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-cormorant)", fontSize: "22px", fontWeight: 300, color: "#e8d5a0", letterSpacing: "0.04em" }}>
            Deadline Extractor
          </h1>
          <p style={{ fontSize: "11px", color: "#ffffff", marginTop: "2px", fontFamily: "var(--font-dm-sans)" }}>
            Obligations · Notice periods · Renewal windows · Recurring duties
          </p>
          <p style={{ fontSize: "10px", color: "rgba(201,168,76,0.5)", marginTop: "3px", fontFamily: "var(--font-dm-sans)" }}>
            Fully local · 0 bytes leave your device
          </p>
        </div>
        {entries && (
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              onClick={exportCsv}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 14px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}
            >
              <Download size={12} /> Export CSV
            </button>
            <button
              onClick={reset}
              style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 14px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}
            >
              <RotateCcw size={12} /> New Document
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto" style={{ position: "relative", zIndex: 1, padding: "28px 32px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent", display: "flex", flexDirection: "column" }}>
        <div style={{ maxWidth: "900px", margin: "auto", width: "100%", padding: "28px 0" }}>

          {/* Upload + extract */}
          {!entries && !loading && (
            <div style={{ maxWidth: "560px", margin: "0 auto" }}>
              <DocumentUploadZone file={file} onFile={setFile} disabled={loading} />
              <div style={{ display: "flex", justifyContent: "center", marginTop: "16px" }}>
                <button
                  onClick={extract}
                  disabled={!file}
                  style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 32px", borderRadius: "9px", background: file ? "#c9a84c" : "rgba(201,168,76,0.2)", border: "none", color: file ? "#0b0b10" : "#ffffff", fontSize: "13px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: file ? "pointer" : "default" }}
                >
                  <CalendarClock size={13} /> Extract Deadlines
                </button>
              </div>
            </div>
          )}

          {loading && (
            <EnclaveProcessing
              label="Extracting deadlines locally"
              sublabel="This may take 20–40 seconds for longer contracts"
            />
          )}

          {error && (
            <div style={{ marginTop: "16px", padding: "12px 16px", borderRadius: "10px", background: "rgba(200,50,50,0.08)", border: "1px solid rgba(200,50,50,0.2)", color: "#e07070", fontSize: "13px", fontFamily: "var(--font-dm-sans)" }}>
              {error}
            </div>
          )}

          {/* Results */}
          {entries && (
            <>
              {/* Summary stats */}
              <div style={{ display: "flex", gap: "10px", marginBottom: "24px", flexWrap: "wrap" }}>
                <div style={{ padding: "12px 20px", borderRadius: "10px", background: "rgba(200,80,80,0.07)", border: "1px solid rgba(200,80,80,0.15)", minWidth: "110px" }}>
                  <div style={{ fontSize: "22px", fontFamily: "var(--font-cormorant)", color: "#e07070", fontWeight: 300 }}>{counts!.high}</div>
                  <div style={{ fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(200,80,80,0.6)", fontFamily: "var(--font-dm-sans)", marginTop: "2px" }}>High Priority</div>
                </div>
                <div style={{ padding: "12px 20px", borderRadius: "10px", background: "rgba(201,168,76,0.07)", border: "1px solid rgba(201,168,76,0.15)", minWidth: "110px" }}>
                  <div style={{ fontSize: "22px", fontFamily: "var(--font-cormorant)", color: "#c9a84c", fontWeight: 300 }}>{counts!.medium}</div>
                  <div style={{ fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginTop: "2px" }}>Medium Priority</div>
                </div>
                <div style={{ padding: "12px 20px", borderRadius: "10px", background: "rgba(140,160,190,0.04)", border: "1px solid rgba(140,160,190,0.1)", minWidth: "110px" }}>
                  <div style={{ fontSize: "22px", fontFamily: "var(--font-cormorant)", color: "#ffffff", fontWeight: 300 }}>{counts!.low}</div>
                  <div style={{ fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginTop: "2px" }}>Low Priority</div>
                </div>
                <div style={{ padding: "12px 20px", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", minWidth: "110px" }}>
                  <div style={{ fontSize: "22px", fontFamily: "var(--font-cormorant)", color: "#ffffff", fontWeight: 300 }}>{entries.length}</div>
                  <div style={{ fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginTop: "2px" }}>Total Items</div>
                </div>
              </div>

              {/* Filters */}
              <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontSize: "10px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", letterSpacing: "0.1em", textTransform: "uppercase" }}>Filter:</span>
                {(["all", "high", "medium", "low"] as const).map((p) => (
                  <button key={p} onClick={() => setFilterPriority(p)}
                    style={{ padding: "4px 11px", borderRadius: "20px", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", border: filterPriority === p ? "1px solid rgba(201,168,76,0.35)" : "1px solid rgba(255,255,255,0.07)", background: filterPriority === p ? "rgba(201,168,76,0.08)" : "transparent", color: filterPriority === p ? "#c9a84c" : "#ffffff", transition: "all 0.15s" }}>
                    {p === "all" ? "All priorities" : p.charAt(0).toUpperCase() + p.slice(1)}
                  </button>
                ))}
                <span style={{ width: "1px", height: "16px", background: "rgba(255,255,255,0.08)" }} />
                {(["all", "fixed", "relative", "triggered", "recurring"] as const).map((t) => (
                  <button key={t} onClick={() => setFilterType(t)}
                    style={{ padding: "4px 11px", borderRadius: "20px", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", border: filterType === t ? "1px solid rgba(100,160,255,0.3)" : "1px solid rgba(255,255,255,0.07)", background: filterType === t ? "rgba(100,160,255,0.07)" : "transparent", color: filterType === t ? "rgba(130,180,255,0.9)" : "#ffffff", transition: "all 0.15s" }}>
                    {t === "all" ? "All types" : TYPE_LABELS[t as DeadlineEntry["deadlineType"]]}
                  </button>
                ))}
              </div>

              {/* Deadline cards */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {filtered.length === 0 ? (
                  <div style={{ padding: "32px", textAlign: "center", color: "#ffffff", fontSize: "13px", fontFamily: "var(--font-dm-sans)" }}>
                    No items match the current filters.
                  </div>
                ) : (
                  filtered.map((entry, i) => (
                    <div
                      key={i}
                      style={{ padding: "14px 18px", borderRadius: "10px", background: PRIORITY_BG[entry.priority], border: `1px solid ${PRIORITY_COLOR[entry.priority]}22`, display: "grid", gridTemplateColumns: "1fr auto", gap: "12px", alignItems: "start" }}
                    >
                      <div>
                        {/* Top row */}
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px", flexWrap: "wrap" }}>
                          {entry.priority === "high" && <AlertTriangle size={12} style={{ color: "#e07070", flexShrink: 0 }} />}
                          <span style={{ fontFamily: "var(--font-cormorant)", fontSize: "15px", color: "#e8d5a0", fontWeight: 400, lineHeight: 1.3 }}>
                            {entry.obligation}
                          </span>
                        </div>

                        {/* Deadline + party row */}
                        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px", flexWrap: "wrap" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                            <Clock size={10} style={{ color: "#ffffff", flexShrink: 0 }} />
                            <span style={{ fontSize: "12px", color: "#ffffff", fontFamily: "var(--font-dm-sans)" }}>
                              {entry.deadline}
                            </span>
                          </div>
                          <span style={{ fontSize: "10px", color: "#ffffff" }}>·</span>
                          <span style={{ fontSize: "11px", color: "#ffffff", fontFamily: "var(--font-dm-sans)" }}>
                            {entry.party}
                          </span>
                          {entry.clauseRef && (
                            <>
                              <span style={{ fontSize: "10px", color: "#ffffff" }}>·</span>
                              <span style={{ fontSize: "10px", color: "rgba(201,168,76,0.55)", fontFamily: "var(--font-dm-sans)", letterSpacing: "0.04em" }}>
                                {entry.clauseRef}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Consequence */}
                        {entry.consequence && (
                          <div style={{ fontSize: "11px", color: "rgba(200,80,80,0.65)", fontFamily: "var(--font-dm-sans)", lineHeight: 1.5, marginTop: "2px" }}>
                            If missed: {entry.consequence}
                          </div>
                        )}
                      </div>

                      {/* Right: type badge + priority badge */}
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "5px", flexShrink: 0 }}>
                        <span style={{ padding: "3px 8px", borderRadius: "12px", fontSize: "10px", fontFamily: "var(--font-dm-sans)", background: TYPE_BG[entry.deadlineType], color: TYPE_COLORS[entry.deadlineType], border: `1px solid ${TYPE_COLORS[entry.deadlineType]}33`, whiteSpace: "nowrap" }}>
                          {TYPE_LABELS[entry.deadlineType]}
                        </span>
                        <span style={{ padding: "3px 8px", borderRadius: "12px", fontSize: "10px", fontFamily: "var(--font-dm-sans)", background: PRIORITY_BG[entry.priority], color: PRIORITY_COLOR[entry.priority], border: `1px solid ${PRIORITY_COLOR[entry.priority]}44`, whiteSpace: "nowrap", textTransform: "capitalize" }}>
                          {entry.priority}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  );
}
