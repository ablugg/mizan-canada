"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Clock, Trash2, RotateCcw, X, History, Bookmark, BookmarkCheck } from "lucide-react";

interface SessionMeta {
  id: string;
  tool: string;
  title: string;
  preview?: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  tool: "RESEARCH" | "REVIEW" | "DRAFT" | "REDLINE";
  onRestore: (data: unknown, sessionId?: string) => void;
  refreshTrigger?: number; // increment to force re-fetch
}

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(dateStr).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function SessionHistory({ tool, onRestore, refreshTrigger }: Props) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/attorney/sessions?tool=${tool}`, { credentials: "include" });
      const data = await res.json();
      setSessions(data.sessions ?? []);
    } finally {
      setLoading(false);
    }
  }, [tool]);

  useEffect(() => {
    if (open) fetchSessions();
  }, [open, fetchSessions]);

  useEffect(() => {
    if (refreshTrigger && refreshTrigger > 0) fetchSessions();
  }, [refreshTrigger, fetchSessions]);

  async function restore(id: string) {
    setRestoring(id);
    try {
      const res = await fetch(`/api/attorney/sessions/${id}`, { credentials: "include" });
      const { session } = await res.json();
      if (session) {
        onRestore(session.data, id);
        setOpen(false);
      }
    } finally {
      setRestoring(null);
    }
  }

  async function deleteSession(id: string) {
    await fetch(`/api/attorney/sessions?id=${id}`, { method: "DELETE", credentials: "include" });
    setSessions((prev) => prev.filter((s) => s.id !== id));
  }

  async function togglePin(id: string, currentlyPinned: boolean) {
    const pinned = !currentlyPinned;
    await fetch("/api/attorney/sessions", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, pinned }),
    });
    setSessions((prev) =>
      prev.map((s) => s.id === id ? { ...s, pinned } : s)
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
    );
  }

  const TOOL_LABELS: Record<string, string> = {
    RESEARCH: "Research",
    REVIEW: "Review",
    DRAFT: "Draft",
    REDLINE: "Redline",
  };

  const overlay = typeof document !== "undefined" ? createPortal(
    <>
      {/* Backdrop */}
      {open && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 9998, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel */}
      <div
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 9999,
          width: "340px",
          background: "linear-gradient(180deg, #08121f 0%, #060d1a 100%)",
          borderLeft: "1px solid rgba(255,255,255,0.07)",
          display: "flex", flexDirection: "column",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)",
          boxShadow: open ? "-8px 0 32px rgba(0,0,0,0.4)" : "none",
        }}
      >
        {/* Panel header */}
        <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "18px", fontWeight: 300, color: "#e8d5a0" }}>
              {TOOL_LABELS[tool]} History
            </p>
            <p style={{ fontSize: "10px", color: "rgba(140,160,190,0.55)", marginTop: "1px", fontFamily: "var(--font-dm-sans)" }}>
              {sessions.length} session{sessions.length !== 1 ? "s" : ""} · unsaved deleted after 7 days
            </p>
          </div>
          <button onClick={() => setOpen(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(180,190,210,0.4)", display: "flex", padding: "4px" }}>
            <X size={16} />
          </button>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: "auto", scrollbarWidth: "none" }}>
          {loading ? (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "15px", color: "rgba(200,210,230,0.4)", fontWeight: 300 }}>Loading…</p>
            </div>
          ) : sessions.length === 0 ? (
            <div style={{ padding: "48px 20px", textAlign: "center" }}>
              <History size={28} style={{ color: "rgba(180,190,210,0.2)", margin: "0 auto 12px" }} />
              <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "16px", color: "rgba(200,210,230,0.4)", fontWeight: 300 }}>
                No saved sessions yet
              </p>
              <p style={{ fontSize: "11px", color: "rgba(140,160,190,0.35)", marginTop: "6px", fontFamily: "var(--font-dm-sans)" }}>
                Sessions are saved automatically. Bookmark one to keep it permanently.
              </p>
            </div>
          ) : (
            <div style={{ padding: "8px 0" }}>
              {sessions.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: "12px 20px",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                    display: "flex", alignItems: "flex-start", gap: "10px",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.025)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{
                      fontFamily: "var(--font-cormorant)", fontSize: "14px", fontWeight: 400,
                      color: "rgba(220,228,240,0.9)", lineHeight: 1.35,
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {s.title}
                    </p>
                    {s.preview && (
                      <p style={{ fontSize: "10px", color: "rgba(140,160,190,0.45)", fontFamily: "var(--font-dm-sans)", marginTop: "3px", lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                        {s.preview}
                      </p>
                    )}
                    <p style={{ fontSize: "10px", color: "rgba(140,160,190,0.5)", fontFamily: "var(--font-dm-sans)", marginTop: "3px" }}>
                      {relativeTime(s.updatedAt)}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "4px", flexShrink: 0, alignItems: "center" }}>
                    <button
                      onClick={() => togglePin(s.id, s.pinned)}
                      title={s.pinned ? "Remove from saved" : "Save permanently"}
                      style={{
                        width: "28px", height: "28px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center",
                        background: s.pinned ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)",
                        border: `1px solid ${s.pinned ? "rgba(201,168,76,0.4)" : "rgba(255,255,255,0.08)"}`,
                        cursor: "pointer",
                      }}
                    >
                      {s.pinned
                        ? <BookmarkCheck size={11} style={{ color: "#c9a84c" }} />
                        : <Bookmark size={11} style={{ color: "rgba(180,190,210,0.45)" }} />
                      }
                    </button>
                    <button
                      onClick={() => restore(s.id)}
                      disabled={restoring === s.id}
                      title="Restore"
                      style={{ width: "28px", height: "28px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.18)", cursor: "pointer", opacity: restoring === s.id ? 0.5 : 1 }}
                    >
                      <RotateCcw size={11} style={{ color: "#c9a84c" }} />
                    </button>
                    <button
                      onClick={() => deleteSession(s.id)}
                      title="Delete"
                      style={{ width: "28px", height: "28px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(200,50,50,0.07)", border: "1px solid rgba(200,50,50,0.14)", cursor: "pointer" }}
                    >
                      <Trash2 size={11} style={{ color: "#e07070" }} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body
  ) : null;

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        style={{
          display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px",
          borderRadius: "8px", background: "transparent",
          border: "1px solid rgba(255,255,255,0.1)",
          color: "rgba(180,190,210,0.6)", cursor: "pointer",
          fontSize: "11px", fontFamily: "var(--font-dm-sans)", transition: "all 0.15s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)"; e.currentTarget.style.color = "rgba(201,168,76,0.8)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.1)"; e.currentTarget.style.color = "rgba(180,190,210,0.6)"; }}
      >
        <Clock size={11} /> History
      </button>
      {overlay}
    </>
  );
}
