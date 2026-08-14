"use client";

import { useEffect, useState, useRef } from "react";
import { DocStarField } from "@/components/attorney/DocStarField";
import { DocumentUploadZone } from "@/components/attorney/DocumentUploadZone";
import { LibraryBig, Trash2, FileText, Loader2, CheckCircle, AlertCircle, RefreshCw } from "lucide-react";

interface UserLaw {
  id: string;
  source: string;
  statute: string;
  fileName: string;
  language: string;
  chunkCount: number;
  createdAt: string;
}

type UploadStatus = "idle" | "uploading" | "ok" | "error";

export default function LawsPage() {
  const [isLight, setIsLight] = useState(false);
  const [laws, setLaws] = useState<UserLaw[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload form state
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [statute, setStatute] = useState("");
  const [language, setLanguage] = useState("en");
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "ok" | "error">("idle");
  const [syncError, setSyncError] = useState("");

  useEffect(() => {
    const stored = localStorage.getItem("attorney-light-mode");
    if (stored === "true") setIsLight(true);
    const handler = (e: Event) => setIsLight((e as CustomEvent).detail.light);
    window.addEventListener("attorney-theme-change", handler);
    return () => window.removeEventListener("attorney-theme-change", handler);
  }, []);

  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setSyncStatus("idle");
    setSyncError("");
    try {
      const res = await fetch("/api/attorney/laws/sync", { method: "POST", credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Sync failed");
      setSyncStatus("ok");
      setTimeout(() => setSyncStatus("idle"), 4000);
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Sync failed");
      setSyncStatus("error");
    } finally {
      setSyncing(false);
    }
  }

  async function fetchLaws() {
    try {
      const res = await fetch("/api/attorney/laws", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setLaws(data.laws);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchLaws(); }, []);

  async function handleUpload() {
    if (!file || !source.trim() || status === "uploading") return;
    setStatus("uploading");
    setErrorMsg("");

    const fd = new FormData();
    fd.append("file", file);
    fd.append("source", source.trim());
    fd.append("statute", statute.trim());
    fd.append("language", language);

    try {
      const res = await fetch("/api/attorney/laws", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");
      setLaws((prev) => [data.law, ...prev]);
      setFile(null);
      setSource("");
      setStatute("");
      setLanguage("en");
      setStatus("ok");
      setTimeout(() => setStatus("idle"), 3000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setStatus("error");
    }
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await fetch(`/api/attorney/laws/${id}`, { method: "DELETE", credentials: "include" });
      setLaws((prev) => prev.filter((l) => l.id !== id));
    } finally {
      setDeletingId(null);
    }
  }

  // Theme tokens
  const bg = isLight ? "#fafaf7" : "#060d1a";
  const cardBg = isLight ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.02)";
  const cardBorder = isLight ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.07)";
  const titleColor = isLight ? "#2a1f0e" : "#e8d5a0";
  const subtitleColor = isLight ? "rgba(60,50,30,0.55)" : "rgba(180,190,210,0.5)";
  const labelColor = isLight ? "rgba(60,50,30,0.5)" : "rgba(180,190,210,0.4)";
  const inputBg = isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)";
  const inputBorder = isLight ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.1)";
  const inputColor = isLight ? "#2a1f0e" : "#e8d5a0";
  const mutedText = isLight ? "rgba(60,50,30,0.55)" : "rgba(180,190,210,0.5)";

  const canUpload = !!file && source.trim().length > 0 && status !== "uploading";

  return (
    <div style={{ position: "relative", minHeight: "100dvh", background: bg, transition: "background 0.5s ease" }}>
      <DocStarField />

      <div style={{ position: "relative", zIndex: 1, maxWidth: "780px", margin: "0 auto", padding: "40px 28px 80px" }}>
        {/* Header */}
        <div style={{ marginBottom: "36px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
            <LibraryBig size={16} style={{ color: "#c9a84c", opacity: 0.8 }} />
            <span style={{ fontFamily: "var(--font-cormorant)", fontSize: "11px", letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(201,168,76,0.55)" }}>
              Law Library
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
            <div>
              <h1 style={{ fontFamily: "var(--font-cormorant)", fontSize: "30px", fontWeight: 300, color: titleColor, letterSpacing: "0.04em", marginBottom: "6px" }}>
                Feed New Laws to the AI
              </h1>
              <p style={{ fontSize: "13px", color: subtitleColor, fontFamily: "var(--font-dm-sans)", lineHeight: 1.6, maxWidth: "520px" }}>
                Upload statutes, regulations, or circulars as .txt or .pdf. They are chunked and embedded locally -- the AI will reference them in all tools.
              </p>
            </div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px", paddingTop: "4px" }}>
              <button
                onClick={handleSync}
                disabled={syncing}
                style={{
                  display: "flex", alignItems: "center", gap: "7px",
                  padding: "9px 18px", borderRadius: "9px", fontSize: "12px",
                  fontFamily: "var(--font-dm-sans)", letterSpacing: "0.06em",
                  cursor: syncing ? "default" : "pointer",
                  opacity: syncing ? 0.7 : 1, transition: "all 0.15s",
                  background: syncStatus === "ok" ? "rgba(74,197,110,0.1)" : syncStatus === "error" ? "rgba(224,112,112,0.08)" : "rgba(126,184,247,0.08)",
                  border: `1px solid ${syncStatus === "ok" ? "rgba(74,197,110,0.3)" : syncStatus === "error" ? "rgba(224,112,112,0.25)" : "rgba(126,184,247,0.2)"}`,
                  color: syncStatus === "ok" ? "#6bc98a" : syncStatus === "error" ? "#e07070" : "#7eb8f7",
                  whiteSpace: "nowrap",
                }}
              >
                {syncing
                  ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
                  : syncStatus === "ok"
                  ? <CheckCircle size={13} />
                  : <RefreshCw size={13} />
                }
                {syncing ? "Syncing…" : syncStatus === "ok" ? "Up to date" : "Sync Laws"}
              </button>
              {syncStatus === "error" && (
                <div style={{ fontSize: "10px", color: "#e07070", fontFamily: "var(--font-dm-sans)", display: "flex", alignItems: "center", gap: "4px" }}>
                  <AlertCircle size={10} />
                  {syncError || "Sync failed"}
                </div>
              )}
              <div style={{ fontSize: "9px", color: subtitleColor, fontFamily: "var(--font-dm-sans)", letterSpacing: "0.06em" }}>
                Pull latest laws from Mizan
              </div>
            </div>
          </div>
        </div>

        {/* Upload card */}
        <div style={{ background: cardBg, border: `1px solid ${cardBorder}`, borderRadius: "16px", padding: "28px", marginBottom: "32px" }}>
          <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: labelColor, fontFamily: "var(--font-dm-sans)", marginBottom: "20px" }}>
            Add a Law Document
          </div>

          <DocumentUploadZone
            onFile={setFile}
            accept=".pdf,.txt"
            file={file}
            disabled={status === "uploading"}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px", marginTop: "18px" }}>
            <div>
              <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: labelColor, fontFamily: "var(--font-dm-sans)", marginBottom: "6px" }}>
                Source Name *
              </label>
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="e.g. Canada Labour Code"
                disabled={status === "uploading"}
                style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", background: inputBg, border: `1px solid ${inputBorder}`, color: inputColor, fontSize: "13px", fontFamily: "var(--font-dm-sans)", outline: "none", boxSizing: "border-box" }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: labelColor, fontFamily: "var(--font-dm-sans)", marginBottom: "6px" }}>
                Statute / Reference
              </label>
              <input
                value={statute}
                onChange={(e) => setStatute(e.target.value)}
                placeholder="e.g. R.S.C. 1985, c. L-2"
                disabled={status === "uploading"}
                style={{ width: "100%", padding: "9px 12px", borderRadius: "8px", background: inputBg, border: `1px solid ${inputBorder}`, color: inputColor, fontSize: "13px", fontFamily: "var(--font-dm-sans)", outline: "none", boxSizing: "border-box" }}
              />
            </div>
          </div>

          <div style={{ marginTop: "14px" }}>
            <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: labelColor, fontFamily: "var(--font-dm-sans)", marginBottom: "6px" }}>
              Language
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              disabled={status === "uploading"}
              style={{ padding: "9px 12px", borderRadius: "8px", background: inputBg, border: `1px solid ${inputBorder}`, color: inputColor, fontSize: "13px", fontFamily: "var(--font-dm-sans)", outline: "none", cursor: "pointer" }}
            >
              <option value="en">English</option>
              <option value="fr">French</option>
              <option value="both">Both</option>
            </select>
          </div>

          <div style={{ marginTop: "20px", display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              onClick={handleUpload}
              disabled={!canUpload}
              style={{
                padding: "10px 24px",
                borderRadius: "10px",
                fontSize: "12px",
                fontFamily: "var(--font-dm-sans)",
                letterSpacing: "0.08em",
                cursor: canUpload ? "pointer" : "default",
                opacity: canUpload ? 1 : 0.45,
                transition: "all 0.15s",
                background: status === "ok" ? "rgba(74,197,110,0.12)" : "rgba(201,168,76,0.1)",
                border: `1px solid ${status === "ok" ? "rgba(74,197,110,0.3)" : "rgba(201,168,76,0.3)"}`,
                color: status === "ok" ? "#6bc98a" : "#c9a84c",
                display: "flex",
                alignItems: "center",
                gap: "7px",
              }}
            >
              {status === "uploading" && <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />}
              {status === "ok" && <CheckCircle size={13} />}
              {status === "uploading" ? "Ingesting…" : status === "ok" ? "Ingested" : "Ingest Law"}
            </button>

            {status === "error" && (
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#e07070", fontFamily: "var(--font-dm-sans)" }}>
                <AlertCircle size={13} />
                {errorMsg || "Something went wrong"}
              </div>
            )}
          </div>
        </div>

        {/* Ingested laws list */}
        <div>
          <div style={{ fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: labelColor, fontFamily: "var(--font-dm-sans)", marginBottom: "16px" }}>
            Your Ingested Laws {!loading && `(${laws.length})`}
          </div>

          {loading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: mutedText, fontSize: "13px", fontFamily: "var(--font-dm-sans)" }}>
              <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} />
              Loading…
            </div>
          ) : laws.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: mutedText, fontFamily: "var(--font-cormorant)", fontSize: "17px", fontWeight: 300 }}>
              No laws ingested yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {laws.map((law) => (
                <div
                  key={law.id}
                  style={{ display: "flex", alignItems: "center", gap: "14px", padding: "14px 18px", borderRadius: "12px", background: cardBg, border: `1px solid ${cardBorder}` }}
                >
                  <FileText size={15} style={{ color: "#c9a84c", opacity: 0.7, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: "var(--font-cormorant)", fontSize: "15px", color: titleColor, fontWeight: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {law.source}
                    </div>
                    <div style={{ fontSize: "10px", color: mutedText, fontFamily: "var(--font-dm-sans)", marginTop: "2px" }}>
                      {law.fileName}{law.statute ? ` · ${law.statute}` : ""} · {law.chunkCount} chunks · {new Date(law.createdAt).toLocaleDateString("en-GB")}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(law.id)}
                    disabled={deletingId === law.id}
                    style={{ background: "transparent", border: "none", cursor: deletingId === law.id ? "default" : "pointer", color: "rgba(224,112,112,0.4)", padding: "4px", display: "flex", alignItems: "center", transition: "color 0.15s", opacity: deletingId === law.id ? 0.4 : 1 }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#e07070"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "rgba(224,112,112,0.4)"; }}
                  >
                    {deletingId === law.id ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={13} />}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
