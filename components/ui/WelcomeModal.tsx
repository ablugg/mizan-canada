"use client";

import { useEffect, useState } from "react";
import { MizanIcon } from "./MizanIcon";

const STORAGE_KEY = "mizan_welcome_seen";

function ShieldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2L3 6v6c0 5.25 3.75 10.15 9 11.35C17.25 22.15 21 17.25 21 12V6L12 2z"
        fill="rgba(201,168,76,0.15)"
        stroke="rgba(201,168,76,0.7)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M9 12l2 2 4-4"
        stroke="rgba(201,168,76,0.9)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DocumentIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8L14 2z"
        fill="rgba(201,168,76,0.12)"
        stroke="rgba(201,168,76,0.7)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M14 2v6h6" stroke="rgba(201,168,76,0.6)" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="8" y1="13" x2="16" y2="13" stroke="rgba(201,168,76,0.5)" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="8" y1="17" x2="13" y2="17" stroke="rgba(201,168,76,0.5)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function LanguageIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill="rgba(201,168,76,0.1)" stroke="rgba(201,168,76,0.7)" strokeWidth="1.4" />
      <path
        d="M12 3c-2.4 2.6-3.8 5.7-3.8 9s1.4 6.4 3.8 9"
        stroke="rgba(201,168,76,0.6)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M12 3c2.4 2.6 3.8 5.7 3.8 9s-1.4 6.4-3.8 9"
        stroke="rgba(201,168,76,0.6)"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <line x1="3" y1="12" x2="21" y2="12" stroke="rgba(201,168,76,0.5)" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

const FEATURES = [
  {
    icon: <ShieldIcon />,
    title: "0 Bytes Leave Your Device",
    body: "Every message is processed entirely on your machine. No data is sent to any server, cloud, or third party. Your conversations, documents, and client information stay completely private.",
  },
  {
    icon: <DocumentIcon />,
    title: "Canadian Law Document Review",
    body: "Upload contracts, agreements, or legal documents for analysis grounded in Canadian law: PIPEDA, Canada Labour Code, Canada Business Corporations Act, and more. All document content is processed locally so your client information never leaves your device.",
  },
  {
    icon: <LanguageIcon />,
    title: "French & English",
    body: "Mizan understands and responds fluently in both French and English. Simply write in whichever language you prefer and Mizan will reply in kind.",
  },
];

export function WelcomeModal() {
  const [visible, setVisible] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      // localStorage unavailable (SSR or privacy mode) — skip
    }
  }, []);

  function dismiss() {
    setClosing(true);
    setTimeout(() => {
      setVisible(false);
      try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* ignore */ }
    }, 280);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-3 py-4 md:px-4"
      style={{
        background: "rgba(5, 12, 28, 0.75)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        animation: closing ? "fadeOut 0.28s ease forwards" : "fadeIn 0.3s ease both",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) dismiss(); }}
    >
      <div
        className="w-full max-w-[760px] relative"
        style={{
          background: "linear-gradient(160deg, rgba(12,22,46,0.98) 0%, rgba(8,15,34,0.98) 100%)",
          border: "1px solid rgba(201,168,76,0.22)",
          borderRadius: "20px",
          boxShadow: "0 0 60px rgba(201,168,76,0.06), 0 24px 80px rgba(0,0,0,0.7)",
          animation: closing ? "slideDown 0.28s ease forwards" : "slideUp 0.35s cubic-bezier(0.22,1,0.36,1) both",
          padding: "clamp(20px, 5vw, 44px)",
          maxHeight: "90dvh",
          overflowY: "auto",
        }}
      >
        {/* Subtle top glow */}
        <div
          className="absolute inset-x-0 top-0 pointer-events-none"
          style={{
            height: "1px",
            background: "linear-gradient(90deg, transparent 0%, rgba(201,168,76,0.35) 50%, transparent 100%)",
            borderRadius: "20px 20px 0 0",
          }}
        />

        {/* Header */}
        <div className="flex flex-col items-center text-center mb-5 md:mb-8">
          <div className="mb-3">
            <MizanIcon size={48} withBackground />
          </div>
          <h2
            style={{
              fontFamily: "var(--font-cormorant), serif",
              fontSize: "clamp(20px, 4vw, 30px)",
              fontWeight: 300,
              color: "#e8dfc8",
              letterSpacing: "0.06em",
              marginBottom: "6px",
            }}
          >
            Welcome to Mizan
          </h2>
          <p
            style={{
              fontSize: "13px",
              color: "rgba(140,165,210,0.75)",
              maxWidth: "420px",
              lineHeight: 1.5,
              fontFamily: "var(--font-dm-sans)",
            }}
          >
            Your private AI legal assistant for Canadian law — here is what makes Mizan different.
          </p>
        </div>

        {/* 3-column feature grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 md:gap-4 mb-5 md:mb-8">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="flex md:flex-col md:items-center md:text-center items-start"
              style={{
                background: "rgba(10,20,44,0.6)",
                border: "1px solid rgba(201,168,76,0.1)",
                borderRadius: "14px",
                padding: "14px 16px",
                gap: "12px",
              }}
            >
              <div
                style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "10px",
                  background: "rgba(201,168,76,0.06)",
                  border: "1px solid rgba(201,168,76,0.14)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {f.icon}
              </div>
              <div className="flex-1">
                <div
                  style={{
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "rgba(201,168,76,0.9)",
                    marginBottom: "5px",
                    letterSpacing: "0.02em",
                    fontFamily: "var(--font-dm-sans)",
                  }}
                >
                  {f.title}
                </div>
                <div
                  style={{
                    fontSize: "12px",
                    color: "rgba(180,200,235,0.7)",
                    lineHeight: 1.6,
                    fontFamily: "var(--font-dm-sans)",
                    whiteSpace: "pre-line",
                  }}
                >
                  {f.body}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="flex justify-center">
          <button
            onClick={dismiss}
            style={{
              background: "linear-gradient(135deg, rgba(201,168,76,0.18) 0%, rgba(201,168,76,0.1) 100%)",
              border: "1px solid rgba(201,168,76,0.35)",
              borderRadius: "10px",
              padding: "11px 36px",
              color: "rgba(201,168,76,0.95)",
              fontSize: "13px",
              fontFamily: "var(--font-dm-sans)",
              letterSpacing: "0.06em",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(201,168,76,0.26) 0%, rgba(201,168,76,0.16) 100%)";
              e.currentTarget.style.borderColor = "rgba(201,168,76,0.55)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "linear-gradient(135deg, rgba(201,168,76,0.18) 0%, rgba(201,168,76,0.1) 100%)";
              e.currentTarget.style.borderColor = "rgba(201,168,76,0.35)";
            }}
          >
            Get Started
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes fadeOut { from { opacity: 1 } to { opacity: 0 } }
        @keyframes slideUp   { from { opacity: 0; transform: translateY(18px) scale(0.98) } to { opacity: 1; transform: translateY(0) scale(1) } }
        @keyframes slideDown { from { opacity: 1; transform: translateY(0) scale(1) } to { opacity: 0; transform: translateY(12px) scale(0.98) } }
      `}</style>
    </div>
  );
}
