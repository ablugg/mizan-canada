"use client";

import { useState, useRef, useEffect } from "react";
import { FileText, Download, RotateCcw, ChevronDown, ImagePlus, X, Pencil } from "lucide-react";
import { DRAFT_TYPES, JURISDICTIONS, DraftType } from "@/types";
import { SessionHistory } from "@/components/attorney/SessionHistory";
import { EnclaveProcessing } from "@/components/attorney/EnclaveProcessing";
import { DocStarField } from "@/components/attorney/DocStarField";
import { useDocTask } from "@/contexts/DocTaskContext";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const FIELDS: Record<DraftType, { key: string; label: string; placeholder?: string; textarea?: boolean }[]> = {
  "Non-Disclosure Agreement (NDA)": [
    { key: "disclosingParty", label: "Disclosing Party" },
    { key: "receivingParty", label: "Receiving Party" },
    { key: "purpose", label: "Purpose of Disclosure", placeholder: "e.g. Evaluating a potential investment in…" },
    { key: "duration", label: "Confidentiality Period", placeholder: "e.g. 3 years" },
  ],
  "Employment Contract": [
    { key: "employerName", label: "Employer Name" },
    { key: "employeeName", label: "Employee Name" },
    { key: "jobTitle", label: "Job Title" },
    { key: "salary", label: "Annual Salary (CAD)" },
    { key: "startDate", label: "Start Date" },
    { key: "probationPeriod", label: "Probation Period", placeholder: "e.g. 90 days" },
  ],
  "Commercial Lease Agreement": [
    { key: "landlordName", label: "Landlord Name" },
    { key: "tenantName", label: "Tenant Name" },
    { key: "propertyAddress", label: "Property Address", textarea: true },
    { key: "monthlyRent", label: "Monthly Rent (CAD)" },
    { key: "leaseTerm", label: "Lease Term", placeholder: "e.g. 12 months" },
    { key: "securityDeposit", label: "Security Deposit (CAD)" },
  ],
  "Service Agreement": [
    { key: "serviceprovider", label: "Service Provider" },
    { key: "client", label: "Client" },
    { key: "services", label: "Description of Services", textarea: true },
    { key: "fee", label: "Fee / Compensation" },
    { key: "term", label: "Agreement Term" },
  ],
  "Memorandum of Understanding (MOU)": [
    { key: "party1", label: "Party 1 Name" },
    { key: "party2", label: "Party 2 Name" },
    { key: "objective", label: "Objective / Purpose", textarea: true },
    { key: "duration", label: "Duration", placeholder: "e.g. 6 months" },
  ],
  "Sale and Purchase Agreement": [
    { key: "sellerName", label: "Seller Name" },
    { key: "buyerName", label: "Buyer Name" },
    { key: "assetDescription", label: "Asset / Property Description", textarea: true },
    { key: "purchasePrice", label: "Purchase Price (CAD)" },
    { key: "completionDate", label: "Completion Date" },
  ],
  "Consultancy Agreement": [
    { key: "consultantName", label: "Consultant Name" },
    { key: "clientName", label: "Client Name" },
    { key: "scope", label: "Scope of Work", textarea: true },
    { key: "fee", label: "Consultancy Fee" },
    { key: "duration", label: "Engagement Duration" },
  ],
  "Power of Attorney": [
    { key: "principalName", label: "Principal (Grantor) Name" },
    { key: "agentName", label: "Agent (Attorney-in-Fact) Name" },
    { key: "powers", label: "Scope of Powers Granted", textarea: true, placeholder: "e.g. Sign contracts, manage bank accounts, sell property…" },
    { key: "limitations", label: "Limitations / Conditions", placeholder: "e.g. Valid for 1 year, restricted to property in Ontario" },
  ],
};

export default function DraftPage() {
  const { tasks, startDraft, clearTask } = useDocTask();
  const draftTask = tasks.DRAFT;

  // Local form state
  const [docType, setDocType] = useState<DraftType | "">("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [docLang, setDocLang] = useState<"en" | "fr">("en");
  const [exporting, setExporting] = useState(false);
  const [editedContent, setEditedContent] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [logo, setLogo] = useState<{ data: string; width: number; height: number; mimeType: string; preview: string; name: string } | null>(() => {
    try {
      const saved = typeof window !== "undefined" ? localStorage.getItem("mizan-firm-logo") : null;
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Restore form state from task if navigating back while task was running
  useEffect(() => {
    if (draftTask && docType === "") {
      setDocType(draftTask.docType);
      setJurisdiction(draftTask.jurisdiction);
      setDocLang(draftTask.docLang);
      setFields(draftTask.fields);
    }
  }, [draftTask]); // eslint-disable-line react-hooks/exhaustive-deps

  // Refresh history when task completes
  useEffect(() => {
    if (draftTask?.status === "done") {
      setHistoryRefresh((n) => n + 1);
    }
  }, [draftTask?.status]);

  // Auto-scroll to bottom action bar when done

  useEffect(() => {
    if (draftTask?.status === "done" && !draftTask?.isStreaming) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    }
  }, [draftTask?.status, draftTask?.isStreaming]);

  function handleLogo(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const logoData = {
          data: dataUrl.split(",")[1],
          width: img.naturalWidth,
          height: img.naturalHeight,
          mimeType: file.type,
          preview: dataUrl,
          name: file.name,
        };
        setLogo(logoData);
        try { localStorage.setItem("mizan-firm-logo", JSON.stringify(logoData)); } catch {}
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    setLogo(null);
    try { localStorage.removeItem("mizan-firm-logo"); } catch {}
    if (logoInputRef.current) logoInputRef.current.value = "";
  }

  function reset() {
    clearTask("DRAFT");
    setDocType("");
    setJurisdiction("");
    setFields({});
    setDocLang("en");
    setEditedContent(null);
    setIsEditing(false);
    setRestoredContent(null);
  }

  function generate() {
    if (!docType || !jurisdiction || draftTask?.status === "pending") return;
    startDraft({ docType, jurisdiction, docLang, fields });
  }

  async function exportDocx() {
    const exportContent = editedContent ?? draftTask?.content ?? restoredContent;
    if (!exportContent || exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/attorney/draft/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: exportContent,
          title: displayDocType,
          docType: displayDocType,
          docLang: displayDocLang,
          logo: logo ? { data: logo.data, width: logo.width, height: logo.height, mimeType: logo.mimeType } : null,
        }),
      });
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(draftTask.docType || "Document").replace(/[^a-zA-Z0-9]/g, "_")}_Mizan.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  function handleRestore(data: unknown) {
    const d = data as { content: string; docType: DraftType; jurisdiction: string; docLang: "en" | "fr"; fields: Record<string, string> };
    if (d?.content) {
      clearTask("DRAFT");
      setDocType(d.docType ?? "");
      setJurisdiction(d.jurisdiction ?? "");
      setDocLang(d.docLang ?? "en");
      setFields(d.fields ?? {});
      setRestoredContent(d.content);
      setEditedContent(null);
      setIsEditing(false);
    }
  }

  // Local restored content (for session history restore only)
  const [restoredContent, setRestoredContent] = useState<string | null>(null);

  const rawContent = draftTask?.content ?? restoredContent ?? "";
  const content = editedContent ?? rawContent;
  const isStreaming = draftTask?.isStreaming ?? false;
  const isDone = draftTask?.status === "done" || (restoredContent !== null && !draftTask);
  const isPending = draftTask?.status === "pending";
  const displayDocType = draftTask?.docType || docType;
  const displayJurisdiction = draftTask?.jurisdiction || jurisdiction;
  const displayDocLang = draftTask?.docLang ?? docLang;
  const isQuebecJurisdiction = jurisdiction.includes("Quebec") || (draftTask?.jurisdiction?.includes("Quebec") ?? false);

  const fieldDefs = docType ? FIELDS[docType] ?? [] : [];
  const canGenerate = !!docType && !!jurisdiction;

  return (
    <div className="flex flex-col h-full" style={{ background: "#060d1a", position: "relative" }}>
      <DocStarField />
      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-cormorant)", fontSize: "22px", fontWeight: 300, color: "#e8d5a0", letterSpacing: "0.04em" }}>
            Draft Generator
          </h1>
          <p style={{ fontSize: "11px", color: "#ffffff", marginTop: "2px", fontFamily: "var(--font-dm-sans)" }}>
            Jurisdiction-aware document drafting · Export to Word
          </p>
          <p style={{ fontSize: "10px", color: "rgba(201,168,76,0.5)", marginTop: "3px", fontFamily: "var(--font-dm-sans)" }}>
            Fully local · 0 bytes leave your device
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <SessionHistory tool="DRAFT" onRestore={handleRestore} refreshTrigger={historyRefresh} />
          {(content || docType) && (
            <button onClick={reset} style={{ display: "flex", alignItems: "center", gap: "6px", padding: "6px 12px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", cursor: "pointer", fontSize: "11px", fontFamily: "var(--font-dm-sans)" }}>
              <RotateCcw size={11} /> Reset
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ position: "relative", zIndex: 1, scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent", display: "flex", flexDirection: "column" }}>
        {/* Enclave animation while pending but no content yet */}
        {isPending && !content ? (
          <EnclaveProcessing label="Drafting document locally" sublabel="This may take 20–40 seconds · Larger files will take longer" />
        ) : !content ? (
          // Form
          <div style={{ maxWidth: "680px", margin: "auto", width: "100%", padding: "28px 0" }}>
            {/* Firm logo */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.7)", fontFamily: "var(--font-dm-sans)", marginBottom: "8px" }}>
                Firm Logo <span style={{ color: "#ffffff" }}>(optional)</span>
              </label>
              <input ref={logoInputRef} type="file" accept=".png,.jpg,.jpeg" style={{ display: "none" }}
                onChange={(e) => { if (e.target.files?.[0]) handleLogo(e.target.files[0]); }} />
              {logo ? (
                <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "10px 14px", borderRadius: "10px", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(74,197,110,0.2)" }}>
                  <img src={logo.preview} alt="Firm logo" style={{ height: "36px", maxWidth: "120px", objectFit: "contain", borderRadius: "4px" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: "11px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{logo.name}</p>
                    <p style={{ fontSize: "10px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginTop: "2px" }}>{logo.width} × {logo.height}px</p>
                  </div>
                  <button onClick={removeLogo}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#ffffff", padding: "2px", display: "flex" }}>
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <button onClick={() => logoInputRef.current?.click()}
                  style={{ width: "100%", padding: "12px", borderRadius: "10px", background: "rgba(5,10,24,0.97)", border: "1px dashed rgba(22,58,140,0.3)", color: "rgba(180,195,220,0.5)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", transition: "all 0.15s" }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(201,168,76,0.3)"; e.currentTarget.style.color = "rgba(201,168,76,0.6)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(22,58,140,0.3)"; e.currentTarget.style.color = "rgba(180,195,220,0.5)"; }}
                >
                  <ImagePlus size={14} /> Upload firm logo
                </button>
              )}
            </div>

            {/* Doc type */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.7)", fontFamily: "var(--font-dm-sans)", marginBottom: "8px" }}>
                Document Type
              </label>
              <div style={{ position: "relative" }}>
                <select
                  value={docType}
                  onChange={(e) => { setDocType(e.target.value as DraftType); setFields({}); }}
                  style={{ width: "100%", appearance: "none", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.28)", borderRadius: "10px", padding: "10px 36px 10px 14px", color: docType ? "#ffffff" : "rgba(180,195,220,0.4)", fontSize: "13px", fontFamily: "var(--font-dm-sans)", outline: "none", cursor: "pointer" }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.35)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.28)"; }}
                >
                  <option value="" disabled>Select document type…</option>
                  {DRAFT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", color: "#ffffff", pointerEvents: "none" }} />
              </div>
            </div>

            {/* Jurisdiction */}
            <div style={{ marginBottom: "24px" }}>
              <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.7)", fontFamily: "var(--font-dm-sans)", marginBottom: "8px" }}>
                Jurisdiction
              </label>
              <div style={{ position: "relative" }}>
                <select
                  value={jurisdiction}
                  onChange={(e) => setJurisdiction(e.target.value)}
                  style={{ width: "100%", appearance: "none", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.28)", borderRadius: "10px", padding: "10px 36px 10px 14px", color: jurisdiction ? "#ffffff" : "rgba(180,195,220,0.4)", fontSize: "13px", fontFamily: "var(--font-dm-sans)", outline: "none", cursor: "pointer" }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.35)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.28)"; }}
                >
                  <option value="" disabled>Select jurisdiction…</option>
                  {JURISDICTIONS.map((j) => <option key={j} value={j}>{j}</option>)}
                </select>
                <ChevronDown size={14} style={{ position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)", color: "#ffffff", pointerEvents: "none" }} />
              </div>
            </div>

            {/* Dynamic fields */}
            {fieldDefs.length > 0 && (
              <div>
                <div style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "16px" }}>
                  Document Details <span style={{ color: "#ffffff" }}>(optional — improves output)</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  {fieldDefs.map(({ key, label, placeholder, textarea }) => (
                    <div key={key}>
                      <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "6px" }}>
                        {label}
                      </label>
                      {textarea ? (
                        <textarea
                          rows={3}
                          value={fields[key] ?? ""}
                          onChange={(e) => setFields((p) => ({ ...p, [key]: e.target.value }))}
                          placeholder={placeholder}
                          style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "8px", padding: "9px 13px", color: "#ffffff", fontSize: "13px", fontFamily: "var(--font-dm-sans)", outline: "none", resize: "vertical", minHeight: "70px" }}
                          onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
                          onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }}
                        />
                      ) : (
                        <input
                          type="text"
                          value={fields[key] ?? ""}
                          onChange={(e) => setFields((p) => ({ ...p, [key]: e.target.value }))}
                          placeholder={placeholder}
                          style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "8px", padding: "9px 13px", color: "#ffffff", fontSize: "13px", fontFamily: "var(--font-dm-sans)", outline: "none" }}
                          onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
                          onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quebec-specific fields */}
            {isQuebecJurisdiction && (
              <div style={{ marginTop: "24px", paddingTop: "20px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                <div style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "14px" }}>
                  Quebec Particulars <span style={{ color: "#ffffff" }}>(optional — improves output)</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {[
                    { key: "neqNumber", label: "NEQ (Québec Enterprise Number)", placeholder: "e.g. 1234567890" },
                    { key: "notaryInfo", label: "Notary / Notaire", placeholder: "Name of notary if applicable" },
                    { key: "municipality", label: "Municipality / City", placeholder: "e.g. Montréal, Québec City, Laval" },
                  ].map(({ key, label, placeholder }) => (
                    <div key={key}>
                      <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "5px" }}>{label}</label>
                      <input
                        type="text"
                        value={fields[key] ?? ""}
                        onChange={(e) => setFields((p) => ({ ...p, [key]: e.target.value }))}
                        placeholder={placeholder}
                        style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "8px", padding: "8px 13px", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", outline: "none" }}
                        onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
                        onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Document language */}
            <div style={{ marginTop: "24px" }}>
              <label style={{ display: "block", fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.7)", fontFamily: "var(--font-dm-sans)", marginBottom: "10px" }}>
                Document Language
              </label>
              <div style={{ display: "flex", gap: "8px" }}>
                {(["en", "fr"] as const).map((lang) => {
                  const isActive = docLang === lang;
                  return (
                    <button
                      key={lang}
                      onClick={() => setDocLang(lang)}
                      style={{
                        flex: 1, padding: "9px 0", borderRadius: "9px",
                        border: isActive ? "1px solid rgba(201,168,76,0.45)" : "1px solid rgba(22,58,140,0.28)",
                        background: isActive ? "rgba(201,168,76,0.1)" : "rgba(5,10,24,0.97)",
                        color: isActive ? "#e8c96d" : "#ffffff",
                        fontSize: "13px",
                        fontFamily: "var(--font-dm-sans)",
                        cursor: "pointer", transition: "all 0.15s",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: "7px",
                      }}
                    >
                      <span style={{ fontSize: "15px" }}>{lang === "en" ? "🇨🇦" : "🇨🇦"}</span>
                      {lang === "en" ? "English" : "Français"}
                      {isActive && (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
              {docLang === "fr" && (
                <p style={{ marginTop: "8px", fontSize: "10px", color: "#ffffff", fontFamily: "var(--font-dm-sans)" }}>
                  The document and .docx export will be fully in French.
                </p>
              )}
            </div>

            <button
              onClick={generate}
              disabled={!canGenerate || isPending}
              style={{ marginTop: "28px", width: "100%", padding: "12px", borderRadius: "10px", background: canGenerate ? "#c9a84c" : "rgba(201,168,76,0.2)", border: "none", color: canGenerate ? "#0b0b10" : "#ffffff", fontSize: "13px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: canGenerate ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", transition: "all 0.15s" }}
            >
              <FileText size={14} />
              Generate Draft
            </button>
          </div>
        ) : (
          // Output
          <div style={{ maxWidth: "760px", margin: "auto", width: "100%", padding: "28px 0" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "11px", letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)" }}>
                  {displayJurisdiction}
                </p>
                <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "19px", fontWeight: 300, color: "#e8d5a0", marginTop: "2px" }}>
                  {displayDocType}
                </p>
              </div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                {isDone && !isStreaming && (
                  <button
                    onClick={() => setIsEditing((v) => !v)}
                    style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 12px", borderRadius: "9px", background: isEditing ? "rgba(201,168,76,0.12)" : "transparent", border: isEditing ? "1px solid rgba(201,168,76,0.3)" : "1px solid rgba(201,168,76,0.25)", color: isEditing ? "#c9a84c" : "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}
                  >
                    <Pencil size={11} /> {isEditing ? "Done editing" : "Edit"}
                  </button>
                )}
                {isDone && (
                  <button
                    onClick={exportDocx}
                    disabled={exporting}
                    style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "9px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: exporting ? "default" : "pointer", opacity: exporting ? 0.6 : 1 }}
                  >
                    <Download size={13} /> {exporting ? "Exporting…" : "Export .docx"}
                  </button>
                )}
                <button onClick={reset} style={{ padding: "8px 14px", borderRadius: "9px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                  New Draft
                </button>
              </div>
            </div>

            <div style={{ borderLeft: "1.5px solid rgba(201,168,76,0.18)", paddingLeft: "20px" }}>
              {isEditing ? (
                <textarea
                  value={editedContent ?? rawContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  style={{ width: "100%", minHeight: "500px", background: "rgba(5,10,24,0.6)", border: "1px solid rgba(201,168,76,0.2)", borderRadius: "8px", padding: "16px", color: "#ffffff", fontFamily: "var(--font-cormorant)", fontSize: "15px", fontWeight: 300, lineHeight: 1.9, resize: "vertical", outline: "none", direction: "ltr" }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.4)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.2)"; }}
                />
              ) : (
                <div className="draft-md" style={{ direction: "ltr" }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Bottom action bar — mirrors top buttons so user doesn't have to scroll up */}
            {isDone && !isStreaming && (
              <div style={{ display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "24px", paddingTop: "20px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                <button
                  onClick={() => setIsEditing((v) => !v)}
                  style={{ display: "flex", alignItems: "center", gap: "5px", padding: "8px 12px", borderRadius: "9px", background: isEditing ? "rgba(201,168,76,0.12)" : "transparent", border: isEditing ? "1px solid rgba(201,168,76,0.3)" : "1px solid rgba(201,168,76,0.25)", color: isEditing ? "#c9a84c" : "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}
                >
                  <Pencil size={11} /> {isEditing ? "Done editing" : "Edit"}
                </button>
                <button
                  onClick={exportDocx}
                  disabled={exporting}
                  style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 16px", borderRadius: "9px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: exporting ? "default" : "pointer", opacity: exporting ? 0.6 : 1 }}
                >
                  <Download size={13} /> {exporting ? "Exporting…" : "Export .docx"}
                </button>
                <button onClick={reset} style={{ padding: "8px 14px", borderRadius: "9px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                  New Draft
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
