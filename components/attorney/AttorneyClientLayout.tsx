"use client";

import { useEffect, useState } from "react";
import { DocTaskProvider } from "@/contexts/DocTaskContext";
import { ResearchProvider } from "@/contexts/ResearchContext";
import { TaskNotificationBar } from "@/components/attorney/TaskNotificationBar";
import { JurisdictionProvider } from "@/contexts/JurisdictionContext";

// CSS injected when light mode is active.
// Uses Tailwind class selectors for page/layout backgrounds and style-attribute
// substring matching for text/card colours. !important overrides inline styles.
// Each rule is paired with the un-spaced variant for browser normalisation safety.
const LIGHT_CSS = `
/* -- Page & layout backgrounds -- */
body.atty-light [class*="md:inset-0"]          { background: #fafaf7 !important; }
body.atty-light .min-w-0.overflow-hidden > div { background: #fafaf7 !important; }

/* -- Card / input / textarea backgrounds -- */
body.atty-light [style*="4, 8, 20"],   body.atty-light [style*="4,8,20"]   { background: rgba(238,233,222,0.92) !important; }
body.atty-light [style*="5, 10, 24"],  body.atty-light [style*="5,10,24"]  { background: rgba(238,233,222,0.92) !important; }
body.atty-light [style*="3, 6, 14"],   body.atty-light [style*="3,6,14"]   { background: rgba(238,233,222,0.92) !important; }
body.atty-light [style*="8, 18, 35"],  body.atty-light [style*="8,18,35"]  { background: rgba(235,230,218,0.9)  !important; }
body.atty-light [style*="5, 12, 30"],  body.atty-light [style*="5,12,30"]  { background: rgba(235,230,218,0.9)  !important; }
body.atty-light [style*="12, 22, 40"], body.atty-light [style*="12,22,40"] { background: #f0ece2               !important; }
body.atty-light [style*="255, 255, 255, 0.02"], body.atty-light [style*="255,255,255,0.02"] { background: rgba(0,0,0,0.025) !important; }
body.atty-light [style*="255, 255, 255, 0.03"], body.atty-light [style*="255,255,255,0.03"] { background: rgba(0,0,0,0.03)  !important; }
body.atty-light [style*="255, 255, 255, 0.04"], body.atty-light [style*="255,255,255,0.04"] { background: rgba(0,0,0,0.035) !important; }
body.atty-light [style*="255, 255, 255, 0.05"], body.atty-light [style*="255,255,255,0.05"] { background: rgba(0,0,0,0.04)  !important; }

/* -- Heading / title text -- */
body.atty-light [style*="232, 213, 160"], body.atty-light [style*="232,213,160"] { color: #6b500e !important; }
body.atty-light [style*="232, 208, 157"], body.atty-light [style*="232,208,157"] { color: #6b500e !important; }
/* Gold accent (c9a84c / rgba(201,168,76,*)) */
body.atty-light [style*="201, 168, 76"],  body.atty-light [style*="201,168,76"]  { color: #7a5410 !important; }
body.atty-light [style*="232, 201, 109"], body.atty-light [style*="232,201,109"] { color: #7a5410 !important; }
body.atty-light [style*="201, 168, 76"],  body.atty-light [style*="201,168,76"]  { color: #7a5410 !important; }
body.atty-light [style*="212, 180, 76"],  body.atty-light [style*="212,180,76"]  { color: #7a5410 !important; }

/* -- Body text (#d4dcea, #dde4f0, and rgba variants) -- */
body.atty-light [style*="212, 220, 234"], body.atty-light [style*="212,220,234"] { color: rgba(28,34,52,0.92) !important; }
body.atty-light [style*="221, 228, 240"], body.atty-light [style*="221,228,240"] { color: rgba(28,34,52,0.92) !important; }
body.atty-light [style*="220, 225, 235"], body.atty-light [style*="220,225,235"] { color: rgba(26,33,52,0.88) !important; }
body.atty-light [style*="210, 220, 235"], body.atty-light [style*="210,220,235"] { color: rgba(30,38,58,0.86) !important; }
body.atty-light [style*="200, 210, 230"], body.atty-light [style*="200,210,230"] { color: rgba(36,48,70,0.82) !important; }
body.atty-light [style*="208, 216, 230"], body.atty-light [style*="208,216,230"] { color: rgba(36,48,70,0.82) !important; }

/* -- Muted label text -- */
body.atty-light [style*="180, 195, 220"], body.atty-light [style*="180,195,220"] { color: rgba(46,56,80,0.74) !important; }
body.atty-light [style*="180, 190, 210"], body.atty-light [style*="180,190,210"] { color: rgba(46,54,78,0.72) !important; }
body.atty-light [style*="140, 160, 190"], body.atty-light [style*="140,160,190"] { color: rgba(50,60,86,0.80) !important; }
body.atty-light [style*="140, 155, 180"], body.atty-light [style*="140,155,180"] { color: rgba(50,60,84,0.76) !important; }

/* -- White text (buttons, labels, nav) -- */
body.atty-light [style*="255, 255, 255, 0.9"],  body.atty-light [style*="255,255,255,0.9"]  { color: rgba(28,34,52,0.92) !important; }
body.atty-light [style*="255, 255, 255, 0.8"],  body.atty-light [style*="255,255,255,0.8"]  { color: rgba(28,34,52,0.88) !important; }
body.atty-light [style*="255, 255, 255, 0.7"],  body.atty-light [style*="255,255,255,0.7"]  { color: rgba(0,0,0,0.62) !important; }
body.atty-light [style*="255, 255, 255, 0.65"], body.atty-light [style*="255,255,255,0.65"] { color: rgba(0,0,0,0.58) !important; }
body.atty-light [style*="255, 255, 255, 0.6"],  body.atty-light [style*="255,255,255,0.6"]  { color: rgba(0,0,0,0.55) !important; }
body.atty-light [style*="255, 255, 255, 0.5"],  body.atty-light [style*="255,255,255,0.5"]  { color: rgba(0,0,0,0.50) !important; }
body.atty-light [style*="255, 255, 255, 0.4"],  body.atty-light [style*="255,255,255,0.4"]  { color: rgba(0,0,0,0.42) !important; }
body.atty-light [style*="255, 255, 255, 0.3"],  body.atty-light [style*="255,255,255,0.3"]  { color: rgba(0,0,0,0.36) !important; }
body.atty-light [style*="255, 255, 255, 0.25"], body.atty-light [style*="255,255,255,0.25"] { color: rgba(0,0,0,0.30) !important; }
/* Pure #ffffff and rgb(255,255,255) -- catches hardcoded white inline styles */
body.atty-light [style*="color:#ffffff"],
body.atty-light [style*="color: #ffffff"],
body.atty-light [style*="color: rgb(255, 255, 255)"],
body.atty-light [style*="color:rgb(255, 255, 255)"] { color: rgba(28,34,52,0.92) !important; }
/* Additional near-white body text variants */
body.atty-light [style*="220, 228, 242"], body.atty-light [style*="220,228,242"] { color: rgba(28,34,52,0.88) !important; }

/* -- Green accents -- darken for white bg -- */
body.atty-light [style*="74, 197, 110"],  body.atty-light [style*="74,197,110"]  { color: rgba(18,110,50,0.9) !important; }
body.atty-light [style*="107, 201, 138"], body.atty-light [style*="107,201,138"] { color: rgba(18,110,50,0.9) !important; }

/* -- Coloured type badges (deadline, clause status) -- */
body.atty-light [style*="130, 180, 255"], body.atty-light [style*="130,180,255"] { color: rgba(18,75,185,0.9) !important; }
body.atty-light [style*="100, 160, 255"], body.atty-light [style*="100,160,255"] { color: rgba(18,75,185,0.85) !important; }
body.atty-light [style*="180, 120, 255"], body.atty-light [style*="180,120,255"] { color: rgba(95,35,195,0.85) !important; }

/* -- Textarea / input placeholder -- */
body.atty-light textarea::placeholder,
body.atty-light input::placeholder { color: rgba(60,70,95,0.45) !important; }

/* -- Textarea / input text (catch-all for elements inside cream cards) -- */
body.atty-light textarea,
body.atty-light input[type="text"],
body.atty-light input:not([type]) { color: rgba(28,34,52,0.92) !important; }

/* -- Border overrides -- */
body.atty-light [style*="255, 255, 255, 0.06"],  body.atty-light [style*="255,255,255,0.06"]  { border-color: rgba(0,0,0,0.09)  !important; }
body.atty-light [style*="255, 255, 255, 0.07"],  body.atty-light [style*="255,255,255,0.07"]  { border-color: rgba(0,0,0,0.09)  !important; }
body.atty-light [style*="255, 255, 255, 0.08"],  body.atty-light [style*="255,255,255,0.08"]  { border-color: rgba(0,0,0,0.10)  !important; }
body.atty-light [style*="255, 255, 255, 0.1)"],  body.atty-light [style*="255,255,255,0.1)"]  { border-color: rgba(0,0,0,0.12)  !important; }
body.atty-light [style*="255, 255, 255, 0.15"],  body.atty-light [style*="255,255,255,0.15"]  { border-color: rgba(0,0,0,0.13)  !important; }
body.atty-light [style*="255, 255, 255, 0.2)"],  body.atty-light [style*="255,255,255,0.2)"]  { border-color: rgba(0,0,0,0.14)  !important; }

/* -- Scrollbar -- */
body.atty-light * { scrollbar-color: rgba(0,0,0,0.15) transparent; }

/* -- Research markdown (CSS class -- not caught by inline-style overrides) -- */
body.atty-light .research-md                { color: rgba(28,34,52,0.92); }
body.atty-light .research-md p              { color: rgba(28,34,52,0.92); }
body.atty-light .research-md h1,
body.atty-light .research-md h2             { color: #6b500e; }
body.atty-light .research-md h3             { color: #7a5410; }
body.atty-light .research-md strong         { color: rgba(18,24,42,0.95); }
body.atty-light .research-md em             { color: rgba(28,34,52,0.78); }
body.atty-light .research-md li             { color: rgba(28,34,52,0.92); }
body.atty-light .research-md code           { background: rgba(0,0,0,0.06); color: #7a5410; }
body.atty-light .research-md pre            { background: rgba(0,0,0,0.04); border-color: rgba(0,0,0,0.09); }
body.atty-light .research-md pre code       { color: rgba(28,34,52,0.88); background: none; }
body.atty-light .research-md blockquote     { border-left-color: rgba(122,84,16,0.35); color: rgba(46,56,80,0.74); }
body.atty-light .research-md hr             { border-top-color: rgba(0,0,0,0.09); }
body.atty-light .research-md td             { color: rgba(28,34,52,0.88); border-bottom-color: rgba(0,0,0,0.07); }
body.atty-light .research-md th             { color: #7a5410; border-bottom-color: rgba(122,84,16,0.3); }
body.atty-light .research-md a              { color: #7a5410; }
`;

export function AttorneyClientLayout({ children }: { children: React.ReactNode }) {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(localStorage.getItem("attorney-light-mode") === "true");
    const handler = (e: Event) => setIsLight((e as CustomEvent<{ light: boolean }>).detail.light);
    window.addEventListener("attorney-theme-change", handler);
    return () => window.removeEventListener("attorney-theme-change", handler);
  }, []);

  // Sync --mizan-page-bg CSS variable with active jurisdiction
  useEffect(() => {
    const PAGE_BG: Record<string, string> = { ca: "#060d1a" };
    function applyPageBg(j: string) {
      document.documentElement.style.setProperty("--mizan-page-bg", PAGE_BG[j] ?? PAGE_BG.ca);
    }
    const j = localStorage.getItem("mizan-jurisdiction") ?? "ca";
    applyPageBg(j);
    const handler = (e: Event) => applyPageBg((e as CustomEvent<{ jurisdiction: string }>).detail.jurisdiction);
    window.addEventListener("mizan-jurisdiction-change", handler);
    return () => window.removeEventListener("mizan-jurisdiction-change", handler);
  }, []);

  useEffect(() => {
    const id = "attorney-light-css";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (isLight) {
      if (!el) { el = document.createElement("style"); el.id = id; document.head.appendChild(el); }
      el.textContent = LIGHT_CSS;
      document.body.classList.add("atty-light");
    } else {
      el?.remove();
      document.body.classList.remove("atty-light");
    }
  }, [isLight]);

  return (
    <JurisdictionProvider>
    <DocTaskProvider>
    <ResearchProvider>
      {children}
      <TaskNotificationBar />
    </ResearchProvider>
    </DocTaskProvider>
    </JurisdictionProvider>
  );
}
