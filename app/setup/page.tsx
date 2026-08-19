"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Jurisdiction } from "@/contexts/JurisdictionContext";

interface SetupStatus {
  dbReady: boolean;
  modelReady: boolean;
  embeddingReady: boolean;
  vectorsReady: boolean;
  defaultModel?: string;
  embeddingModel?: string;
}

interface ModelState {
  status: "idle" | "pulling" | "done" | "error";
  label: string;
  total: number;
  completed: number;
  currentStatus: string;
  error?: string;
}

interface HardwareInfo {
  totalRam: number;
  cpuModel: string;
  cpuCores: number;
  platform: string;
  arch: string;
}

interface ModelTier {
  id: string;
  name: string;
  size: string;
  ramNeeded: string;
  description: string;
  recommended?: boolean;
}

const MODEL_TIERS: ModelTier[] = [
  { id: "qwen2.5:3b", name: "qwen2.5:3b", size: "~2 GB", ramNeeded: "8 GB", description: "Fastest responses, good for basic tasks" },
  { id: "qwen2.5:7b", name: "qwen2.5:7b", size: "~4.7 GB", ramNeeded: "16 GB", description: "Best balance of speed and quality" },
  { id: "qwen2.5:14b", name: "qwen2.5:14b", size: "~9 GB", ramNeeded: "32 GB", description: "Highest quality, slower on most hardware" },
];

function recommendModel(hw: HardwareInfo): string {
  const ramGB = hw.totalRam / (1024 * 1024 * 1024);
  if (ramGB >= 28) return "qwen2.5:14b";
  if (ramGB >= 12) return "qwen2.5:7b";
  return "qwen2.5:3b";
}

function formatRam(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024 * 1024))} GB`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{
      width: "100%", height: "4px", borderRadius: "2px",
      background: "rgba(255,255,255,0.07)", overflow: "hidden",
    }}>
      <div style={{
        height: "100%", borderRadius: "2px",
        width: `${Math.min(100, pct)}%`,
        background: color,
        transition: "width 0.3s ease",
      }} />
    </div>
  );
}

function ModelCard({
  name,
  size,
  state,
  onDownload,
  isLight,
  accent,
}: {
  name: string;
  size: string;
  state: ModelState;
  onDownload: () => void;
  isLight: boolean;
  accent: string;
}) {
  const cardBg = isLight ? "rgba(238,233,222,0.92)" : "rgba(255,255,255,0.04)";
  const border = isLight ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.07)";
  const textMain = isLight ? "rgba(28,34,52,0.92)" : "rgba(220,228,242,0.9)";
  const textMuted = isLight ? "rgba(50,60,84,0.6)" : "rgba(140,160,190,0.7)";
  const greenColor = isLight ? "#1a7a40" : "#4ac56e";

  const pct = state.total > 0 ? (state.completed / state.total) * 100 : 0;

  return (
    <div style={{
      background: cardBg,
      border: `1px solid ${border}`,
      borderRadius: "12px",
      padding: "20px 24px",
      display: "flex",
      flexDirection: "column",
      gap: "12px",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <p style={{ margin: 0, fontFamily: "var(--font-dm-sans)", fontSize: "13px", fontWeight: 500, color: textMain, letterSpacing: "0.02em" }}>
            {name}
          </p>
          <p style={{ margin: "3px 0 0", fontFamily: "var(--font-dm-sans)", fontSize: "11px", color: textMuted }}>
            {size}
          </p>
        </div>

        {state.status === "done" && (
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "4px 10px", borderRadius: "6px",
            background: isLight ? "rgba(18,110,50,0.1)" : "rgba(74,197,110,0.12)",
            border: `1px solid ${isLight ? "rgba(18,110,50,0.2)" : "rgba(74,197,110,0.2)"}`,
          }}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 5L4 7.5L8.5 2.5" stroke={greenColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "11px", color: greenColor, letterSpacing: "0.04em" }}>
              Ready
            </span>
          </div>
        )}

        {state.status === "idle" && (
          <button
            onClick={onDownload}
            style={{
              padding: "5px 14px", borderRadius: "6px",
              border: `1px solid ${accent}40`,
              background: "transparent", color: accent,
              fontFamily: "var(--font-dm-sans)", fontSize: "11px",
              cursor: "pointer", letterSpacing: "0.04em",
            }}
          >
            Download
          </button>
        )}

        {state.status === "pulling" && (
          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "11px", color: accent, letterSpacing: "0.04em" }}>
            {pct > 0 ? `${pct.toFixed(1)}%` : "Starting..."}
          </span>
        )}

        {state.status === "error" && (
          <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "11px", color: "#e05252", letterSpacing: "0.04em" }}>
            Error
          </span>
        )}
      </div>

      {state.status === "pulling" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <ProgressBar pct={pct} color={accent} />
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "10px", color: textMuted }}>
              {state.currentStatus || "Connecting to Ollama..."}
            </span>
            {state.total > 0 && (
              <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "10px", color: textMuted }}>
                {formatBytes(state.completed)} / {formatBytes(state.total)}
              </span>
            )}
          </div>
        </div>
      )}

      {state.status === "error" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <p style={{ margin: 0, fontFamily: "var(--font-dm-sans)", fontSize: "11px", color: "#e05252" }}>
            {state.error ?? "Failed to download model. Make sure Ollama is running."}
          </p>
          <button
            onClick={onDownload}
            style={{
              alignSelf: "flex-start", padding: "5px 14px", borderRadius: "6px",
              border: "1px solid rgba(224,82,82,0.3)",
              background: "transparent", color: "#e05252",
              fontFamily: "var(--font-dm-sans)", fontSize: "11px",
              cursor: "pointer", letterSpacing: "0.04em",
            }}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}

const J_CONFIG: Record<Jurisdiction, { accent: string; accentRgb: string; flag: string; label: string; systemName: string; pageBg: string }> = {
  ca: { accent: "#c9a84c", accentRgb: "201,168,76", flag: "🇨🇦", label: "Canada", systemName: "Canadian Federal & Provincial Law", pageBg: "#060d1a" },
};

export default function SetupPage() {
  const router = useRouter();

  // Determine initial step from localStorage synchronously to avoid flash
  const [step, setStep] = useState<"pick" | "download">(() => {
    if (typeof window === "undefined") return "pick";
    if (localStorage.getItem("mizan-setup-done") === "1") return "download";
    try {
      const raw = localStorage.getItem("mizan-jurisdictions");
      if (raw) {
        const saved = JSON.parse(raw) as Jurisdiction[];
        if (saved.length > 0) return "download";
      }
    } catch { /* */ }
    return "pick";
  });

  const [selectedJurisdictions, setSelectedJurisdictions] = useState<Jurisdiction[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const raw = localStorage.getItem("mizan-jurisdictions");
      return raw ? (JSON.parse(raw) as Jurisdiction[]) : [];
    } catch { return []; }
  });

  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [checking, setChecking] = useState(step === "download");
  const [isLight] = useState(false);
  const [hardware, setHardware] = useState<HardwareInfo | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem("mizan-selected-model") ?? "";
  });

  const activeJ: Jurisdiction = selectedJurisdictions[0] ?? "ca";
  const jc = J_CONFIG[activeJ];
  const bg = jc.pageBg;
  const gold = jc.accent;
  const textMain = "rgba(220,228,242,0.9)";
  const textMuted = "rgba(140,160,190,0.7)";
  const cardBg = "rgba(255,255,255,0.03)";
  const border = "rgba(255,255,255,0.06)";

  const defaultModel = selectedModel || status?.defaultModel || "qwen2.5:7b";
  const embeddingModel = status?.embeddingModel ?? "nomic-embed-text";

  const [mainModel, setMainModel] = useState<ModelState>({
    status: "idle", label: defaultModel,
    total: 0, completed: 0, currentStatus: "",
  });
  const [embedModel, setEmbedModel] = useState<ModelState>({
    status: "idle", label: embeddingModel,
    total: 0, completed: 0, currentStatus: "",
  });
  const [vectorSync, setVectorSync] = useState<"idle" | "syncing" | "done" | "error">("idle");
  const [vectorError, setVectorError] = useState("");

  const pullingMain = useRef(false);
  const pullingEmbed = useRef(false);

  useEffect(() => {
    const migratePromise = fetch("/api/setup/migrate", { method: "POST" }).catch(() => {});
    if (typeof window !== "undefined" && localStorage.getItem("mizan-setup-done") === "1") {
      // Wait for migrate to finish before redirecting so the local user exists
      migratePromise.then(() => router.replace("/attorney/research"));
      return;
    }
    detectHardware();
    if (step === "download") {
      check();
    }
  }, []);

  async function detectHardware() {
    try {
      let hw: HardwareInfo | null = null;
      // Try Electron IPC first
      const w = window as unknown as { electron?: { app?: { hardware?: () => Promise<HardwareInfo> } } };
      if (w.electron?.app?.hardware) {
        hw = await w.electron.app.hardware();
      } else {
        // Fallback: server-side API
        const res = await fetch("/api/setup/hardware", { signal: AbortSignal.timeout(5000) });
        if (res.ok) hw = await res.json();
      }
      if (hw) {
        setHardware(hw);
        if (!selectedModel) {
          const rec = recommendModel(hw);
          selectModel(rec);
        }
      }
    } catch {
      // Hardware detection failed, use default
    }
  }

  function selectModel(model: string) {
    setSelectedModel(model);
    localStorage.setItem("mizan-selected-model", model);
    setMainModel(s => ({ ...s, label: model }));
    // Persist to server so llm.ts can read it
    fetch("/api/setup/select-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }).catch(() => {});
  }

  async function check() {
    setChecking(true);
    try {
      const modelParam = selectedModel ? `?model=${encodeURIComponent(selectedModel)}` : "";
      const res = await fetch(`/api/setup/status${modelParam}`, { signal: AbortSignal.timeout(12000) });
      const data: SetupStatus = await res.json();
      setStatus(data);

      if (data.modelReady) setMainModel(s => ({ ...s, status: "done" }));
      if (data.embeddingReady) setEmbedModel(s => ({ ...s, status: "done" }));
      if (data.vectorsReady) setVectorSync("done");

      if (data.dbReady && data.modelReady && data.embeddingReady) {
        localStorage.setItem("mizan-setup-done", "1");
        router.replace("/attorney/research");
        return;
      }
    } catch {
      // Ollama or server not ready yet, stay on setup
    }
    setChecking(false);
  }

  async function pullModel(
    model: string,
    setter: React.Dispatch<React.SetStateAction<ModelState>>,
    pullingRef: React.MutableRefObject<boolean>
  ) {
    if (pullingRef.current) return;
    pullingRef.current = true;

    setter(s => ({ ...s, status: "pulling", total: 0, completed: 0, currentStatus: "Connecting..." }));

    try {
      const res = await fetch("/api/setup/pull-model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Ollama not reachable (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed) as {
              status?: string;
              total?: number;
              completed?: number;
              error?: string;
            };

            if (chunk.error) throw new Error(chunk.error);

            setter(s => ({
              ...s,
              currentStatus: chunk.status ?? s.currentStatus,
              total: chunk.total ?? s.total,
              completed: chunk.completed ?? s.completed,
            }));

            if (chunk.status === "success") {
              setter(s => ({ ...s, status: "done" }));
              pullingRef.current = false;
              setTimeout(check, 500);
              return;
            }
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== "Unexpected token") {
              throw parseErr;
            }
          }
        }
      }

      setter(s => ({ ...s, status: "done" }));
      pullingRef.current = false;
      setTimeout(check, 500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setter(s => ({ ...s, status: "error", error: msg }));
      pullingRef.current = false;
    }
  }

  function downloadMainModel() { pullModel(defaultModel, setMainModel, pullingMain); }
  function downloadEmbedModel() { pullModel(embeddingModel, setEmbedModel, pullingEmbed); }

  // Silently pull the light model (qwen2.5:3b) in the background after main model is ready.
  // This enables faster suggestions and title generation without user interaction.
  const lightPulled = useRef(false);
  useEffect(() => {
    if (mainModel.status === "done" && !lightPulled.current) {
      lightPulled.current = true;
      const lightModel = "qwen2.5:3b";
      if (lightModel !== defaultModel) {
        fetch("/api/setup/pull-model", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: lightModel }),
        }).catch(() => {});
      }
    }
  }, [mainModel.status, defaultModel]);

  async function downloadVectors() {
    if (vectorSync === "syncing") return;
    setVectorSync("syncing");
    setVectorError("");
    try {
      const res = await fetch("/api/attorney/laws/sync", { method: "POST", credentials: "include" });
      const data = await res.json() as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error ?? "Download failed");
      setVectorSync("done");
    } catch (err) {
      setVectorSync("error");
      setVectorError(err instanceof Error ? err.message : "Download failed");
    }
  }

  function downloadAll() {
    if (mainModel.status === "idle" || mainModel.status === "error") downloadMainModel();
    if (embedModel.status === "idle" || embedModel.status === "error") downloadEmbedModel();
    if (vectorSync === "idle" || vectorSync === "error") downloadVectors();
  }

  const allReady = mainModel.status === "done" && embedModel.status === "done" && vectorSync === "done";
  const anyPulling = mainModel.status === "pulling" || embedModel.status === "pulling" || vectorSync === "syncing";
  const anyPending = mainModel.status !== "done" || embedModel.status !== "done" || vectorSync !== "done";

  const lawPackLabel = "~7 MB  |  Canadian federal and provincial law statutes";

  // ── Jurisdiction picker ────────────────────────────────────────────────────
  if (step === "pick") {
    return (
      <div style={{
        minHeight: "100vh", background: "#060d1a",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "var(--font-dm-sans)", padding: "40px 20px",
      }}>
        <div style={{ width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "32px" }}>

          {/* Logo */}
          <div style={{ textAlign: "center" }}>
            <h1 style={{ margin: 0, fontSize: "28px", fontFamily: "var(--font-cormorant)", fontWeight: 300, letterSpacing: "0.12em", color: "#c9a84c" }}>
              MIZAN
            </h1>
            <p style={{ margin: "6px 0 0", fontSize: "11px", letterSpacing: "0.14em", color: "rgba(140,160,190,0.7)", textTransform: "uppercase" }}>
              Legal Intelligence
            </p>
          </div>

          {/* Card */}
          <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: "16px", padding: "28px", display: "flex", flexDirection: "column", gap: "24px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 500, color: "rgba(220,228,242,0.9)", letterSpacing: "0.02em" }}>
                Select your jurisdiction
              </h2>
              <p style={{ margin: "6px 0 0", fontSize: "12px", color: "rgba(140,160,190,0.7)", lineHeight: "1.6" }}>
                Choose the legal system you practise in. You can switch between jurisdictions inside the app at any time.
              </p>
            </div>

            {/* Jurisdiction cards */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
              {(["ca"] as Jurisdiction[]).map((j) => {
                const selected = selectedJurisdictions.includes(j);
                const cfg = J_CONFIG[j];
                return (
                  <div
                    key={j}
                    onClick={() => setSelectedJurisdictions(prev =>
                      prev.includes(j) ? prev.filter(x => x !== j) : [...prev, j]
                    )}
                    style={{
                      padding: "20px 16px", borderRadius: "12px", cursor: "pointer",
                      border: selected ? `1px solid rgba(${cfg.accentRgb},0.5)` : "1px solid rgba(255,255,255,0.07)",
                      background: selected ? `rgba(${cfg.accentRgb},0.07)` : "rgba(255,255,255,0.02)",
                      transition: "all 0.2s",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: "10px",
                      position: "relative",
                    }}
                  >
                    {selected && (
                      <div style={{
                        position: "absolute", top: "8px", right: "8px",
                        width: "16px", height: "16px", borderRadius: "50%",
                        background: `rgba(${cfg.accentRgb},0.2)`,
                        border: `1px solid rgba(${cfg.accentRgb},0.5)`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                          <path d="M1.5 4L3 5.5L6.5 2" stroke={cfg.accent} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    )}
                    <span style={{ fontSize: "32px", lineHeight: 1 }}>{cfg.flag}</span>
                    <span style={{ fontFamily: "var(--font-dm-sans)", fontSize: "12px", fontWeight: 500, color: selected ? cfg.accent : "rgba(220,228,242,0.7)", textAlign: "center", transition: "color 0.2s" }}>
                      {cfg.label}
                    </span>
                    <span style={{ fontSize: "9px", letterSpacing: "0.1em", textTransform: "uppercase", color: selected ? `rgba(${cfg.accentRgb},0.7)` : "rgba(140,160,190,0.4)", fontFamily: "var(--font-dm-sans)", textAlign: "center" }}>
                      {cfg.systemName}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Continue button */}
            <button
              disabled={selectedJurisdictions.length === 0}
              onClick={() => {
                if (selectedJurisdictions.length === 0) return;
                localStorage.setItem("mizan-jurisdictions", JSON.stringify(selectedJurisdictions));
                localStorage.setItem("mizan-jurisdiction", selectedJurisdictions[0]);
                setStep("download");
                setChecking(true);
                check();
              }}
              style={{
                width: "100%", padding: "11px", borderRadius: "8px",
                border: "none",
                background: selectedJurisdictions.length > 0
                  ? J_CONFIG[selectedJurisdictions[0]].accent
                  : "rgba(255,255,255,0.06)",
                color: selectedJurisdictions.length > 0
                  ? "#060d1a"
                  : "rgba(255,255,255,0.25)",
                fontFamily: "var(--font-dm-sans)", fontSize: "12px",
                fontWeight: 500, letterSpacing: "0.06em",
                cursor: selectedJurisdictions.length > 0 ? "pointer" : "not-allowed",
                textTransform: "uppercase" as const,
                transition: "all 0.2s",
              }}
            >
              Continue
            </button>
          </div>

          <p style={{ textAlign: "center", fontSize: "10px", color: "rgba(140,160,190,0.5)", margin: 0, letterSpacing: "0.04em" }}>
            All processing is local. Nothing is sent to external servers.
          </p>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Spinner (checking status after jurisdiction selected) ──────────────────
  if (checking) {
    return (
      <div style={{
        minHeight: "100vh", background: bg,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <div style={{
          width: "32px", height: "32px", borderRadius: "50%",
          border: `2px solid ${gold}26`,
          borderTopColor: gold,
          animation: "spin 0.8s linear infinite",
        }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  // ── Download step ──────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: "100vh", background: bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-dm-sans)",
      padding: "40px 20px",
    }}>
      <div style={{ width: "100%", maxWidth: "480px", display: "flex", flexDirection: "column", gap: "32px" }}>

        {/* Logo */}
        <div style={{ textAlign: "center" }}>
          <h1 style={{
            margin: 0, fontSize: "28px", fontFamily: "var(--font-cormorant)",
            fontWeight: 300, letterSpacing: "0.12em",
            color: gold,
          }}>
            MIZAN
          </h1>
          <p style={{
            margin: "6px 0 0", fontSize: "11px", letterSpacing: "0.14em",
            color: textMuted, textTransform: "uppercase",
          }}>
            {jc.flag} {jc.systemName}
          </p>
        </div>

        {/* Status card */}
        <div style={{
          background: cardBg,
          border: `1px solid ${border}`,
          borderRadius: "16px",
          padding: "28px",
          display: "flex", flexDirection: "column", gap: "24px",
        }}>
          <div>
            <h2 style={{
              margin: 0, fontSize: "16px", fontWeight: 500,
              color: textMain, letterSpacing: "0.02em",
            }}>
              First-time setup
            </h2>
            <p style={{ margin: "6px 0 0", fontSize: "12px", color: textMuted, lineHeight: "1.6" }}>
              Mizan runs entirely on your device. The AI models below must be downloaded
              once before you can use the assistant. No data leaves your machine.
            </p>
          </div>

          {/* Hardware detection + model recommendation */}
          {hardware && (
            <div style={{
              background: "rgba(255,255,255,0.02)",
              border: `1px solid rgba(255,255,255,0.06)`,
              borderRadius: "10px",
              padding: "14px 16px",
              display: "flex", flexDirection: "column", gap: "10px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                  <rect x="2" y="4" width="10" height="7" rx="1.5" stroke={gold} strokeWidth="1.2" />
                  <path d="M5 4V2.5A1.5 1.5 0 0 1 6.5 1h1A1.5 1.5 0 0 1 9 2.5V4" stroke={gold} strokeWidth="1.2" />
                  <line x1="4.5" y1="7" x2="4.5" y2="9" stroke={gold} strokeWidth="1" strokeLinecap="round" />
                  <line x1="7" y1="7" x2="7" y2="9" stroke={gold} strokeWidth="1" strokeLinecap="round" />
                  <line x1="9.5" y1="7" x2="9.5" y2="9" stroke={gold} strokeWidth="1" strokeLinecap="round" />
                </svg>
                <span style={{ fontSize: "11px", color: textMain, fontFamily: "var(--font-dm-sans)", fontWeight: 500 }}>
                  Your hardware
                </span>
              </div>
              <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
                <span style={{ fontSize: "10px", color: textMuted, fontFamily: "var(--font-dm-sans)" }}>
                  RAM: {formatRam(hardware.totalRam)}
                </span>
                <span style={{ fontSize: "10px", color: textMuted, fontFamily: "var(--font-dm-sans)" }}>
                  CPU: {hardware.cpuModel.replace(/\s+/g, " ").trim()}
                </span>
                <span style={{ fontSize: "10px", color: textMuted, fontFamily: "var(--font-dm-sans)" }}>
                  Cores: {hardware.cpuCores}
                </span>
              </div>
            </div>
          )}

          {/* Model tier selection */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <p style={{ margin: 0, fontSize: "12px", color: textMain, fontWeight: 500, fontFamily: "var(--font-dm-sans)" }}>
              Choose AI model
            </p>
            <p style={{ margin: 0, fontSize: "11px", color: textMuted, lineHeight: "1.5", fontFamily: "var(--font-dm-sans)" }}>
              {hardware
                ? "Based on your hardware, we recommend the highlighted model. You can pick a different one."
                : "Select the model that matches your available RAM."}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "4px" }}>
              {MODEL_TIERS.map((tier) => {
                const isRecommended = hardware ? recommendModel(hardware) === tier.id : false;
                const isSelected = defaultModel === tier.id;
                return (
                  <div
                    key={tier.id}
                    onClick={() => {
                      if (mainModel.status === "pulling" || mainModel.status === "done") return;
                      selectModel(tier.id);
                    }}
                    style={{
                      padding: "12px 14px", borderRadius: "8px", cursor: mainModel.status === "pulling" || mainModel.status === "done" ? "default" : "pointer",
                      border: isSelected
                        ? `1px solid ${gold}80`
                        : "1px solid rgba(255,255,255,0.06)",
                      background: isSelected
                        ? `${gold}0d`
                        : "rgba(255,255,255,0.02)",
                      transition: "all 0.15s",
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      opacity: mainModel.status === "pulling" || mainModel.status === "done" ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "12px", color: isSelected ? gold : textMain, fontFamily: "var(--font-dm-sans)", fontWeight: 500 }}>
                          {tier.name}
                        </span>
                        {isRecommended && (
                          <span style={{
                            fontSize: "9px", color: gold, fontFamily: "var(--font-dm-sans)",
                            padding: "1px 6px", borderRadius: "4px",
                            background: `${gold}15`, border: `1px solid ${gold}30`,
                            letterSpacing: "0.06em", textTransform: "uppercase",
                          }}>
                            Recommended
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: "10px", color: textMuted, fontFamily: "var(--font-dm-sans)" }}>
                        {tier.size} | Needs {tier.ramNeeded}+ RAM | {tier.description}
                      </span>
                    </div>
                    <div style={{
                      width: "14px", height: "14px", borderRadius: "50%",
                      border: isSelected ? `2px solid ${gold}` : "1.5px solid rgba(255,255,255,0.15)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      {isSelected && (
                        <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: gold }} />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* DB status row */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "8px", height: "8px", borderRadius: "50%",
              background: status?.dbReady ? "#4ac56e" : "#e05252",
              flexShrink: 0,
            }} />
            <span style={{ fontSize: "12px", color: textMuted }}>
              {status?.dbReady ? "Database ready" : "Database initialising..."}
            </span>
          </div>

          {/* Model cards */}
          <ModelCard
            name={defaultModel}
            size={`${MODEL_TIERS.find(t => t.id === defaultModel)?.size ?? "~4.7 GB"}  |  Main language model`}
            state={mainModel}
            onDownload={downloadMainModel}
            isLight={isLight}
            accent={gold}
          />
          <ModelCard
            name={embeddingModel}
            size="~274 MB  |  Document search and retrieval"
            state={embedModel}
            onDownload={downloadEmbedModel}
            isLight={isLight}
            accent={gold}
          />

          {/* Vector store */}
          <ModelCard
            name="Legal Knowledge Base"
            size={lawPackLabel}
            state={{
              status: vectorSync === "syncing" ? "pulling" : vectorSync === "error" ? "error" : vectorSync === "done" ? "done" : "idle",
              label: "Legal Knowledge Base",
              total: 0, completed: 0,
              currentStatus: vectorSync === "syncing" ? "Downloading..." : "",
              error: vectorError || undefined,
            }}
            onDownload={downloadVectors}
            isLight={isLight}
            accent={gold}
          />

          {/* Action buttons */}
          {anyPending && !anyPulling && (
            <button
              onClick={downloadAll}
              disabled={anyPulling}
              style={{
                width: "100%", padding: "11px",
                borderRadius: "8px",
                border: `1px solid ${gold}4d`,
                background: `${gold}12`,
                color: gold,
                fontFamily: "var(--font-dm-sans)", fontSize: "12px",
                fontWeight: 500, letterSpacing: "0.06em",
                cursor: "pointer",
                textTransform: "uppercase" as const,
              }}
            >
              Download All
            </button>
          )}

          {anyPulling && (
            <p style={{ margin: 0, fontSize: "11px", color: textMuted, textAlign: "center" }}>
              Downloading from local Ollama at 127.0.0.1:11434 ...
            </p>
          )}

          {allReady && (
            <button
              onClick={() => { localStorage.setItem("mizan-setup-done", "1"); router.replace("/attorney/research"); }}
              style={{
                width: "100%", padding: "11px",
                borderRadius: "8px",
                border: "none",
                background: gold,
                color: "#060d1a",
                fontFamily: "var(--font-dm-sans)", fontSize: "12px",
                fontWeight: 500, letterSpacing: "0.06em",
                cursor: "pointer",
                textTransform: "uppercase" as const,
              }}
            >
              Open Mizan
            </button>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: "10px", color: textMuted, margin: 0, letterSpacing: "0.04em" }}>
          All processing is local. Nothing is sent to external servers.
        </p>
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
