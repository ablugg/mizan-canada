"use client";

import { useState, useRef, useCallback } from "react";
import { Send, Languages, Paperclip, Square, EyeOff, X, FileText } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLocale } from "@/contexts/LocaleContext";

interface ChatInputProps {
  onSend: (message: string, files?: File[]) => void;
  onStop?: () => void;
  onHide?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  frenchMode?: boolean;
  onFrenchToggle?: (active: boolean) => void;
}

const ACCEPTED = ".pdf,.doc,.docx,.txt";
const MAX_FILE_SIZE = 4 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatInput({ onSend, onStop, onHide, isStreaming, disabled, frenchMode, onFrenchToggle }: ChatInputProps) {
  const { t } = useLocale();
  const [value, setValue] = useState("");
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isMobile = useIsMobile();

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 160) + "px";
  }, []);

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed, stagedFiles.length ? stagedFiles : undefined);
    setValue("");
    setStagedFiles([]);
    setFileError(null);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [value, stagedFiles, disabled, onSend]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null);
    const picked = Array.from(e.target.files ?? []);
    const oversized = picked.find((f) => f.size > MAX_FILE_SIZE);
    if (oversized) {
      setFileError(`"${oversized.name}" exceeds the 4 MB limit.`);
      e.target.value = "";
      return;
    }
    setStagedFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      return [...prev, ...picked.filter((f) => !existing.has(f.name + f.size))];
    });
    e.target.value = "";
  };

  const canSend = !!value.trim() && !disabled;

  // While streaming: show only the stop button — no container, no wasted space
  if (isStreaming) {
    return (
      <div
        className="flex justify-center"
        style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))", paddingTop: "0.75rem" }}
      >
        <button
          onClick={onStop}
          className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center"
          style={{ background: "rgba(14,28,52,0.9)", border: "1px solid rgba(100,140,200,0.15)", touchAction: "manipulation" }}
        >
          <Square size={13} style={{ color: "var(--text-secondary)" }} />
        </button>
      </div>
    );
  }

  return (
    <div className="flex-shrink-0 relative z-10">
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPTED}
        multiple
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      <div
        className="px-4 pt-3 md:px-7 md:pt-5"
        style={{
          background: isMobile ? "rgba(3, 6, 14, 0.97)" : "rgba(10,18,34,0.82)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
        }}
      >
        <div
          className="absolute top-0 left-4 right-4 md:left-7 md:right-7 h-px"
          style={{ background: isMobile ? "linear-gradient(90deg, transparent, rgba(201,168,76,0.28), transparent)" : "linear-gradient(90deg, transparent, rgba(201,168,76,0.2), transparent)" }}
        />

        <div className="max-w-[720px] mx-auto">
          <div
            className="rounded-[14px] p-3.5 flex flex-col gap-3 transition-colors duration-200"
            style={{
              background: isMobile ? "rgba(5, 10, 24, 0.97)" : "rgba(10,20,40,0.75)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              border: isMobile ? "1px solid rgba(22, 58, 140, 0.28)" : "1px solid rgba(100,140,200,0.13)",
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.35)"; }}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) {
                e.currentTarget.style.borderColor = isMobile ? "rgba(22, 58, 140, 0.28)" : "rgba(100,140,200,0.13)";
              }
            }}
          >
            {/* Staged document chips */}
            {stagedFiles.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-1" style={{ borderBottom: "1px solid rgba(100,140,200,0.08)" }}>
                {stagedFiles.map((file, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px]"
                    style={{
                      background: "rgba(201,168,76,0.07)",
                      border: "1px solid rgba(201,168,76,0.2)",
                      color: "rgba(201,168,76,0.85)",
                      maxWidth: "220px",
                    }}
                  >
                    <FileText size={10} style={{ flexShrink: 0 }} />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                      {file.name}
                    </span>
                    <span style={{ color: "rgba(201,168,76,0.45)", flexShrink: 0, fontSize: "10px" }}>
                      {formatBytes(file.size)}
                    </span>
                    <button
                      onClick={() => setStagedFiles((p) => p.filter((_, j) => j !== i))}
                      style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(201,168,76,0.5)", padding: 0, flexShrink: 0, display: "flex", alignItems: "center", lineHeight: 1 }}
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {fileError && (
              <div className="text-[11px]" style={{ color: "#f0a0a0", marginTop: "-4px" }}>
                {fileError}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => { setValue(e.target.value); autoResize(); }}
              onKeyDown={handleKey}
              placeholder={stagedFiles.length > 0 ? t("chat.placeholder.doc") : t("chat.placeholder")}
              rows={1}
              disabled={disabled}
              className="bg-transparent border-none outline-none resize-none w-full font-light leading-relaxed"
              style={{
                color: "var(--text-primary)",
                minHeight: "24px",
                maxHeight: "160px",
                overflowY: "auto",
                fontFamily: "var(--font-dm-sans)",
                fontSize: "16px",
                touchAction: "manipulation",
              }}
            />

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                <button
                  onClick={() => onFrenchToggle?.(!frenchMode)}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] transition-all duration-150"
                  style={{
                    border: frenchMode ? "1px solid rgba(201,168,76,0.3)" : "1px solid rgba(100,140,200,0.15)",
                    color: frenchMode ? "var(--gold)" : "rgba(100,130,170,0.8)",
                    background: frenchMode ? "rgba(201,168,76,0.06)" : "transparent",
                    touchAction: "manipulation",
                  }}
                >
                  <Languages size={10} />
                  French
                </button>

                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] transition-all duration-150"
                  style={{
                    border: stagedFiles.length > 0 ? "1px solid rgba(201,168,76,0.3)" : "1px solid rgba(100,140,200,0.15)",
                    color: stagedFiles.length > 0 ? "rgba(201,168,76,0.8)" : "rgba(100,130,170,0.8)",
                    background: stagedFiles.length > 0 ? "rgba(201,168,76,0.06)" : "transparent",
                    touchAction: "manipulation",
                  }}
                  onMouseEnter={(e) => { if (!stagedFiles.length) e.currentTarget.style.color = "rgba(201,168,76,0.7)"; }}
                  onMouseLeave={(e) => { if (!stagedFiles.length) e.currentTarget.style.color = "rgba(100,130,170,0.8)"; }}
                >
                  <Paperclip size={10} />
                  {stagedFiles.length > 0 ? `${stagedFiles.length} ${t("chat.attached")}` : t("chat.attach")}
                </button>

                {onHide && (
                  <button
                    onClick={onHide}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] transition-all duration-150"
                    style={{
                      border: "1px solid rgba(100,140,200,0.15)",
                      color: "rgba(100,130,170,0.8)",
                      background: "transparent",
                      touchAction: "manipulation",
                    }}
                  >
                    <EyeOff size={10} />
                    Hide Chat
                  </button>
                )}
              </div>

              <button
                onClick={handleSend}
                disabled={!canSend}
                className="w-[34px] h-[34px] rounded-[9px] flex items-center justify-center transition-all duration-200 flex-shrink-0"
                style={{
                  background: canSend ? "var(--gold)" : "var(--bg-elevated)",
                  color: canSend ? "#0b0b10" : "var(--text-muted)",
                  cursor: canSend ? "pointer" : "not-allowed",
                  touchAction: "manipulation",
                }}
              >
                <Send size={13} />
              </button>
            </div>
          </div>

          <p className="text-center mt-2.5 text-[10px] tracking-wide" style={{ color: "rgba(60,80,110,0.9)" }}>
            {t("chat.disclaimer")}
          </p>
        </div>
      </div>
    </div>
  );
}
