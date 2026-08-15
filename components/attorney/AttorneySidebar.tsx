"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search, FileSearch, FileText, Scissors, Menu, ChevronLeft, ChevronRight, Languages, BookOpen, CalendarClock, Sun, Moon, BarChart2, Globe, LibraryBig, Heart } from "lucide-react";
import { useLocale } from "@/contexts/LocaleContext";
import { useJurisdiction } from "@/contexts/JurisdictionContext";
import type { TranslationKey } from "@/lib/i18n";

const TOOL_DEFS: { href: string; labelKey: TranslationKey; subKey: TranslationKey; icon: React.ElementType }[] = [
  { href: "/attorney/research", labelKey: "attorney.research", subKey: "attorney.research.sub", icon: Search },
  { href: "/attorney/review", labelKey: "attorney.review", subKey: "attorney.review.sub", icon: FileSearch },
  { href: "/attorney/draft", labelKey: "attorney.draft", subKey: "attorney.draft.sub", icon: FileText },
  { href: "/attorney/redline", labelKey: "attorney.redline", subKey: "attorney.redline.sub", icon: Scissors },
  { href: "/attorney/translate", labelKey: "attorney.translate", subKey: "attorney.translate.sub", icon: Languages },
  { href: "/attorney/clauses", labelKey: "attorney.clauses", subKey: "attorney.clauses.sub", icon: BookOpen },
  { href: "/attorney/deadlines", labelKey: "attorney.deadlines", subKey: "attorney.deadlines.sub", icon: CalendarClock },
  { href: "/attorney/laws", labelKey: "attorney.laws", subKey: "attorney.laws.sub", icon: LibraryBig },
  { href: "/attorney/stats", labelKey: "attorney.stats", subKey: "attorney.stats.sub", icon: BarChart2 },
];

export function AttorneySidebar() {
  const { t, locale, setLocale } = useLocale();
  const { jConfig, activeJurisdiction, installedJurisdictions, setActiveJurisdiction } = useJurisdiction();
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [isLight, setIsLight] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<"idle" | "checking" | "up-to-date" | "available" | "downloading" | "ready" | "error">("idle");
  const [updatePct, setUpdatePct] = useState(0);
  const displayName = "Attorney";

  // Derived accent colours from active jurisdiction
  const accentColor = isLight ? jConfig.lightAccent : jConfig.accent;
  const accentRgb = isLight ? jConfig.lightAccentRgb : jConfig.accentRgb;

  useEffect(() => {
    const stored = localStorage.getItem("sidebar-collapsed");
    if (stored === "true") setCollapsed(true);
    const storedLight = localStorage.getItem("attorney-light-mode");
    if (storedLight === "true") setIsLight(true);

    // Wire up electron-updater event listeners
    const w = window as unknown as { electron?: { updater?: {
      onUpdateAvailable?: (cb: (info: { version: string }) => void) => () => void;
      onUpdateNotAvailable?: (cb: () => void) => () => void;
      onDownloadProgress?: (cb: (info: { pct: number }) => void) => () => void;
      onUpdateDownloaded?: (cb: () => void) => () => void;
      onError?: (cb: (info: { message: string }) => void) => () => void;
    } } };
    const updater = w.electron?.updater;
    const cleanups: (() => void)[] = [];
    if (updater) {
      if (updater.onUpdateAvailable) cleanups.push(updater.onUpdateAvailable((info) => {
        setUpdateVersion(info.version);
        setUpdateState("available");
      }));
      if (updater.onUpdateNotAvailable) cleanups.push(updater.onUpdateNotAvailable(() => {
        setUpdateState("up-to-date");
        setTimeout(() => setUpdateState("idle"), 4000);
      }));
      if (updater.onDownloadProgress) cleanups.push(updater.onDownloadProgress((info) => {
        setUpdatePct(info.pct);
      }));
      if (updater.onUpdateDownloaded) cleanups.push(updater.onUpdateDownloaded(() => {
        setUpdateState("ready");
      }));
      if (updater.onError) cleanups.push(updater.onError(() => {
        setUpdateState("error");
      }));
    }

    checkForUpdates(true);

    return () => { cleanups.forEach((fn) => fn()); };
  }, []);

  function checkForUpdates(silent = false) {
    const w = window as unknown as { electron?: { updater?: { check?: () => Promise<{ hasUpdate: boolean; version?: string }> } } };
    if (!w.electron?.updater?.check) return;
    if (!silent) setUpdateState("checking");
    w.electron.updater.check().then((res) => {
      if (res.hasUpdate && res.version) {
        setUpdateVersion(res.version);
        setUpdateState("available");
      } else if (!silent) {
        setUpdateState("up-to-date");
        setTimeout(() => setUpdateState("idle"), 4000);
      }
    }).catch(() => {
      if (!silent) setUpdateState("idle");
    });
  }

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("sidebar-collapsed", String(next));
      window.dispatchEvent(new CustomEvent("sidebar-collapsed-change", { detail: { collapsed: next } }));
      return next;
    });
  }

  function handleToggleTheme(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    const next = !isLight;

    const el = document.createElement("div");
    el.style.position = "fixed";
    el.style.inset = "0";
    el.style.zIndex = "9998";
    el.style.background = next ? jConfig.lightOverlay : jConfig.darkOverlay;
    el.style.clipPath = `circle(0px at ${cx}px ${cy}px)`;
    el.style.willChange = "clip-path";
    el.style.pointerEvents = "none";
    el.style.transition = "none";
    document.body.appendChild(el);

    // Force reflow to commit the initial clip-path before animating
    el.getBoundingClientRect();

    el.style.transition = "clip-path 700ms cubic-bezier(0.25,0,0.35,1)";
    el.style.clipPath = `circle(200vmax at ${cx}px ${cy}px)`;

    // Flip theme only after overlay fully covers screen — no bleed-through flicker
    el.addEventListener("transitionend", () => {
      setIsLight(next);
      localStorage.setItem("attorney-light-mode", String(next));
      window.dispatchEvent(new CustomEvent("attorney-theme-change", { detail: { light: next } }));

      // Give React two frames to repaint under the overlay, then fade out
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          el.style.transition = "opacity 180ms ease-out";
          el.style.opacity = "0";
          setTimeout(() => el.remove(), 200);
        });
      });
    }, { once: true });
  }

  useEffect(() => { setIsOpen(false); }, [pathname]);

  // Theme colour tokens — swap between dark and light, jurisdiction-aware
  const tc = isLight ? {
    bg: jConfig.lightSidebarBg,
    glow: jConfig.lightSidebarGlow,
    brand: jConfig.lightAccent,
    tagline: `rgba(${jConfig.lightAccentRgb},0.6)`,
    enclave: `rgba(${jConfig.lightAccentRgb},0.7)`,
    sectionLabel: "rgba(80,65,40,0.35)",
    navText: "rgba(45,35,20,0.88)",
    navSub: "rgba(70,58,38,0.6)",
    navIconColor: "rgba(70,58,38,0.65)",
    navIconBg: "rgba(0,0,0,0.05)",
    navIconBorder: "rgba(0,0,0,0.1)",
    divider: "rgba(0,0,0,0.08)",
    footerName: "rgba(45,35,20,0.72)",
    footerBadge: `rgba(${jConfig.lightAccentRgb},0.65)`,
    logoutColor: "rgba(0,0,0,0.3)",
    toggleBorder: "rgba(26,58,122,0.35)",
    toggleColor: "#1a3a7a",
    themeLabel: "DARK MODE",
    themeLabelColor: "#1a3a7a",
  } : {
    bg: jConfig.sidebarBg,
    glow: jConfig.sidebarGlow,
    brand: jConfig.accent,
    tagline: "#ffffff",
    enclave: `rgba(${jConfig.accentRgb},0.65)`,
    sectionLabel: "rgba(255,255,255,0.25)",
    navText: "#ffffff",
    navSub: "rgba(140,155,180,0.7)",
    navIconColor: "rgba(180,190,210,0.6)",
    navIconBg: "rgba(255,255,255,0.04)",
    navIconBorder: "rgba(255,255,255,0.07)",
    divider: "rgba(255,255,255,0.06)",
    footerName: "rgba(220,225,235,0.6)",
    footerBadge: `rgba(${jConfig.accentRgb},0.5)`,
    logoutColor: "rgba(255,255,255,0.3)",
    toggleBorder: "rgba(255,255,255,0.2)",
    toggleColor: "#ffffff",
    themeLabel: "LIGHT MODE (BETA)",
    themeLabelColor: "#ffffff",
  };

  const sidebarContent = (
    <div style={{ position: "relative", width: "100%", height: "100%", background: tc.bg, display: "flex", flexDirection: "column", transition: "background 0.5s ease" }}>
      {/* Top glow */}
      <div aria-hidden style={{ position: "absolute", top: 0, left: 0, right: 0, height: "180px", background: `radial-gradient(ellipse 80% 60% at 50% 0%, ${tc.glow} 0%, transparent 70%)`, pointerEvents: "none", zIndex: 0, transition: "background 0.5s ease" }} />

      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {/* Masthead */}
        <div style={{ padding: collapsed ? "18px 0 14px" : "22px 20px 16px", borderBottom: `1px solid ${tc.divider}`, transition: "padding 0.25s, border-color 0.5s", display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", position: "relative" }}>
          {collapsed ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
              <button
                className="hidden md:flex"
                onClick={toggleCollapsed}
                title="Expand sidebar"
                style={{ background: "transparent", border: `1px solid ${tc.toggleBorder}`, borderRadius: "6px", cursor: "pointer", color: tc.toggleColor, alignItems: "center", justifyContent: "center", width: "32px", height: "24px", transition: "all 0.15s", marginBottom: "6px" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = `rgba(${accentRgb},0.7)`; e.currentTarget.style.borderColor = `rgba(${accentRgb},0.25)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = tc.toggleColor; e.currentTarget.style.borderColor = tc.toggleBorder; }}
              >
                <ChevronRight size={12} />
              </button>
              <div style={{ fontFamily: "var(--font-cormorant)", fontSize: "20px", fontWeight: 300, letterSpacing: "0.08em", color: tc.brand, lineHeight: 1, transition: "color 0.5s" }}>M</div>
              <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#4ac56e", boxShadow: "0 0 6px rgba(74,197,110,0.7)", animation: "enclavePulse 2.4s ease-in-out infinite" }} />
            </div>
          ) : (
            <>
              <div>
                <div style={{ fontFamily: "var(--font-cormorant)", fontSize: "10px", letterSpacing: "0.3em", textTransform: "uppercase", color: tc.brand, marginBottom: "5px", transition: "color 0.5s" }}>
                  {t("app.tagline.attorney")}
                </div>
                <div style={{ fontFamily: "var(--font-cormorant)", fontSize: "28px", fontWeight: 300, letterSpacing: "0.08em", color: tc.brand, lineHeight: 1, transition: "color 0.5s" }}>
                  Mizan
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px" }}>
                <button
                  className="hidden md:flex"
                  onClick={toggleCollapsed}
                  title="Collapse sidebar"
                  style={{ background: "transparent", border: `1px solid ${tc.toggleBorder}`, borderRadius: "6px", cursor: "pointer", color: tc.toggleColor, alignItems: "center", justifyContent: "center", width: "28px", height: "24px", transition: "all 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = "rgba(201,168,76,0.7)"; e.currentTarget.style.borderColor = "rgba(201,168,76,0.25)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = tc.toggleColor; e.currentTarget.style.borderColor = tc.toggleBorder; }}
                >
                  <ChevronLeft size={12} />
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                  <span style={{ width: "5px", height: "5px", borderRadius: "50%", background: "#4ac56e", boxShadow: "0 0 6px rgba(74,197,110,0.7)", flexShrink: 0, animation: "enclavePulse 2.4s ease-in-out infinite" }} />
                  <span style={{ fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: tc.enclave, fontFamily: "var(--font-dm-sans)", whiteSpace: "nowrap", transition: "color 0.5s" }}>
                    {t("enclave.status")}
                  </span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Attorney badge — hidden when collapsed */}
        {!collapsed && (
          <div style={{ padding: "16px 24px 0" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "5px 10px", borderRadius: "20px", background: "rgba(74,197,110,0.08)", border: "1px solid rgba(74,197,110,0.2)" }}>
              <div style={{ width: "4px", height: "4px", borderRadius: "50%", background: "#4ac56e" }} />
              <span style={{ fontSize: "9px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(74,197,110,0.8)", fontFamily: "var(--font-dm-sans)" }}>
                {t("app.tagline.verified")}
              </span>
            </div>
          </div>
        )}

        {/* Tools navigation */}
        <nav style={{ flex: 1, padding: collapsed ? "16px 0 8px" : "20px 0 8px", overflowY: "auto", scrollbarWidth: "none", transition: "padding 0.25s" }}>
          {!collapsed && (
            <div style={{ padding: "0 24px 12px", fontSize: "9px", letterSpacing: "0.26em", textTransform: "uppercase", color: tc.sectionLabel, fontFamily: "var(--font-dm-sans)", transition: "color 0.5s" }}>
              {t("attorney.tools")}
            </div>
          )}
          {TOOL_DEFS.map(({ href, labelKey, subKey, icon: Icon }) => {
            const active = pathname?.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                style={{ textDecoration: "none", display: "block" }}
                onClick={(e) => {
                  if (!active) {
                    e.preventDefault();
                    window.dispatchEvent(new CustomEvent("attorney-nav", { detail: { href } }));
                  }
                }}
              >
                <div
                  title={collapsed ? t(labelKey) : undefined}
                  style={{
                    display: "flex", alignItems: "center",
                    gap: collapsed ? "0" : "12px",
                    padding: collapsed ? "10px 0" : "12px 24px",
                    justifyContent: collapsed ? "center" : "flex-start",
                    cursor: "pointer",
                    borderLeft: active && !collapsed ? `2px solid ${accentColor}` : "2px solid transparent",
                    background: active ? `rgba(${accentRgb},0.05)` : "transparent",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = isLight ? "rgba(0,0,0,0.04)" : "rgba(255,255,255,0.04)"; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = "transparent"; }}
                >
                  <div style={{ width: "32px", height: "32px", borderRadius: "8px", background: active ? `rgba(${accentRgb},0.12)` : tc.navIconBg, border: active ? `1px solid rgba(${accentRgb},0.25)` : `1px solid ${tc.navIconBorder}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.15s" }}>
                    <Icon size={14} style={{ color: active ? accentColor : tc.navIconColor, transition: "color 0.5s" }} />
                  </div>
                  {!collapsed && (
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontFamily: "var(--font-cormorant)", fontSize: "14px", fontWeight: active ? 500 : 400, color: active ? accentColor : tc.navText, letterSpacing: "0.02em", lineHeight: 1.2, transition: "color 0.5s" }}>
                        {t(labelKey)}
                      </div>
                      <div style={{ fontSize: "10px", color: tc.navSub, fontFamily: "var(--font-dm-sans)", marginTop: "2px", transition: "color 0.5s" }}>
                        {t(subKey)}
                      </div>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{ padding: collapsed ? "14px 0" : "16px 24px max(20px, env(safe-area-inset-bottom))", borderTop: `1px solid ${tc.divider}`, transition: "padding 0.25s, border-color 0.5s" }}>
          {collapsed ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
              {/* Light/Dark toggle icon */}
              <button
                title={isLight ? "Switch to dark mode" : "Switch to light mode (BETA)"}
                onClick={handleToggleTheme}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: tc.logoutColor, display: "flex", alignItems: "center", transition: "color 0.15s" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = `rgba(${accentRgb},0.7)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = tc.logoutColor; }}
              >
                {isLight ? <Moon size={13} /> : <Sun size={13} />}
              </button>
              <button
                title={locale === "fr" ? "Switch to English" : "Switch to French"}
                onClick={() => setLocale(locale === "fr" ? "en" : "fr")}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: tc.logoutColor, display: "flex", alignItems: "center", transition: "color 0.15s", fontSize: "9px", fontFamily: "var(--font-dm-sans)", letterSpacing: "0.1em" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = `rgba(${accentRgb},0.7)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = tc.logoutColor; }}
              >
                <Globe size={13} />
              </button>
              <a
                href="https://ko-fi.com/ablugg"
                target="_blank"
                rel="noopener noreferrer"
                title="Support Mizan"
                style={{ color: tc.logoutColor, display: "flex", alignItems: "center", transition: "color 0.15s", textDecoration: "none" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = "rgba(224,112,112,0.7)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.color = tc.logoutColor; }}
              >
                <Heart size={13} />
              </a>
              <button
                title={updateVersion ? `Update available: v${updateVersion}` : updateState === "up-to-date" ? "Up to date" : "Check for updates"}
                onClick={() => {
                  if (updateState === "ready") {
                    const w = window as unknown as { electron?: { updater?: { install?: () => void } } };
                    w.electron?.updater?.install?.();
                  } else if (updateState === "available") {
                    setUpdateState("downloading");
                    setUpdatePct(0);
                    const w = window as unknown as { electron?: { updater?: { download?: () => void } } };
                    w.electron?.updater?.download?.();
                  } else if (updateState !== "downloading") {
                    checkForUpdates(false);
                  }
                }}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: updateVersion ? accentColor : updateState === "up-to-date" ? "rgba(74,197,110,0.7)" : tc.logoutColor, display: "flex", alignItems: "center", transition: "color 0.15s", position: "relative" }}
                onMouseEnter={(e) => { e.currentTarget.style.color = `rgba(${accentRgb},0.7)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = updateVersion ? accentColor : updateState === "up-to-date" ? "rgba(74,197,110,0.7)" : tc.logoutColor; }}
              >
                <svg width="13" height="13" viewBox="0 0 11 11" fill="none" style={{ animation: updateState === "checking" ? "spin 1s linear infinite" : "none" }}>
                  <path d="M9.5 5.5a4 4 0 1 1-1.2-2.85" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                  <path d="M9.5 1.5v2h-2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                </svg>
                {updateVersion && (
                  <span style={{ position: "absolute", top: "-2px", right: "-2px", width: "5px", height: "5px", borderRadius: "50%", background: accentColor }} />
                )}
              </button>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: "var(--font-cormorant)", fontSize: "13px", color: tc.footerName, letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "color 0.5s" }}>
                    {displayName}
                  </div>
                  <div style={{ fontSize: "9px", letterSpacing: "0.1em", color: tc.footerBadge, fontFamily: "var(--font-dm-sans)", marginTop: "1px", transition: "color 0.5s" }}>
                    {t("app.tagline.licensed")}
                  </div>
                </div>
              </div>

              {/* Light mode toggle */}
              <button
                onClick={handleToggleTheme}
                style={{ display: "flex", alignItems: "center", gap: "7px", width: "100%", padding: "6px 8px", borderRadius: "7px", background: "transparent", border: `1px solid ${tc.toggleBorder}`, cursor: "pointer", transition: "all 0.2s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `rgba(${accentRgb},0.3)`; e.currentTarget.style.background = `rgba(${accentRgb},0.06)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = tc.toggleBorder; e.currentTarget.style.background = "transparent"; }}
              >
                {isLight
                  ? <Moon size={11} style={{ color: tc.toggleColor, flexShrink: 0 }} />
                  : <Sun size={11} style={{ color: tc.toggleColor, flexShrink: 0 }} />
                }
                <span style={{ fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: tc.themeLabelColor, fontFamily: "var(--font-dm-sans)", transition: "color 0.5s" }}>
                  {tc.themeLabel}
                </span>
              </button>

              {/* Language toggle */}
              <button
                onClick={() => setLocale(locale === "fr" ? "en" : "fr")}
                style={{ display: "flex", alignItems: "center", gap: "7px", width: "100%", padding: "6px 8px", borderRadius: "7px", background: "transparent", border: `1px solid ${tc.toggleBorder}`, cursor: "pointer", transition: "all 0.2s", marginTop: "6px" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `rgba(${accentRgb},0.3)`; e.currentTarget.style.background = `rgba(${accentRgb},0.06)`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = tc.toggleBorder; e.currentTarget.style.background = "transparent"; }}
              >
                <Globe size={11} style={{ color: tc.toggleColor, flexShrink: 0 }} />
                <span style={{ fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: tc.themeLabelColor, fontFamily: "var(--font-dm-sans)", transition: "color 0.5s" }}>
                  {locale === "fr" ? "ENGLISH" : "FRANCAIS"}
                </span>
              </button>

              {/* Donation */}
              <a
                href="https://ko-fi.com/ablugg"
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: "7px", width: "100%", padding: "6px 8px", borderRadius: "7px", background: "transparent", border: "1px solid transparent", cursor: "pointer", transition: "all 0.2s", marginTop: "6px", textDecoration: "none" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "rgba(224,112,112,0.2)"; (e.currentTarget as HTMLAnchorElement).style.background = "rgba(224,112,112,0.05)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.borderColor = "transparent"; (e.currentTarget as HTMLAnchorElement).style.background = "transparent"; }}
              >
                <Heart size={11} style={{ color: "rgba(224,112,112,0.5)", flexShrink: 0 }} />
                <span style={{ fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(224,112,112,0.45)", fontFamily: "var(--font-dm-sans)" }}>
                  {locale === "fr" ? "Soutenir Mizan" : "Support Mizan"}
                </span>
              </a>

              {/* Update available / downloading / ready */}
              {(updateState === "available" || updateState === "downloading" || updateState === "ready" || updateState === "error") && updateVersion && (
                <button
                  onClick={() => {
                    if (updateState === "ready") {
                      const w = window as unknown as { electron?: { updater?: { install?: () => void } } };
                      w.electron?.updater?.install?.();
                      return;
                    }
                    if (updateState === "downloading") return;
                    setUpdateState("downloading");
                    setUpdatePct(0);
                    const w = window as unknown as { electron?: { updater?: { download?: () => void } } };
                    w.electron?.updater?.download?.();
                  }}
                  style={{ display: "flex", alignItems: "center", gap: "7px", width: "100%", padding: "6px 8px", borderRadius: "7px", background: `rgba(${accentRgb},0.07)`, border: `1px solid rgba(${accentRgb},0.25)`, cursor: "pointer", transition: "all 0.2s", marginTop: "6px", textAlign: "left" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = `rgba(${accentRgb},0.12)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = `rgba(${accentRgb},0.07)`; }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M5.5 1v7M2.5 5l3-3 3 3" stroke={accentColor} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M1.5 9.5h8" stroke={accentColor} strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", color: `rgba(${accentRgb},0.85)`, fontFamily: "var(--font-dm-sans)", display: "block" }}>
                      {updateState === "downloading"
                        ? (locale === "fr" ? `Telechargement ${updatePct}%` : `Downloading ${updatePct}%`)
                        : updateState === "ready"
                        ? (locale === "fr" ? "Installer et redemarrer" : "Install and restart")
                        : updateState === "error"
                        ? (locale === "fr" ? "Echec, cliquez pour reessayer" : "Failed, click to retry")
                        : (locale === "fr" ? `Mise a jour ${updateVersion}` : `Update v${updateVersion}`)}
                    </span>
                    {updateState === "downloading" && (
                      <div style={{ width: "100%", height: "2px", borderRadius: "1px", background: `rgba(${accentRgb},0.15)`, marginTop: "4px", overflow: "hidden" }}>
                        <div style={{ height: "100%", borderRadius: "1px", width: `${updatePct}%`, background: accentColor, transition: "width 0.3s ease" }} />
                      </div>
                    )}
                  </div>
                </button>
              )}

              {/* Check for updates -- shown when idle, checking, up-to-date, or error without a known version */}
              {(updateState === "idle" || updateState === "checking" || updateState === "up-to-date" || (updateState === "error" && !updateVersion)) && (
                <button
                  onClick={() => checkForUpdates(false)}
                  disabled={updateState === "checking"}
                  style={{ display: "flex", alignItems: "center", gap: "7px", width: "100%", padding: "6px 8px", borderRadius: "7px", background: "transparent", border: `1px solid ${updateState === "error" ? "rgba(224,112,112,0.2)" : tc.toggleBorder}`, cursor: updateState === "checking" ? "default" : "pointer", transition: "all 0.2s", marginTop: "6px", textAlign: "left" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = `rgba(${accentRgb},0.3)`; e.currentTarget.style.background = `rgba(${accentRgb},0.06)`; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = tc.toggleBorder; e.currentTarget.style.background = "transparent"; }}
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0, animation: updateState === "checking" ? "spin 1s linear infinite" : "none" }}>
                    <path d="M9.5 5.5a4 4 0 1 1-1.2-2.85" stroke={tc.toggleColor} strokeWidth="1.2" strokeLinecap="round" fill="none"/>
                    <path d="M9.5 1.5v2h-2" stroke={tc.toggleColor} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
                  </svg>
                  <span style={{ fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: updateState === "up-to-date" ? "rgba(74,197,110,0.8)" : updateState === "error" ? "rgba(224,112,112,0.7)" : tc.themeLabelColor, fontFamily: "var(--font-dm-sans)", transition: "color 0.3s" }}>
                    {updateState === "checking"
                      ? (locale === "fr" ? "Verification..." : "Checking...")
                      : updateState === "up-to-date"
                      ? (locale === "fr" ? "A jour" : "Up to date")
                      : updateState === "error"
                      ? (locale === "fr" ? "Reessayer" : "Retry")
                      : (locale === "fr" ? "Verifier les mises a jour" : "Check for updates")}
                  </span>
                </button>
              )}

              {/* Jurisdiction switcher -- only shown when multiple jurisdictions are installed */}
              {installedJurisdictions.length > 1 && (
                <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                  {installedJurisdictions.map((j) => {
                    const jAccent = "#c9a84c";
                    const jRgb = "201,168,76";
                    const jFlag = "🇨🇦";
                    const isActive = j === activeJurisdiction;
                    return (
                      <button
                        key={j}
                        onClick={() => setActiveJurisdiction(j)}
                        title="Switch to Canadian law"
                        style={{
                          flex: 1, padding: "5px 4px", borderRadius: "7px", cursor: "pointer",
                          border: isActive ? `1px solid rgba(${jRgb},0.4)` : `1px solid ${tc.toggleBorder}`,
                          background: isActive ? `rgba(${jRgb},0.1)` : "transparent",
                          display: "flex", alignItems: "center", justifyContent: "center", gap: "4px",
                          transition: "all 0.2s",
                        }}
                        onMouseEnter={(e) => { if (!isActive) { e.currentTarget.style.background = `rgba(${jRgb},0.06)`; e.currentTarget.style.borderColor = `rgba(${jRgb},0.2)`; } }}
                        onMouseLeave={(e) => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.borderColor = tc.toggleBorder; } }}
                      >
                        <span style={{ fontSize: "11px", lineHeight: 1 }}>{jFlag}</span>
                        <span style={{ fontSize: "8px", letterSpacing: "0.12em", textTransform: "uppercase", color: isActive ? jAccent : tc.logoutColor, fontFamily: "var(--font-dm-sans)", fontWeight: isActive ? 600 : 400 }}>
                          {j.toUpperCase()}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 z-40 md:hidden transition-opacity duration-300 ${isOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        style={{ background: "rgba(0,0,0,0.6)" }}
        onClick={() => setIsOpen(false)}
      />

      {/* Mobile toggle button */}
      <button
        className="md:hidden fixed top-3 left-4 z-50 w-9 h-9 rounded-[8px] flex items-center justify-center"
        style={{ background: "rgba(6,13,26,0.9)", border: "1px solid rgba(74,197,110,0.15)", color: "rgba(74,197,110,0.7)", backdropFilter: "blur(10px)" }}
        onClick={() => setIsOpen(true)}
      >
        <Menu size={15} />
      </button>

      {/* Desktop sidebar */}
      <aside
        className="hidden md:block"
        style={{
          width: collapsed ? "64px" : "260px",
          height: "100dvh",
          borderRight: `1px solid ${tc.divider}`,
          flexShrink: 0,
          transition: "width 0.25s cubic-bezier(0.4,0,0.2,1), border-color 0.5s",
          overflow: "hidden",
        }}
      >
        {sidebarContent}
      </aside>

      {/* Mobile sidebar (drawer) */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 md:hidden transition-transform duration-300 ease-in-out ${isOpen ? "translate-x-0" : "-translate-x-full"}`}
        style={{ width: "260px", height: "100dvh", borderRight: `1px solid ${tc.divider}` }}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
