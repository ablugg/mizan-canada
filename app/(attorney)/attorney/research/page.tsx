"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Square, RotateCcw, Send, FileDown } from "lucide-react";
import { useResearch } from "@/contexts/ResearchContext";
import { SessionHistory } from "@/components/attorney/SessionHistory";
import { Message } from "@/types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function ResearchPage() {
  const { messages, isStreaming, sendMessage, stopStreaming, reset, restoreMessages } = useResearch();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const messageElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const prevStreamingRef = useRef(false);
  const isRestoredRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (suggestions.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [suggestions]);

  // Fetch follow-up suggestions when streaming ends
  useEffect(() => {
    const wasStreaming = prevStreamingRef.current;
    prevStreamingRef.current = isStreaming;

    if (wasStreaming && !isStreaming && messages.length >= 2) {
      const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastAssistant?.content || !lastUser?.content) return;

      setSuggestions([]);
      fetch("/api/attorney/research/suggestions", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userQuestion: lastUser.content,
          assistantResponse: lastAssistant.content,
          language: localStorage.getItem("mizan-locale") || "en",
        }),
      })
        .then((r) => r.json())
        .then((data) => { if (data.suggestions?.length) setSuggestions(data.suggestions); })
        .catch(() => {});
    }
  }, [isStreaming, messages]);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const val = inputRef.current?.value.trim();
    if (!val || isStreaming) return;
    setSuggestions([]);
    isRestoredRef.current = false;
    sendMessage(val);
    if (inputRef.current) { inputRef.current.value = ""; inputRef.current.style.height = "auto"; }
  }

  function handleSuggestion(q: string) {
    setSuggestions([]);
    isRestoredRef.current = false;
    sendMessage(q);
  }

  const saveSession = useCallback(async (msgs: Message[]) => {
    if (msgs.length === 0) return;
    const firstUserMsg = msgs.find((m) => m.role === "user");
    if (!firstUserMsg) return;
    const title = firstUserMsg.content.slice(0, 60);
    await fetch("/api/attorney/sessions", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "RESEARCH",
        title,
        data: { messages: msgs.map((m) => ({ id: m.id, role: m.role, content: m.content })) },
      }),
    });
    setHistoryRefresh((n) => n + 1);
  }, []);

  async function handleNewSession() {
    if (messages.length > 0 && !isRestoredRef.current) {
      await saveSession(messages);
    }
    isRestoredRef.current = false;
    setSuggestions([]);
    reset();
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

  function handleRestore(data: unknown) {
    const d = data as { messages: { id: string; role: "user" | "assistant"; content: string }[] };
    if (d?.messages) {
      const restored: Message[] = d.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: new Date(),
      }));
      isRestoredRef.current = true;
      setSuggestions([]);
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
            In-depth Q&A · Canadian Federal &amp; Provincial Law · Session saved &amp; retrievable
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
                <div key={msg.id} ref={(el) => { if (el) messageElRefs.current.set(msg.id, el); else messageElRefs.current.delete(msg.id); }}>
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
                        <div className="research-md" style={{ borderLeft: "1.5px solid rgba(201,168,76,0.22)", paddingLeft: "16px", wordBreak: "break-word" }}>
                          {msg.content ? (
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          ) : (
                            isStreaming ? <span style={{ color: "rgba(201,168,76,0.6)" }}>Researching…</span> : null
                          )}
                        </div>
                      )}
                      {/* Follow-up suggestions after last assistant message */}
                      {isLastAssistant && !isStreaming && suggestions.length > 0 && (
                        <div style={{ marginTop: "14px", paddingLeft: "16px" }}>
                          <p style={{ fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(201,168,76,0.5)", fontFamily: "var(--font-dm-sans)", marginBottom: "8px" }}>
                            Follow-up
                          </p>
                          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                            {suggestions.map((q, i) => (
                              <button
                                key={i}
                                onClick={() => handleSuggestion(q)}
                                style={{ textAlign: "left", padding: "8px 14px", borderRadius: "8px", background: "rgba(201,168,76,0.04)", border: "1px solid rgba(201,168,76,0.14)", color: "rgba(255,255,255,0.75)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", lineHeight: "1.5", transition: "all 0.15s" }}
                                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.35)"; e.currentTarget.style.color = "#ffffff"; e.currentTarget.style.background = "rgba(201,168,76,0.08)"; }}
                                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.14)"; e.currentTarget.style.color = "rgba(255,255,255,0.75)"; e.currentTarget.style.background = "rgba(201,168,76,0.04)"; }}
                              >
                                {q}
                              </button>
                            ))}
                          </div>
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
          )}
        </div>
      </div>
    </div>
  );
}
