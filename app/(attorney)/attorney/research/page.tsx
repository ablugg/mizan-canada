"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Square, RotateCcw, Send, FileDown, Save, Check, AlertCircle } from "lucide-react";
import { useResearch } from "@/contexts/ResearchContext";
import { SessionHistory } from "@/components/attorney/SessionHistory";
import { Message } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const THINKING_PHRASES = [
  "Gathering the books together…",
  "Shuffling the papers…",
  "Reading every single page…",
  "Amalgamating information…",
  "Veritas super omnia…",
  "Cross-referencing case law…",
  "Consulting the authorities… just kidding",
  "Flipping through the statutes…",
  "Objection! Just kidding…",
  "Dusting off the law reports…",
  "Citing sources diligently…",
  "Checking the footnotes…",
  "Reviewing the headnotes…",
  "Stare decisis in progress…",
  "Building your argument…",
  "Briefing the bench…",
  "Sustained! One moment…",
  "Reading the fine print…",
  "Approaching the bench…",
  "Order in the court…",
  "Entering exhibit A…",
  "Res ipsa loquitur…",
  "Preparing closing arguments…",
  "Your honour, bear with me…",
  "Habeas corpus-ing the data…",
  "Filing a motion to think harder…",
  "May it please the court…",
  "Summoning the ratio decidendi…",
  "This won't be billable…",
  // Famous quotes
  "\"Justice delayed is justice denied.\" — William Gladstone",
  "\"The law is reason, free from passion.\" — Aristotle",
  "\"Injustice anywhere is a threat to justice everywhere.\" — MLK Jr.",
  "\"The life of the law has not been logic; it has been experience.\" — Oliver Wendell Holmes",
  "\"Laws are like sausages — better not to see them being made.\" — Otto von Bismarck",
  "\"The first duty of society is justice.\" — Alexander Hamilton",
  "\"Where there is a right, there is a remedy.\" — Legal Maxim",
  "\"Equity follows the law.\" — Legal Maxim",
  "\"The law must be stable, but it must not stand still.\" — Roscoe Pound",
  "\"A lawyer without history or literature is a mechanic.\" — Sir Walter Scott",
  "\"Facts are stubborn things.\" — John Adams",
  "\"In the halls of justice, the only justice is in the halls.\" — Lenny Bruce",
  "\"The good lawyer is not the man who has an eye to every side and angle of contingency.\" — Abraham Lincoln",
  "\"It is not wisdom but authority that makes a law.\" — Thomas Hobbes",
  "\"The law is not a light for you or any man to see by; the law is not an instrument of any kind.\" — Robert Bolt",
  "\"Justice is the constant and perpetual will to allot every man his due.\" — Justinian I",
  "\"Courage is the first of human qualities because it guarantees all others.\" — Aristotle",
  "\"The safety of the people shall be the highest law.\" — Cicero",
  "\"No man is above the law and no man is below it.\" — Theodore Roosevelt",
  "\"The court is the last refuge of the oppressed.\" — Legal Maxim",
];

function ThinkingMessage() {
  const [index, setIndex] = useState(() => Math.floor(Math.random() * THINKING_PHRASES.length));
  useEffect(() => {
    const interval = setInterval(() => {
      setIndex((prev) => {
        let next: number;
        do { next = Math.floor(Math.random() * THINKING_PHRASES.length); } while (next === prev);
        return next;
      });
    }, 2800);
    return () => clearInterval(interval);
  }, []);
  return (
    <span key={index} style={{ color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-cormorant)", fontStyle: "italic", fontSize: "14px", animation: "fadeIn 0.5s ease both" }}>
      {THINKING_PHRASES[index]}
    </span>
  );
}

export default function ResearchPage() {
  const { messages, isStreaming, sendMessage, stopStreaming, reset, restoreMessages } = useResearch();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messageElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [activeModel, setActiveModel] = useState("qwen3:8b");
  const [modelOpen, setModelOpen] = useState(false);
  const prevStreamingRef = useRef(false);
  const isRestoredRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const userScrolledUpRef = useRef(false);
  const programmaticScrollRef = useRef(false);

  // Track whether the user has scrolled away from the bottom.
  // Ignore scroll events caused by our own programmatic scrollIntoView.
  useEffect(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    const onScroll = () => {
      if (programmaticScrollRef.current) return;
      const distFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      userScrolledUpRef.current = distFromBottom > 80;
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    fetch("/api/setup/select-model").then(r => r.json()).then(d => {
      if (d.model) setActiveModel(d.model);
    }).catch(() => {});
  }, []);

  const scrollToBottom = useCallback(() => {
    programmaticScrollRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    // Clear the flag after the smooth scroll animation finishes
    setTimeout(() => { programmaticScrollRef.current = false; }, 500);
  }, []);

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);


  const saveSession = useCallback(async (msgs: Message[]) => {
    if (msgs.length === 0) return;
    const firstUserMsg = msgs.find((m) => m.role === "user");
    if (!firstUserMsg) return;
    const title = firstUserMsg.content.slice(0, 60);
    try {
      const res = await fetch("/api/attorney/sessions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "RESEARCH",
          title,
          data: { messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content })) },
          sessionId: sessionIdRef.current,
        }),
      });
      const result = await res.json();
      if (result.session?.id && !sessionIdRef.current) {
        sessionIdRef.current = result.session.id;
      }
    } catch {
      // Session save failed silently
    }
    setHistoryRefresh((n) => n + 1);
  }, []);

  // Fetch follow-up suggestions when streaming ends
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming && messages.length >= 2) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastAssistant?.content || !lastUser?.content) return;

      // Auto-save session after each response
      setTimeout(() => saveSession(messages), 100);

    }
  }, [isStreaming, messages, saveSession]);

  function switchModel(model: string) {
    setActiveModel(model);
    setModelOpen(false);
    fetch("/api/setup/select-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    }).catch(() => {});
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const val = inputRef.current?.value.trim();
    if (!val || isStreaming) return;

    isRestoredRef.current = false;
    userScrolledUpRef.current = false;
    sendMessage(val);
    if (inputRef.current) { inputRef.current.value = ""; inputRef.current.style.height = "auto"; }
  }


  async function handleManualSave() {
    if (messages.length === 0 || saveState === "saving") return;
    setSaveState("saving");
    try {
      await saveSession(messages);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
      setTimeout(() => setSaveState("idle"), 2500);
    }
  }

  async function handleNewSession() {
    // Save current session before clearing
    if (messages.length >= 2) {
      await saveSession(messages);
    }
    isRestoredRef.current = false;
    sessionIdRef.current = null;

    reset();
    setHistoryRefresh((n) => n + 1);
  }

  function exportTranscript() {
    if (messages.length === 0) return;
    const lines = messages.map((m) =>
      `[${m.role === "user" ? "Attorney" : "Mizan"}]\n${m.content}`
    );
    const text = `Mizan Legal Research — ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}\n${"─".repeat(60)}\n\n${lines.join("\n\n" + "─".repeat(60) + "\n\n")}`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Mizan_Research_${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleRestore(data: unknown, sessionId?: string) {
    const d = data as { messages: { id: string; role: "user" | "assistant"; content: string }[] };
    if (d?.messages) {
      const restored: Message[] = d.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: new Date(),
      }));
      isRestoredRef.current = true;
      sessionIdRef.current = sessionId ?? null;
  
      restoreMessages(restored);
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "#060d1a" }}>
      {/* Header */}
      <div style={{ padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-cormorant)", fontSize: "22px", fontWeight: 300, color: "#e8d5a0", letterSpacing: "0.04em" }}>
            Legal Research
          </h1>
          <p style={{ fontSize: "11px", color: "#ffffff", marginTop: "2px", fontFamily: "var(--font-dm-sans)" }}>
            In-depth Q&A · Federal &amp; Provincial Law · SCC Decisions · Session saved &amp; retrievable
          </p>
          <p style={{ fontSize: "10px", color: "rgba(201,168,76,0.5)", marginTop: "3px", fontFamily: "var(--font-dm-sans)" }}>
            All processing is local · 0 bytes leave your device
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <SessionHistory tool="RESEARCH" onRestore={handleRestore} refreshTrigger={historyRefresh} />
          {messages.length > 0 && (
            <>
              <button
                onClick={handleManualSave}
                disabled={saveState === "saving"}
                style={{
                  display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px",
                  borderRadius: "8px", background: "transparent",
                  border: `1px solid ${saveState === "saved" ? "rgba(80,200,120,0.4)" : saveState === "error" ? "rgba(200,80,80,0.4)" : "rgba(201,168,76,0.25)"}`,
                  color: saveState === "saved" ? "rgba(80,200,120,0.9)" : saveState === "error" ? "rgba(200,80,80,0.9)" : "rgba(201,168,76,0.8)",
                  cursor: saveState === "saving" ? "wait" : "pointer",
                  fontSize: "11px", fontFamily: "var(--font-dm-sans)", transition: "all 0.15s",
                  opacity: saveState === "saving" ? 0.6 : 1,
                }}
                onMouseEnter={(e) => { if (saveState === "idle") { e.currentTarget.style.borderColor = "rgba(201,168,76,0.5)"; e.currentTarget.style.color = "#c9a84c"; } }}
                onMouseLeave={(e) => { if (saveState === "idle") { e.currentTarget.style.borderColor = "rgba(201,168,76,0.25)"; e.currentTarget.style.color = "rgba(201,168,76,0.8)"; } }}
              >
                {saveState === "saved" ? <Check size={11} /> : saveState === "error" ? <AlertCircle size={11} /> : <Save size={11} />}
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Failed" : "Save"}
              </button>
              <button
                onClick={exportTranscript}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", cursor: "pointer", fontSize: "11px", fontFamily: "var(--font-dm-sans)", transition: "all 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.5)"; e.currentTarget.style.color = "#c9a84c"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.25)"; e.currentTarget.style.color = "rgba(201,168,76,0.8)"; }}
              >
                <FileDown size={11} /> Export
              </button>
              <button
                onClick={handleNewSession}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", cursor: "pointer", fontSize: "11px", fontFamily: "var(--font-dm-sans)", transition: "all 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.5)"; e.currentTarget.style.color = "#c9a84c"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.25)"; e.currentTarget.style.color = "rgba(201,168,76,0.8)"; }}
              >
                <RotateCcw size={11} /> New Session
              </button>
            </>
          )}
        </div>
      </div>

      {/* Messages + Checkpoints */}
      <div className="flex-1 overflow-hidden" style={{ display: "flex", flexDirection: "row" }}>
        {/* Scrollable messages column */}
        <div ref={messagesScrollRef} className="flex-1 overflow-y-auto" style={{ padding: "24px 32px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent", display: "flex", flexDirection: "column" }}>
        {messages.length === 0 ? (
          <div style={{ maxWidth: "560px", margin: "auto", width: "100%", padding: "28px 0", textAlign: "center" }}>
            <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "17px", color: "#ffffff", fontWeight: 300, lineHeight: 1.7 }}>
              Ask a legal research question. Responses are comprehensive, fully cited, and tailored for attorney-level analysis.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center", marginTop: "24px" }}>
              {[
                "What are the OSFI requirements for fintech licensing in Canada?",
                "Analyse PIPEDA obligations for data processors",
                "Compare federal and provincial arbitration procedures in Canada",
                "Enforceability of non-compete clauses under Canadian employment law",
              ].map((q) => (
                <button key={q} onClick={() => sendMessage(q)} style={{ padding: "8px 14px", borderRadius: "20px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#ffffff", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.25)"; e.currentTarget.style.color = "rgba(201,168,76,0.85)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "rgba(180,195,220,0.75)"; }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: "720px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "28px" }}>
            {messages.map((msg, idx) => {
              const isLastAssistant = msg.role === "assistant" && idx === messages.length - 1;
              return (
                <div key={msg.id} ref={(el) => { if (el) messageElRefs.current.set(msg.id, el); else messageElRefs.current.delete(msg.id); }} style={{ animation: "contentReveal 0.4s ease both" }}>
                  <div className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                    <div style={{ width: "30px", height: "30px", borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", background: msg.role === "user" ? "rgba(5,12,30,0.95)" : "rgba(8,18,35,0.9)", border: msg.role === "user" ? "1px solid rgba(22,62,158,0.44)" : "1px solid rgba(201,168,76,0.18)", color: msg.role === "user" ? "#3a62b8" : "#c9a84c", fontFamily: "var(--font-dm-sans)", fontWeight: 600 }}>
                      {msg.role === "user" ? "A" : "M"}
                    </div>
                    <div style={{ flex: 1, maxWidth: "calc(100% - 42px)" }}>
                      {msg.role === "user" ? (
                        <div style={{ background: "#f0ece2", border: "1px solid rgba(180,155,100,0.35)", borderRadius: "14px 4px 14px 14px", padding: "12px 16px", color: "#1c2034", fontSize: "14px", lineHeight: "1.65", fontWeight: 400, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {msg.content}
                        </div>
                      ) : (
                        <div className={`research-md${isLastAssistant && isStreaming ? " streaming" : ""}`} style={{ borderLeft: "1.5px solid rgba(201,168,76,0.22)", paddingLeft: "16px", wordBreak: "break-word", animation: msg.role === "assistant" ? "contentReveal 0.45s ease both" : undefined }}>
                          {msg.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{msg.content}</ReactMarkdown>
                          ) : (
                            isStreaming ? <ThinkingMessage /> : null
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
        </div>

        {/* Checkpoints panel */}
        {messages.some((m) => m.role === "user") && (
          <div style={{ width: "188px", flexShrink: 0, borderLeft: "1px solid rgba(255,255,255,0.05)", padding: "20px 12px", overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.06) transparent", display: "flex", flexDirection: "column", gap: "4px" }}>
            <p style={{ fontSize: "9px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.45)", fontFamily: "var(--font-dm-sans)", marginBottom: "10px", paddingLeft: "4px" }}>
              Questions
            </p>
            {messages.filter((m) => m.role === "user").map((m, i) => (
              <button
                key={m.id}
                onClick={() => {
                  messageElRefs.current.get(m.id)?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
                style={{ textAlign: "left", padding: "7px 8px", borderRadius: "6px", background: "transparent", border: "1px solid transparent", color: "rgba(255,255,255,0.5)", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", lineHeight: "1.45", transition: "all 0.15s", display: "flex", gap: "6px", alignItems: "flex-start" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.05)"; e.currentTarget.style.borderColor = "rgba(201,168,76,0.12)"; e.currentTarget.style.color = "rgba(255,255,255,0.85)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.color = "rgba(255,255,255,0.5)"; }}
              >
                <span style={{ color: "rgba(201,168,76,0.4)", fontSize: "10px", flexShrink: 0, marginTop: "1px", fontFamily: "var(--font-dm-sans)" }}>{i + 1}.</span>
                <span style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>{m.content}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <div style={{ flexShrink: 0, padding: "16px 32px max(20px, env(safe-area-inset-bottom))", borderTop: "1px solid rgba(255,255,255,0.06)", background: "rgba(3,6,14,0.97)" }}>
        <div style={{ maxWidth: "720px", margin: "0 auto" }}>
          {isStreaming ? (
            <div style={{ display: "flex", justifyContent: "center" }}>
              <button onClick={stopStreaming} style={{ width: "34px", height: "34px", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(14,28,52,0.9)", border: "1px solid rgba(100,140,200,0.15)", cursor: "pointer" }}>
                <Square size={13} style={{ color: "#ffffff" }} />
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <div style={{ display: "flex", gap: "10px", alignItems: "flex-end" }}>
                <textarea
                  ref={inputRef}
                  onKeyDown={handleKey}
                  onChange={(e) => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px"; }}
                  placeholder="Ask a legal research question…"
                  rows={1}
                  style={{ flex: 1, background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.28)", borderRadius: "10px", padding: "10px 14px", color: "#ffffff", fontSize: "14px", lineHeight: "1.5", resize: "none", outline: "none", fontFamily: "var(--font-dm-sans)", minHeight: "40px", maxHeight: "160px" }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.35)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.28)"; }}
                />
                <button onClick={submit} style={{ width: "40px", height: "40px", borderRadius: "9px", display: "flex", alignItems: "center", justifyContent: "center", background: "#c9a84c", border: "none", cursor: "pointer", flexShrink: 0 }}>
                  <Send size={14} style={{ color: "#0b0b10" }} />
                </button>
              </div>
              {/* Model selector */}
              <div style={{ position: "relative", alignSelf: "flex-start" }}>
                <button
                  onClick={() => setModelOpen(!modelOpen)}
                  style={{
                    display: "flex", alignItems: "center", gap: "5px",
                    padding: "3px 8px", borderRadius: "6px",
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.06)",
                    color: "rgba(140,160,190,0.6)",
                    fontSize: "10px", fontFamily: "var(--font-dm-sans)",
                    cursor: "pointer", transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.25)"; e.currentTarget.style.color = "rgba(201,168,76,0.7)"; }}
                  onMouseLeave={(e) => { if (!modelOpen) { e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)"; e.currentTarget.style.color = "rgba(140,160,190,0.6)"; } }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1" y="2" width="8" height="6" rx="1" stroke="currentColor" strokeWidth="0.9" /><path d="M3 2V1.5A0.5 0.5 0 0 1 3.5 1h3a0.5 0.5 0 0 1 .5.5V2" stroke="currentColor" strokeWidth="0.9" /></svg>
                  {activeModel}
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2 3L4 5L6 3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  {!["qwen3:8b", "qwen3:14b", "command-r"].includes(activeModel) && (
                    <span style={{ color: "rgba(201,168,76,0.4)", fontSize: "9px", marginLeft: "2px" }}>
                      Switch to 8b+ for deeper analysis
                    </span>
                  )}
                </button>
                {modelOpen && (
                  <>
                    <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setModelOpen(false)} />
                    <div style={{
                      position: "absolute", bottom: "calc(100% + 4px)", left: 0, zIndex: 50,
                      background: "rgba(10,16,30,0.98)", border: "1px solid rgba(201,168,76,0.18)",
                      borderRadius: "8px", padding: "4px", minWidth: "160px",
                      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
                    }}>
                      {[
                        { id: "qwen3:1.7b", label: "qwen3:1.7b", desc: "Quick · Simple" },
                        { id: "qwen3:4b", label: "qwen3:4b", desc: "Fast · Light" },
                        { id: "qwen3:8b", label: "qwen3:8b", desc: "Deep Reasoning" },
                        { id: "qwen3:14b", label: "qwen3:14b", desc: "Pro · Fewer Hallucinations" },
                        { id: "command-r", label: "command-r", desc: "RAG · Best Accuracy" },
                      ].map((m) => (
                        <button
                          key={m.id}
                          onClick={() => switchModel(m.id)}
                          style={{
                            width: "100%", padding: "7px 10px", borderRadius: "6px",
                            background: activeModel === m.id ? "rgba(201,168,76,0.1)" : "transparent",
                            border: "none", cursor: "pointer",
                            display: "flex", justifyContent: "space-between", alignItems: "center",
                            transition: "background 0.1s",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(201,168,76,0.08)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = activeModel === m.id ? "rgba(201,168,76,0.1)" : "transparent"; }}
                        >
                          <span style={{ fontSize: "11px", fontFamily: "var(--font-dm-sans)", color: activeModel === m.id ? "#c9a84c" : "rgba(220,228,242,0.8)" }}>
                            {m.label}
                          </span>
                          <span style={{ fontSize: "9px", fontFamily: "var(--font-dm-sans)", color: "rgba(140,160,190,0.5)" }}>
                            {m.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
