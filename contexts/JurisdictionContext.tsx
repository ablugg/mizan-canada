"use client";

import { createContext, useContext, useState, useEffect } from "react";

export type Jurisdiction = "ca";

export interface JurisdictionConfig {
  label: string;
  flag: string;
  systemName: string;
  // dark mode
  accent: string;
  accentRgb: string;
  pageBg: string;
  sidebarBg: string;
  sidebarGlow: string;
  // light mode
  lightAccent: string;
  lightAccentRgb: string;
  lightPageBg: string;
  lightSidebarBg: string;
  lightSidebarGlow: string;
  // overlay colours for the theme-switch ripple animation
  darkOverlay: string;
  lightOverlay: string;
}

export const JURISDICTIONS: Record<Jurisdiction, JurisdictionConfig> = {
  ca: {
    label: "Canada",
    flag: "🇨🇦",
    systemName: "Canadian Federal & Provincial Law",
    accent: "#c9a84c",
    accentRgb: "201,168,76",
    pageBg: "#060d1a",
    sidebarBg: "linear-gradient(180deg, #060d1a 0%, #08121f 60%, #050c18 100%)",
    sidebarGlow: "rgba(22,90,52,0.22)",
    lightAccent: "#7a5410",
    lightAccentRgb: "122,84,16",
    lightPageBg: "#fafaf7",
    lightSidebarBg: "linear-gradient(180deg, #f5f0e8 0%, #ede7d8 60%, #e6deca 100%)",
    lightSidebarGlow: "rgba(180,140,50,0.10)",
    darkOverlay: "rgba(6,13,26,0.88)",
    lightOverlay: "rgba(250,250,247,0.88)",
  },
};

interface JurisdictionContextValue {
  activeJurisdiction: Jurisdiction;
  installedJurisdictions: Jurisdiction[];
  jConfig: JurisdictionConfig;
  setActiveJurisdiction: (j: Jurisdiction) => void;
}

const JurisdictionContext = createContext<JurisdictionContextValue | null>(null);

export function useJurisdiction() {
  const ctx = useContext(JurisdictionContext);
  if (!ctx) throw new Error("useJurisdiction must be used inside JurisdictionProvider");
  return ctx;
}

export function JurisdictionProvider({ children }: { children: React.ReactNode }) {
  const [activeJurisdiction] = useState<Jurisdiction>("ca");
  const [installedJurisdictions] = useState<Jurisdiction[]>(["ca"]);

  return (
    <JurisdictionContext.Provider value={{
      activeJurisdiction,
      installedJurisdictions,
      jConfig: JURISDICTIONS[activeJurisdiction],
      setActiveJurisdiction: () => {},
    }}>
      {children}
    </JurisdictionContext.Provider>
  );
}
