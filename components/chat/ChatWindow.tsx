"use client";

import { useEffect, useRef, useState } from "react";
import { Message } from "@/types";
import { MessageBubble } from "./MessageBubble";
import { MizanIcon } from "@/components/ui/MizanIcon";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useLocale } from "@/contexts/LocaleContext";
import type { TranslationKey } from "@/lib/i18n";

const SUGGESTION_PROMPTS = [
  [
    "Review a commercial lease agreement under Canadian law",
    "Explain employment termination rules in Canada",
    "What are the steps to incorporate a company in Canada?",
    "Summarize PIPEDA data protection obligations in Canada",
  ],
  [
    "What are my options if a contractor breaches an agreement under Canadian law?",
    "How do I register a trademark in Canada?",
    "Explain the process of transferring property ownership in Canada",
    "What are the legal requirements for obtaining permanent residency in Canada?",
  ],
  [
    "What are the corporate governance requirements for Canadian corporations?",
    "Summarize OSFI's key regulations for financial institutions in Canada",
    "What consumer protection rights exist under Canadian law?",
    "How does commercial arbitration work in Canada?",
  ],
];

const SUGGESTION_KEYS: [TranslationKey, TranslationKey][][] = [
  [
    ["chat.s1.title", "chat.s1.sub"],
    ["chat.s2.title", "chat.s2.sub"],
    ["chat.s3.title", "chat.s3.sub"],
    ["chat.s4.title", "chat.s4.sub"],
  ],
  [
    ["chat.s5.title", "chat.s5.sub"],
    ["chat.s6.title", "chat.s6.sub"],
    ["chat.s7.title", "chat.s7.sub"],
    ["chat.s8.title", "chat.s8.sub"],
  ],
  [
    ["chat.s9.title", "chat.s9.sub"],
    ["chat.s10.title", "chat.s10.sub"],
    ["chat.s11.title", "chat.s11.sub"],
    ["chat.s12.title", "chat.s12.sub"],
  ],
];

interface ChatWindowProps {
  messages: Message[];
  isStreaming: boolean;
  isLoading: boolean;
  onSuggestion: (text: string) => void;
  onScroll?: (scrolling: boolean) => void;
}

// True if the scroll container div is not doing the scrolling (mobile uses window scroll)
function isMobileLayout(el: HTMLDivElement) {
  return el.scrollHeight <= el.clientHeight + 2;
}

function scrollToBottom(el: HTMLDivElement) {
  if (isMobileLayout(el)) {
    window.scrollTo(0, document.documentElement.scrollHeight);
  } else {
    el.scrollTop = el.scrollHeight;
  }
}

export function ChatWindow({ messages, isStreaming, isLoading, onSuggestion, onScroll }: ChatWindowProps) {
  const { t } = useLocale();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const prevIsStreamingRef = useRef(false);
  const prevIsLoadingRef = useRef(isLoading);
  const isStreamingRef = useRef(isStreaming);
  const [activeSet, setActiveSet] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMobile = useIsMobile();

  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);

  const startInterval = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      setActiveSet((prev) => (prev + 1) % SUGGESTION_KEYS.length);
    }, 5000);
  };

  useEffect(() => {
    if (messages.length > 0) return;
    startInterval();
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [messages.length]);

  // Scroll to bottom when conversation history first loads
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    if (prevIsLoadingRef.current && !isLoading && messages.length > 0) {
      scrollToBottom(el);
    }
    prevIsLoadingRef.current = isLoading;
  }, [isLoading, messages.length]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    // Reset scroll lock when new streaming begins
    if (!prevIsStreamingRef.current && isStreaming) {
      userScrolledUpRef.current = false;
    }

    if (isStreaming) {
      if (!userScrolledUpRef.current) {
        scrollToBottom(el);
      }
    } else if (prevIsStreamingRef.current && !isStreaming) {
      userScrolledUpRef.current = false;
      const mobile = isMobileLayout(el);
      const distanceFromBottom = mobile
        ? document.documentElement.scrollHeight - window.scrollY - window.innerHeight
        : el.scrollHeight - el.scrollTop - el.clientHeight;
      if (distanceFromBottom <= 150) scrollToBottom(el);
    }

    prevIsStreamingRef.current = isStreaming;
  }, [messages, isStreaming]);

  // Window scroll listener for mobile layout
  useEffect(() => {
    if (messages.length === 0) return;
    function onWinScroll() {
      const el = scrollContainerRef.current;
      if (!el || !isMobileLayout(el)) return;
      if (isStreamingRef.current) {
        const dist = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
        userScrolledUpRef.current = dist > 80;
      }
      onScroll?.(true);
    }
    window.addEventListener("scroll", onWinScroll, { passive: true });
    return () => window.removeEventListener("scroll", onWinScroll);
  }, [messages.length, onScroll]);

  if (isLoading) {
    return <div className="flex-1" />;
  }

  if (messages.length === 0) {
    return (
      <div className="md:flex-1 md:overflow-y-auto flex items-start justify-center pt-10 md:pt-20 px-4 md:px-7 relative z-1 min-h-[calc(100svh-128px)] md:min-h-0">
        <div className="text-center max-w-[480px] w-full" style={{ animation: "fadeUp 0.5s ease both" }}>
          <div className="flex justify-center mb-5 md:mb-7">
            <MizanIcon size={80} withBackground />
          </div>
          <h2
            className="font-light mb-3"
            style={{
              fontFamily: "var(--font-cormorant), serif",
              color: "var(--text-primary)",
              fontSize: "clamp(26px, 5vw, 34px)",
              letterSpacing: "0.03em",
            }}
          >
            {t("chat.welcome")}
          </h2>
          <p
            className="text-sm mb-9 leading-relaxed mx-auto"
            style={{
              color: "rgba(120,138,175,0.8)",
              maxWidth: "400px",
            }}
          >
            {t("chat.welcome.sub")}
          </p>

          <div
            key={activeSet}
            className="grid grid-cols-2 gap-2 text-left"
            style={{ animation: "fadeUp 0.4s ease both" }}
          >
            {SUGGESTION_KEYS[activeSet].map(([titleKey, subKey], idx) => (
              <button
                key={titleKey}
                onClick={() => onSuggestion(SUGGESTION_PROMPTS[activeSet][idx])}
                className="text-left transition-all duration-150 cursor-pointer"
                style={{
                  background: isMobile ? "rgba(5, 11, 26, 0.94)" : "rgba(14,26,50,0.7)",
                  border: isMobile ? "1px solid rgba(18, 52, 130, 0.36)" : "1px solid rgba(100,140,200,0.12)",
                  borderRadius: "12px",
                  padding: "12px 14px",
                  minHeight: "62px",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = isMobile ? "rgba(8, 18, 48, 0.97)" : "rgba(22,38,68,0.8)";
                  e.currentTarget.style.borderColor = "rgba(201,168,76,0.2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = isMobile ? "rgba(5, 11, 26, 0.94)" : "rgba(14,26,50,0.7)";
                  e.currentTarget.style.borderColor = isMobile ? "rgba(18, 52, 130, 0.36)" : "rgba(100,140,200,0.12)";
                }}
              >
                <div
                  className="font-normal mb-1 leading-snug"
                  style={{ fontSize: "13px", color: "#d4dcea" }}
                >
                  {t(titleKey)}
                </div>
                <div
                  style={{ fontSize: "11px", color: "rgba(100,130,175,0.8)" }}
                >
                  {t(subKey)}
                </div>
              </button>
            ))}
          </div>

          {/* Dot navigation */}
          <div className="flex items-center justify-center gap-2 mt-5">
            {SUGGESTION_KEYS.map((_, i) => (
              <button
                key={i}
                onClick={() => { setActiveSet(i); startInterval(); }}
                style={{
                  width: i === activeSet ? "18px" : "5px",
                  height: "5px",
                  borderRadius: "999px",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  background: i === activeSet ? "rgba(201,168,76,0.7)" : "rgba(255,255,255,0.15)",
                  transition: "all 0.25s ease",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollContainerRef}
      className="md:flex-1 md:overflow-y-auto py-12 relative z-1"
      style={{ scrollbarWidth: "thin", scrollbarColor: "var(--bg-elevated) transparent", overscrollBehaviorY: "contain" }}
      onScroll={() => {
        // Only fires on desktop (mobile uses window scroll)
        const el = scrollContainerRef.current;
        if (el && isStreaming && !isMobileLayout(el)) {
          const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
          userScrolledUpRef.current = distanceFromBottom > 80;
        }
        onScroll?.(true);
      }}
    >
      <div className="max-w-[720px] mx-auto px-4 md:px-7 flex flex-col gap-8 md:gap-10">
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
          />
        ))}
      </div>
    </div>
  );
}
