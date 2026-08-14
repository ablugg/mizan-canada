"use client";

import { createContext, useContext, useRef, useState, useCallback } from "react";
import type { DraftType } from "@/types";
import type { RedlineResult, RedlineChange, DocumentReviewResult } from "@/types";

// ---- Task shapes ----

export type DraftTask = {
  tool: "DRAFT";
  status: "pending" | "done" | "error";
  title: string;
  startedAt: number;
  content: string;
  isStreaming: boolean;
  docType: DraftType | "";
  jurisdiction: string;
  docLang: "en" | "fr";
  fields: Record<string, string>;
  error?: string;
};

export type RedlineTask = {
  tool: "REDLINE";
  status: "pending" | "done" | "error";
  title: string;
  startedAt: number;
  sessionId?: string;
  result?: RedlineResult;
  originalText?: string;
  filename?: string;
  changes?: RedlineChange[];
  error?: string;
};

export type ReviewTask = {
  tool: "REVIEW";
  status: "pending" | "done" | "error";
  title: string;
  startedAt: number;
  result?: DocumentReviewResult;
  documentName?: string;
  error?: string;
};

type Tasks = {
  DRAFT?: DraftTask;
  REDLINE?: RedlineTask;
  REVIEW?: ReviewTask;
};

type DocTaskContextValue = {
  tasks: Tasks;
  startDraft: (params: {
    docType: DraftType | "";
    jurisdiction: string;
    docLang: "en" | "fr";
    fields: Record<string, string>;
  }) => void;
  startRedline: (file: File, instruction?: string, clientPosition?: string) => void;
  startReview: (file: File) => void;
  clearTask: (tool: "DRAFT" | "REDLINE" | "REVIEW") => void;
  onTaskComplete: (tool: string, cb: () => void) => () => void;
};

const DocTaskContext = createContext<DocTaskContextValue | null>(null);

export function useDocTask() {
  const ctx = useContext(DocTaskContext);
  if (!ctx) throw new Error("useDocTask must be used inside DocTaskProvider");
  return ctx;
}

export function DocTaskProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<Tasks>({});
  const listenersRef = useRef<Record<string, Set<() => void>>>({});

  const onTaskComplete = useCallback((tool: string, cb: () => void) => {
    if (!listenersRef.current[tool]) listenersRef.current[tool] = new Set();
    listenersRef.current[tool].add(cb);
    return () => listenersRef.current[tool]?.delete(cb);
  }, []);

  function notify(tool: string) {
    listenersRef.current[tool]?.forEach((cb) => cb());
  }

  function clearTask(tool: "DRAFT" | "REDLINE" | "REVIEW") {
    setTasks((prev) => {
      const next = { ...prev };
      delete next[tool];
      return next;
    });
  }

  // ---- DRAFT ----
  function startDraft({
    docType,
    jurisdiction,
    docLang,
    fields,
  }: {
    docType: DraftType | "";
    jurisdiction: string;
    docLang: "en" | "fr";
    fields: Record<string, string>;
  }) {
    const title = `${docType} — ${jurisdiction}`;
    setTasks((prev) => ({
      ...prev,
      DRAFT: {
        tool: "DRAFT",
        status: "pending",
        title,
        startedAt: Date.now(),
        content: "",
        isStreaming: false,
        docType,
        jurisdiction,
        docLang,
        fields,
      },
    }));

    (async () => {
      try {
        const res = await fetch("/api/attorney/draft", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ docType, jurisdiction, fields, docLang }),
        });
        if (!res.ok) throw new Error("Draft generation failed");
        const data = await res.json();
        const finalContent: string = data.content ?? "";
        if (!finalContent.trim()) throw new Error("Draft generation returned empty content");

        if (finalContent.trim()) {
          await fetch("/api/attorney/sessions", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tool: "DRAFT",
              title,
              data: { content: finalContent, docType, jurisdiction, docLang, fields },
            }),
          });
        }
        setTasks((prev) => {
          const t = prev.DRAFT;
          if (!t) return prev;
          return { ...prev, DRAFT: { ...t, content: finalContent, status: "done", isStreaming: false } };
        });
        notify("DRAFT");
      } catch (err) {
        setTasks((prev) => {
          const t = prev.DRAFT;
          if (!t) return prev;
          return { ...prev, DRAFT: { ...t, status: "error", isStreaming: false, error: err instanceof Error ? err.message : "Error" } };
        });
      }
    })();
  }

  // ---- REDLINE ----
  function startRedline(file: File, instruction?: string, clientPosition = "neutral") {
    const title = `Redline: ${file.name}`;
    setTasks((prev) => ({
      ...prev,
      REDLINE: { tool: "REDLINE", status: "pending", title, startedAt: Date.now() },
    }));

    (async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        if (instruction) fd.append("reviewType", instruction);
        fd.append("clientPosition", clientPosition);
        fd.append("language", localStorage.getItem("mizan-locale") || "en");
        const res = await fetch("/api/attorney/redline", {
          method: "POST",
          body: fd,
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analysis failed");
        const initialChanges: RedlineChange[] = data.result.changes.map(
          (c: RedlineChange) => ({ ...c, accepted: undefined })
        );
        const filename = data.filename ?? file.name;
        const sessionRes = await fetch("/api/attorney/sessions", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "REDLINE",
            title,
            data: {
              result: data.result,
              originalText: data.originalText ?? "",
              filename,
              changes: initialChanges,
            },
          }),
        });
        const sessionData = await sessionRes.json();
        const sessionId: string | undefined = sessionData?.session?.id;
        setTasks((prev) => ({
          ...prev,
          REDLINE: {
            tool: "REDLINE",
            status: "done",
            title,
            startedAt: prev.REDLINE?.startedAt ?? Date.now(),
            sessionId,
            result: data.result,
            originalText: data.originalText ?? "",
            filename,
            changes: initialChanges,
          },
        }));
        notify("REDLINE");
      } catch (err) {
        setTasks((prev) => {
          const t = prev.REDLINE;
          if (!t) return prev;
          return { ...prev, REDLINE: { ...t, status: "error", error: err instanceof Error ? err.message : "Error" } };
        });
      }
    })();
  }

  // ---- REVIEW ----
  function startReview(file: File) {
    const title = file.name;
    setTasks((prev) => ({
      ...prev,
      REVIEW: { tool: "REVIEW", status: "pending", title, startedAt: Date.now() },
    }));

    (async () => {
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("language", localStorage.getItem("mizan-locale") || "en");
        const res = await fetch("/api/attorney/review", {
          method: "POST",
          body: fd,
          credentials: "include",
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Analysis failed");
        await fetch("/api/attorney/sessions", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tool: "REVIEW",
            title,
            data: { result: data.result, documentName: file.name },
          }),
        });
        setTasks((prev) => ({
          ...prev,
          REVIEW: {
            tool: "REVIEW",
            status: "done",
            title,
            startedAt: prev.REVIEW?.startedAt ?? Date.now(),
            result: data.result,
            documentName: file.name,
          },
        }));
        notify("REVIEW");
      } catch (err) {
        setTasks((prev) => {
          const t = prev.REVIEW;
          if (!t) return prev;
          return { ...prev, REVIEW: { ...t, status: "error", error: err instanceof Error ? err.message : "Error" } };
        });
      }
    })();
  }

  return (
    <DocTaskContext.Provider
      value={{ tasks, startDraft, startRedline, startReview, clearTask, onTaskComplete }}
    >
      {children}
    </DocTaskContext.Provider>
  );
}
