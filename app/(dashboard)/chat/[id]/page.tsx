"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams } from "next/navigation";
import { Menu, PenLine, Sparkles } from "lucide-react";
import { ChatWindow } from "@/components/chat/ChatWindow";
import { ChatInput } from "@/components/chat/ChatInput";
import { useChat } from "@/hooks/useChat";

interface Star {
  x: number;
  y: number;
  r: number;
  baseOpacity: number;
  twinkleSpeed: number;
  twinklePhase: number;
  driftX: number;
  driftY: number;
}

function makeStar(w: number, h: number): Star {
  const r = 0.15 + Math.random() * 0.7;
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    r,
    baseOpacity: 0.25 + Math.random() * 0.6,
    twinkleSpeed: 0.0004 + Math.random() * 0.0012,
    twinklePhase: Math.random() * Math.PI * 2,
    driftX: Math.random() < 0.15 ? (Math.random() - 0.5) * 0.04 : 0,
    driftY: Math.random() < 0.15 ? (Math.random() - 0.5) * 0.02 : 0,
  };
}

export default function ChatPage() {
  const params = useParams();
  const conversationId = (params?.id as string) ?? "new";
  const [showInput, setShowInput] = useState(true);
  const [isScrolling, setIsScrolling] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [frenchMode, setFrenchMode] = useState(false);
  const [starsVisible, setStarsVisible] = useState(true);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const starsRef = useRef<Star[]>([]);
  const starsVisibleRef = useRef(true);

  const { messages, isStreaming, isLoading, sendMessage, stopStreaming } = useChat({
    conversationId,
  });

  // Keep ref in sync so the animation loop always sees latest value
  useEffect(() => {
    starsVisibleRef.current = starsVisible;
  }, [starsVisible]);

  // Listen for sidebar collapse events
  useEffect(() => {
    function handleCollapse(e: Event) {
      const collapsed = (e as CustomEvent<{ collapsed: boolean }>).detail.collapsed;
      setSidebarHidden(collapsed);
    }
    window.addEventListener("sidebar-collapsed", handleCollapse);
    return () => window.removeEventListener("sidebar-collapsed", handleCollapse);
  }, []);

  // Star canvas animation — only runs while sidebar is hidden
  useEffect(() => {
    if (!sidebarHidden) {
      cancelAnimationFrame(animRef.current);
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function resize() {
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.offsetWidth;
      const h = canvas.offsetHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx!.scale(dpr, dpr);
      starsRef.current = Array.from({ length: 110 }, () => makeStar(w, h));
    }

    resize();
    window.addEventListener("resize", resize);

    let t = 0;

    function draw() {
      if (!canvas || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (starsVisibleRef.current) {
        for (const s of starsRef.current) {
          // Gentle twinkling
          const twinkle = Math.sin(t * s.twinkleSpeed + s.twinklePhase) * 0.3;
          const opacity = Math.max(0, Math.min(1, s.baseOpacity + twinkle));

          // Drift
          s.x += s.driftX;
          s.y += s.driftY;
          if (s.x < 0) s.x = canvas.width;
          if (s.x > canvas.width) s.x = 0;
          if (s.y < 0) s.y = canvas.height;
          if (s.y > canvas.height) s.y = 0;

          // Draw star — larger ones get a soft glow
          if (s.r > 0.65) {
            const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 3);
            glow.addColorStop(0, `rgba(220,235,255,${opacity * 0.4})`);
            glow.addColorStop(1, "rgba(220,235,255,0)");
            ctx.beginPath();
            ctx.arc(s.x, s.y, s.r * 3, 0, Math.PI * 2);
            ctx.fillStyle = glow;
            ctx.fill();
          }

          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(220,235,255,${opacity})`;
          ctx.fill();
        }
      }

      t++;
      animRef.current = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animRef.current);
      window.removeEventListener("resize", resize);
    };
  }, [sidebarHidden]);

  const handleScrollChange = useCallback((scrolling: boolean) => {
    if (scrolling) {
      setIsScrolling(true);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => setIsScrolling(false), 300);
    }
  }, []);

  const uiVisible = !isScrolling;

  return (
    <div
      className="flex flex-col md:h-full relative"
      style={{
        background: sidebarHidden ? "#060d1c" : "var(--bg-base)",
        transition: "background 0.7s ease",
      }}
    >
      {/* Radial top glow */}
      <div
        className="fixed md:absolute inset-0 pointer-events-none z-0"
        style={{
          background: "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(46,109,191,0.07) 0%, transparent 65%)",
        }}
      />

      {/* Bottom vignette */}
      <div
        className="fixed md:absolute inset-0 pointer-events-none z-0"
        style={{
          background: "linear-gradient(to top, rgba(10,20,38,0.3) 0%, transparent 20%)",
        }}
      />

      {/* Star canvas — only mounted when sidebar is hidden */}
      {sidebarHidden && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none"
          style={{
            width: "100%",
            height: "100%",
            zIndex: 1,
            opacity: starsVisible ? 1 : 0,
            transition: "opacity 0.6s ease",
          }}
        />
      )}

      {/* Mobile header bar — sticky so it stays at top during window scroll */}
      <div
        className="md:hidden flex-shrink-0 sticky top-0 flex items-center justify-between px-4 z-20"
        style={{
          height: "48px",
          background: "rgba(3, 6, 14, 0.97)",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
          borderBottom: "1px solid rgba(201,168,76,0.1)",
        }}
      >
        <button
          className="w-8 h-8 rounded-[7px] flex items-center justify-center flex-shrink-0"
          style={{
            border: "1px solid var(--border)",
            color: "var(--text-muted)",
            background: "rgba(255,255,255,0.04)",
          }}
          onClick={() => window.dispatchEvent(new CustomEvent("toggle-sidebar"))}
        >
          <Menu size={15} />
        </button>

        <span
          style={{
            fontFamily: "var(--font-cormorant)",
            fontSize: "17px",
            fontWeight: 300,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#c9a84c",
          }}
        >
          Mizan
        </span>

        {/* Right spacer to keep title centred */}
        <div className="w-8" />
      </div>

      {/* Stars toggle — top-right, only shown when sidebar is hidden */}
      {sidebarHidden && (
        <button
          className="absolute top-3 right-4 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[11px] transition-all duration-200"
          style={{
            background: starsVisible ? "rgba(201,168,76,0.08)" : "rgba(10,18,34,0.6)",
            border: starsVisible
              ? "1px solid rgba(201,168,76,0.22)"
              : "1px solid rgba(100,140,200,0.12)",
            color: starsVisible ? "rgba(201,168,76,0.75)" : "rgba(100,130,170,0.6)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            opacity: uiVisible ? 1 : 0,
            pointerEvents: uiVisible ? "auto" : "none",
            fontFamily: "var(--font-dm-sans)",
            letterSpacing: "0.04em",
          }}
          onClick={() => setStarsVisible((v) => !v)}
        >
          <Sparkles size={10} />
          {starsVisible ? "Hide stars" : "Show stars"}
        </button>
      )}

      {/* Messages */}
      <ChatWindow
        messages={messages}
        isStreaming={isStreaming}
        isLoading={isLoading}
        onSuggestion={sendMessage}
        onScroll={handleScrollChange}
      />

      {/* Show Chat pill */}
      {!showInput && !isStreaming && (
        <div
          className="fixed md:absolute bottom-0 left-0 right-0 flex justify-end z-30 px-4 md:px-7"
          style={{
            paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
            opacity: uiVisible ? 1 : 0,
            transition: uiVisible ? "opacity 0.2s ease" : "opacity 0.3s ease",
            pointerEvents: uiVisible ? "auto" : "none",
          }}
        >
          <button
            onClick={() => setShowInput(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px]"
            style={{
              background: "rgba(10,18,34,0.8)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              border: "1px solid var(--border)",
              color: "var(--text-muted)",
              touchAction: "manipulation",
            }}
          >
            <PenLine size={11} />
            Show Chat
          </button>
        </div>
      )}

      {/* Input — sticky on mobile so it stays at bottom during window scroll */}
      <div
        className="flex-shrink-0 sticky bottom-0 z-10"
        style={{
          display: showInput || isStreaming ? undefined : "none",
        }}
      >
        <ChatInput
          onSend={(msg, files) => { setShowInput(true); sendMessage(msg, files, frenchMode); }}
          onStop={stopStreaming}
          onHide={messages.length > 0 ? () => setShowInput(false) : undefined}
          isStreaming={isStreaming}
          frenchMode={frenchMode}
          onFrenchToggle={setFrenchMode}
        />
      </div>
    </div>
  );
}
