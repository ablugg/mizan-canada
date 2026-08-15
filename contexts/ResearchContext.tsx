"use client";

import { createContext, useContext, useRef, useState, useCallback } from "react";
import { Message } from "@/types";

type ResearchContextValue = {
  messages: Message[];
  isStreaming: boolean;
  sendMessage: (content: string) => void;
  stopStreaming: () => void;
  reset: () => void;
  restoreMessages: (msgs: Message[]) => void;
};

const ResearchContext = createContext<ResearchContextValue | null>(null);

export function useResearch() {
  const ctx = useContext(ResearchContext);
  if (!ctx) throw new Error("useResearch must be used inside ResearchProvider");
  return ctx;
}

export function ResearchProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // Keep a stable ref to current messages for use inside async callbacks
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;

  const sendMessage = useCallback(async (content: string) => {
    if (!content.trim() || isStreaming) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    const aiId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: aiId, role: "assistant", content: "", createdAt: new Date() },
    ]);

    try {
      abortRef.current = new AbortController();

      // Snapshot messages at time of send (excluding the new assistant placeholder)
      const history = messagesRef.current
        .filter((m) => m.id !== aiId)
        .map((m) => ({ role: m.role, content: m.content }));

      const frenchMode = typeof window !== "undefined" && localStorage.getItem("mizan-locale") === "fr";

      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: null,
          messages: [...history, { role: "user", content }],
          frenchMode,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) throw new Error("Request failed");

      if (!response.body) throw new Error("No body");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) =>
          prev.map((m) => (m.id === aiId ? { ...m, content: m.content + chunk } : m))
        );
      }
    } catch (err) {
      if (err instanceof Error && err.name !== "AbortError") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId ? { ...m, content: "Something went wrong. Please try again." } : m
          )
        );
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

  const stopStreaming = useCallback(() => abortRef.current?.abort(), []);
  const reset = useCallback(() => setMessages([]), []);
  const restoreMessages = useCallback((msgs: Message[]) => setMessages(msgs), []);

  return (
    <ResearchContext.Provider value={{ messages, isStreaming, sendMessage, stopStreaming, reset, restoreMessages }}>
      {children}
    </ResearchContext.Provider>
  );
}
