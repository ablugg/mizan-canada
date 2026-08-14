"use client";

import { useState, useEffect, useRef } from "react";
import { Plus, Trash2, Edit2, Check, X, Upload, AlertTriangle, CheckCircle2, FileUp, ClipboardList } from "lucide-react";
import type { ClauseEntry, ClauseCategory, ClauseCheckResult } from "@/types";
import { CLAUSE_CATEGORIES } from "@/types";
import { DocStarField } from "@/components/attorney/DocStarField";

const STATUS_COLORS = {
  present: { bg: "rgba(60,160,90,0.08)", border: "rgba(60,160,90,0.2)", text: "#6bc98a", label: "Present" },
  modified: { bg: "rgba(200,140,40,0.08)", border: "rgba(200,140,40,0.2)", text: "#d4a84c", label: "Modified" },
  absent: { bg: "rgba(200,50,50,0.08)", border: "rgba(200,50,50,0.2)", text: "#e07070", label: "Absent" },
  conflict: { bg: "rgba(160,40,40,0.12)", border: "rgba(200,50,50,0.3)", text: "#e05050", label: "Conflict" },
};

const BLANK: Omit<ClauseEntry, "id"> = { name: "", category: "Other", standardPosition: "", notes: "" };

export default function ClausesPage() {
  const [clauses, setClauses] = useState<ClauseEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<ClauseEntry, "id">>(BLANK);
  const [isAdding, setIsAdding] = useState(false);

  const [dissolvingIds, setDissolvingIds] = useState<Set<string>>(new Set());

  const [checkFile, setCheckFile] = useState<File | null>(null);
  const [checkResults, setCheckResults] = useState<ClauseCheckResult[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Import state
  type ImportMode = "file" | "paste";
  type ExtractedClause = Omit<ClauseEntry, "id"> & { _selected: boolean; _editOpen: boolean };
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("file");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importText, setImportText] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedClause[] | null>(null);
  const [importingIds, setImportingIds] = useState(false);
  const importFileRef = useRef<HTMLInputElement>(null);

  function closeImport() {
    setImportOpen(false);
    setImportFile(null);
    setImportText("");
    setExtracted(null);
    setExtractError(null);
    if (importFileRef.current) importFileRef.current.value = "";
  }

  async function extractClauses() {
    if (extracting) return;
    if (importMode === "file" && !importFile) return;
    if (importMode === "paste" && !importText.trim()) return;
    setExtracting(true);
    setExtractError(null);
    setExtracted(null);
    try {
      const fd = new FormData();
      if (importMode === "file" && importFile) fd.append("file", importFile);
      else fd.append("text", importText.trim());
      const res = await fetch("/api/attorney/clauses/import", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Extraction failed");
      const existingNames = new Set(clauses.map((c) => c.name.toLowerCase()));
      setExtracted(
        (data.clauses as Omit<ClauseEntry, "id">[]).map((c) => ({
          ...c,
          _selected: !existingNames.has(c.name.toLowerCase()),
          _editOpen: false,
        }))
      );
    } catch (e) {
      setExtractError(e instanceof Error ? e.message : "Extraction failed");
    } finally {
      setExtracting(false);
    }
  }

  async function commitImport() {
    if (!extracted || importingIds) return;
    const toAdd = extracted.filter((c) => c._selected);
    if (!toAdd.length) return;
    setImportingIds(true);
    const newClauses: ClauseEntry[] = toAdd.map(({ _selected: _, _editOpen: __, ...c }) => ({
      ...c,
      id: crypto.randomUUID(),
    }));
    await save([...clauses, ...newClauses]);
    setImportingIds(false);
    closeImport();
  }

  useEffect(() => {
    fetch("/api/attorney/clauses", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => setClauses(d.clauses ?? []))
      .finally(() => setLoading(false));
  }, []);

  async function save(updated: ClauseEntry[]) {
    setSaving(true);
    try {
      await fetch("/api/attorney/clauses", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clauses: updated }),
      });
      setClauses(updated);
    } finally {
      setSaving(false);
    }
  }

  function addClause() {
    if (!draft.name.trim() || !draft.standardPosition.trim()) return;
    const newClause: ClauseEntry = { ...draft, id: crypto.randomUUID() };
    save([...clauses, newClause]);
    setDraft(BLANK);
    setIsAdding(false);
  }

  function updateClause() {
    if (!editingId || !draft.name.trim() || !draft.standardPosition.trim()) return;
    save(clauses.map((c) => c.id === editingId ? { ...draft, id: editingId } : c));
    setEditingId(null);
    setDraft(BLANK);
  }

  function deleteClause(id: string) {
    save(clauses.filter((c) => c.id !== id));
  }

  function handleDelete(id: string) {
    setDissolvingIds((prev) => new Set(prev).add(id));
    setTimeout(() => {
      setDissolvingIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      deleteClause(id);
    }, 300);
  }

  function startEdit(c: ClauseEntry) {
    setEditingId(c.id);
    setDraft({ name: c.name, category: c.category, standardPosition: c.standardPosition, notes: c.notes ?? "" });
    setIsAdding(false);
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(BLANK);
    setIsAdding(false);
  }

  async function runCheck() {
    if (!checkFile || !clauses.length || checking) return;
    setChecking(true);
    setCheckError(null);
    setCheckResults(null);
    try {
      const fd = new FormData();
      fd.append("file", checkFile);
      fd.append("clauses", JSON.stringify(clauses));
      fd.append("language", localStorage.getItem("mizan-locale") || "en");
      const res = await fetch("/api/attorney/clauses/check", { method: "POST", body: fd, credentials: "include" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check failed");
      setCheckResults(data.results);
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : "Check failed");
    } finally {
      setChecking(false);
    }
  }

  const clauseForm = (
    <div style={{ padding: "16px", borderRadius: "12px", background: "rgba(201,168,76,0.04)", border: "1px solid rgba(201,168,76,0.15)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "10px" }}>
        <div>
          <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "5px" }}>Clause Name</label>
          <input value={draft.name} onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Liability Cap"
            style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "7px", padding: "8px 12px", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", outline: "none" }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
            onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }} />
        </div>
        <div>
          <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "5px" }}>Category</label>
          <select value={draft.category} onChange={(e) => setDraft((p) => ({ ...p, category: e.target.value as ClauseCategory }))}
            style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "7px", padding: "8px 12px", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", outline: "none", appearance: "none" }}
            onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
            onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }}>
            {CLAUSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: "10px" }}>
        <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "5px" }}>Standard Position</label>
        <textarea rows={3} value={draft.standardPosition} onChange={(e) => setDraft((p) => ({ ...p, standardPosition: e.target.value }))}
          placeholder="Describe your firm's standard position on this clause…"
          style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "7px", padding: "8px 12px", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", outline: "none", resize: "vertical" }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
          onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }} />
      </div>
      <div style={{ marginBottom: "12px" }}>
        <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "5px" }}>Notes <span style={{ color: "#ffffff" }}>(optional)</span></label>
        <input value={draft.notes ?? ""} onChange={(e) => setDraft((p) => ({ ...p, notes: e.target.value }))} placeholder="e.g. Only applicable for construction contracts"
          style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "7px", padding: "8px 12px", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", outline: "none" }}
          onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
          onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }} />
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={editingId ? updateClause : addClause} disabled={saving || !draft.name.trim() || !draft.standardPosition.trim()}
          style={{ display: "flex", alignItems: "center", gap: "5px", padding: "7px 16px", borderRadius: "8px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: "pointer", opacity: (!draft.name.trim() || !draft.standardPosition.trim()) ? 0.5 : 1 }}>
          <Check size={12} /> {editingId ? "Save Changes" : "Add Clause"}
        </button>
        <button onClick={cancelEdit}
          style={{ display: "flex", alignItems: "center", gap: "5px", padding: "7px 14px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  );

  const grouped = CLAUSE_CATEGORIES.reduce<Record<string, ClauseEntry[]>>((acc, cat) => {
    const items = clauses.filter((c) => c.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full" style={{ background: "#060d1a", position: "relative" }}>
      <DocStarField />

      {/* Header */}
      <div style={{ position: "relative", zIndex: 1, padding: "20px 32px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontFamily: "var(--font-cormorant)", fontSize: "22px", fontWeight: 300, color: "#e8d5a0", letterSpacing: "0.04em" }}>
            Clause Playbook
          </h1>
          <p style={{ fontSize: "11px", color: "#ffffff", marginTop: "2px", fontFamily: "var(--font-dm-sans)" }}>
            Your standard positions · Check contracts against your playbook
          </p>
          <p style={{ fontSize: "10px", color: "rgba(201,168,76,0.5)", marginTop: "3px", fontFamily: "var(--font-dm-sans)" }}>
            Fully local · 0 bytes leave your device
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {saving && <span style={{ fontSize: "10px", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)" }}>Saving…</span>}
          {!isAdding && !editingId && (
            <>
              <button
                onClick={() => { setImportOpen((v) => !v); setIsAdding(false); setEditingId(null); }}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 14px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                <FileUp size={12} /> Import
              </button>
              <button onClick={() => { setIsAdding(true); setEditingId(null); setDraft(BLANK); setImportOpen(false); }}
                style={{ display: "flex", alignItems: "center", gap: "6px", padding: "7px 14px", borderRadius: "8px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: "pointer" }}>
                <Plus size={12} /> Add Clause
              </button>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto" style={{ position: "relative", zIndex: 1, padding: "24px 32px", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent", display: "flex", flexDirection: "column" }}>
        <div style={{ maxWidth: "800px", margin: "auto", width: "100%", padding: "28px 0" }}>

          {/* Add form */}
          {isAdding && <div style={{ marginBottom: "24px" }}>{clauseForm}</div>}

          {/* Import panel */}
          {importOpen && !isAdding && (
            <div style={{ marginBottom: "28px", padding: "20px", borderRadius: "14px", background: "rgba(201,168,76,0.03)", border: "1px solid rgba(201,168,76,0.15)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
                <div>
                  <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "16px", color: "#e8d5a0", fontWeight: 300 }}>Import Clauses</p>
                  <p style={{ fontSize: "11px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginTop: "2px" }}>
                    Upload a clause library document or paste clause text — review before adding
                  </p>
                </div>
                <button onClick={closeImport} style={{ background: "none", border: "none", cursor: "pointer", color: "#ffffff", padding: "4px", display: "flex" }}>
                  <X size={14} />
                </button>
              </div>

              {/* Mode tabs */}
              {!extracted && (
                <>
                  <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
                    {(["file", "paste"] as const).map((m) => (
                      <button key={m} onClick={() => setImportMode(m)}
                        style={{ padding: "6px 14px", borderRadius: "8px", fontSize: "11px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", background: importMode === m ? "rgba(201,168,76,0.12)" : "transparent", border: importMode === m ? "1px solid rgba(201,168,76,0.35)" : "1px solid rgba(255,255,255,0.08)", color: importMode === m ? "#c9a84c" : "#ffffff", display: "flex", alignItems: "center", gap: "5px" }}>
                        {m === "file" ? <><FileUp size={11} /> Upload File</> : <><ClipboardList size={11} /> Paste Text</>}
                      </button>
                    ))}
                  </div>

                  {importMode === "file" ? (
                    <div>
                      <input ref={importFileRef} type="file" accept=".pdf,.docx,.doc,.txt" style={{ display: "none" }}
                        onChange={(e) => { if (e.target.files?.[0]) { setImportFile(e.target.files[0]); setExtractError(null); } }} />
                      <label onClick={() => importFileRef.current?.click()}
                        style={{ display: "flex", alignItems: "center", gap: "8px", padding: "28px", borderRadius: "10px", background: "rgba(5,10,24,0.6)", border: `1px dashed ${importFile ? "rgba(74,197,110,0.3)" : "rgba(201,168,76,0.2)"}`, color: importFile ? "rgba(107,201,138,0.8)" : "rgba(201,168,76,0.5)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", justifyContent: "center", flexDirection: "column", textAlign: "center" }}>
                        <Upload size={20} style={{ marginBottom: "6px", opacity: 0.7 }} />
                        {importFile ? (
                          <><span style={{ fontWeight: 600 }}>{importFile.name}</span><span style={{ fontSize: "10px", marginTop: "3px", opacity: 0.7 }}>Click to change</span></>
                        ) : (
                          <><span>Click to upload your clause library</span><span style={{ fontSize: "10px", marginTop: "3px", opacity: 0.7 }}>PDF, DOCX, or TXT</span></>
                        )}
                      </label>
                    </div>
                  ) : (
                    <textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder={"Paste clause text here — can be a single clause or a full section of your playbook document…"}
                      rows={8}
                      style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "10px", padding: "12px 14px", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", outline: "none", resize: "vertical", lineHeight: 1.7 }}
                      onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
                      onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }}
                    />
                  )}

                  {extractError && (
                    <p style={{ marginTop: "10px", fontSize: "12px", color: "#e07070", fontFamily: "var(--font-dm-sans)" }}>{extractError}</p>
                  )}

                  <div style={{ marginTop: "14px", display: "flex", gap: "8px" }}>
                    <button
                      onClick={extractClauses}
                      disabled={extracting || (importMode === "file" ? !importFile : !importText.trim())}
                      style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 20px", borderRadius: "8px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: "pointer", opacity: extracting || (importMode === "file" ? !importFile : !importText.trim()) ? 0.5 : 1 }}>
                      {extracting ? "Extracting…" : "Extract Clauses"}
                    </button>
                    <button onClick={closeImport}
                      style={{ padding: "8px 14px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                      Cancel
                    </button>
                  </div>
                </>
              )}

              {/* Review extracted clauses */}
              {extracted && (
                <div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
                    <p style={{ fontSize: "11px", color: "#ffffff", fontFamily: "var(--font-dm-sans)" }}>
                      <span style={{ color: "#c9a84c", fontWeight: 600 }}>{extracted.filter((c) => c._selected).length}</span> of {extracted.length} clauses selected
                    </p>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button onClick={() => setExtracted((p) => p?.map((c) => ({ ...c, _selected: true })) ?? null)}
                        style={{ fontSize: "10px", color: "rgba(201,168,76,0.7)", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-dm-sans)", padding: "2px 6px" }}>
                        Select all
                      </button>
                      <button onClick={() => setExtracted((p) => p?.map((c) => ({ ...c, _selected: false })) ?? null)}
                        style={{ fontSize: "10px", color: "#ffffff", background: "none", border: "none", cursor: "pointer", fontFamily: "var(--font-dm-sans)", padding: "2px 6px" }}>
                        Deselect all
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: "8px", maxHeight: "420px", overflowY: "auto", scrollbarWidth: "thin", scrollbarColor: "rgba(255,255,255,0.08) transparent" }}>
                    {extracted.map((c, i) => {
                      const isDuplicate = clauses.some((ex) => ex.name.toLowerCase() === c.name.toLowerCase());
                      return (
                        <div key={i} style={{ borderRadius: "10px", border: `1px solid ${c._selected ? "rgba(201,168,76,0.2)" : "rgba(255,255,255,0.06)"}`, background: c._selected ? "rgba(201,168,76,0.03)" : "rgba(255,255,255,0.01)", opacity: c._selected ? 1 : 0.45, transition: "all 0.15s" }}>
                          {/* Header row */}
                          <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 14px" }}>
                            <input type="checkbox" checked={c._selected}
                              onChange={(e) => setExtracted((p) => p?.map((x, j) => j === i ? { ...x, _selected: e.target.checked } : x) ?? null)}
                              style={{ accentColor: "#c9a84c", width: "14px", height: "14px", flexShrink: 0, cursor: "pointer" }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                                <span style={{ fontFamily: "var(--font-cormorant)", fontSize: "14px", color: "#e8d5a0" }}>{c.name}</span>
                                <span style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "8px", background: "rgba(255,255,255,0.05)", color: "#ffffff", fontFamily: "var(--font-dm-sans)", letterSpacing: "0.06em" }}>{c.category}</span>
                                {isDuplicate && (
                                  <span style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "8px", background: "rgba(200,140,40,0.1)", color: "#d4a84c", fontFamily: "var(--font-dm-sans)" }}>already in playbook</span>
                                )}
                              </div>
                              <p style={{ fontSize: "11px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", lineHeight: 1.55, marginTop: "3px" }}>{c.standardPosition}</p>
                              {c.notes && <p style={{ fontSize: "10px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginTop: "3px", fontStyle: "italic" }}>{c.notes}</p>}
                            </div>
                            <button onClick={() => setExtracted((p) => p?.map((x, j) => j === i ? { ...x, _editOpen: !x._editOpen } : x) ?? null)}
                              title="Edit before adding"
                              style={{ width: "26px", height: "26px", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.18)", cursor: "pointer", flexShrink: 0 }}>
                              <Edit2 size={10} style={{ color: "#c9a84c" }} />
                            </button>
                          </div>

                          {/* Inline edit */}
                          {c._editOpen && (
                            <div style={{ padding: "0 14px 14px", borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "12px" }}>
                              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
                                <div>
                                  <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "4px" }}>Name</label>
                                  <input value={c.name} onChange={(e) => setExtracted((p) => p?.map((x, j) => j === i ? { ...x, name: e.target.value } : x) ?? null)}
                                    style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "6px", padding: "7px 10px", color: "#ffffff", fontSize: "11px", fontFamily: "var(--font-dm-sans)", outline: "none" }}
                                    onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
                                    onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }} />
                                </div>
                                <div>
                                  <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "4px" }}>Category</label>
                                  <select value={c.category} onChange={(e) => setExtracted((p) => p?.map((x, j) => j === i ? { ...x, category: e.target.value as ClauseCategory } : x) ?? null)}
                                    style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "6px", padding: "7px 10px", color: "#ffffff", fontSize: "11px", fontFamily: "var(--font-dm-sans)", outline: "none", appearance: "none" }}
                                    onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
                                    onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }}>
                                    {CLAUSE_CATEGORIES.map((cat) => <option key={cat} value={cat}>{cat}</option>)}
                                  </select>
                                </div>
                              </div>
                              <div style={{ marginBottom: "8px" }}>
                                <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)", marginBottom: "4px" }}>Standard Position</label>
                                <textarea rows={2} value={c.standardPosition} onChange={(e) => setExtracted((p) => p?.map((x, j) => j === i ? { ...x, standardPosition: e.target.value } : x) ?? null)}
                                  style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "6px", padding: "7px 10px", color: "#ffffff", fontSize: "11px", fontFamily: "var(--font-dm-sans)", outline: "none", resize: "vertical" }}
                                  onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
                                  onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }} />
                              </div>
                              <div>
                                <label style={{ display: "block", fontSize: "9px", letterSpacing: "0.14em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "4px" }}>Notes</label>
                                <input value={c.notes ?? ""} onChange={(e) => setExtracted((p) => p?.map((x, j) => j === i ? { ...x, notes: e.target.value } : x) ?? null)}
                                  style={{ width: "100%", background: "rgba(5,10,24,0.97)", border: "1px solid rgba(22,58,140,0.22)", borderRadius: "6px", padding: "7px 10px", color: "#ffffff", fontSize: "11px", fontFamily: "var(--font-dm-sans)", outline: "none" }}
                                  onFocus={(e) => { e.target.style.borderColor = "rgba(201,168,76,0.3)"; }}
                                  onBlur={(e) => { e.target.style.borderColor = "rgba(22,58,140,0.22)"; }} />
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ marginTop: "16px", display: "flex", gap: "8px", alignItems: "center" }}>
                    <button onClick={commitImport} disabled={importingIds || extracted.filter((c) => c._selected).length === 0}
                      style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 20px", borderRadius: "8px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: "pointer", opacity: importingIds || extracted.filter((c) => c._selected).length === 0 ? 0.5 : 1 }}>
                      <Check size={12} /> {importingIds ? "Adding…" : `Add ${extracted.filter((c) => c._selected).length} clause${extracted.filter((c) => c._selected).length !== 1 ? "s" : ""}`}
                    </button>
                    <button onClick={() => { setExtracted(null); setExtractError(null); }}
                      style={{ padding: "8px 14px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(255,255,255,0.1)", color: "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                      ← Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {loading ? (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "16px", color: "#ffffff", fontWeight: 300 }}>Loading playbook…</p>
            </div>
          ) : clauses.length === 0 && !isAdding ? (
            <div style={{ textAlign: "center", padding: "60px 0" }}>
              <p style={{ fontFamily: "var(--font-cormorant)", fontSize: "18px", color: "#ffffff", fontWeight: 300, marginBottom: "8px" }}>
                Your playbook is empty
              </p>
              <p style={{ fontSize: "12px", color: "#ffffff", fontFamily: "var(--font-dm-sans)" }}>
                Add your firm's standard clause positions to use the contract checker.
              </p>
            </div>
          ) : (
            <>
              {/* Clause groups */}
              {Object.entries(grouped).map(([category, items]) => (
                <div key={category} style={{ marginBottom: "28px" }}>
                  <div style={{ fontSize: "9px", letterSpacing: "0.22em", textTransform: "uppercase", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginBottom: "10px" }}>
                    {category}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {items.map((c) => (
                      <div key={c.id}>
                        {editingId === c.id ? (
                          clauseForm
                        ) : (
                          <div style={{ padding: "14px 16px", borderRadius: "10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "flex-start", gap: "12px", opacity: dissolvingIds.has(c.id) ? 0 : 1, transform: dissolvingIds.has(c.id) ? "scale(0.97) translateY(-2px)" : "scale(1) translateY(0)", transition: "opacity 280ms ease, transform 280ms ease", pointerEvents: dissolvingIds.has(c.id) ? "none" : "auto" }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontFamily: "var(--font-cormorant)", fontSize: "15px", color: "#e8d5a0", marginBottom: "4px" }}>{c.name}</div>
                              <p style={{ fontSize: "12px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", lineHeight: 1.6 }}>{c.standardPosition}</p>
                              {c.notes && <p style={{ fontSize: "11px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", marginTop: "4px", fontStyle: "italic" }}>{c.notes}</p>}
                            </div>
                            <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
                              <button onClick={() => startEdit(c)} title="Edit"
                                style={{ width: "28px", height: "28px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(201,168,76,0.08)", border: "1px solid rgba(201,168,76,0.18)", cursor: "pointer" }}>
                                <Edit2 size={11} style={{ color: "#c9a84c" }} />
                              </button>
                              <button onClick={() => handleDelete(c.id)} title="Delete"
                                style={{ width: "28px", height: "28px", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(200,50,50,0.07)", border: "1px solid rgba(200,50,50,0.14)", cursor: "pointer" }}>
                                <Trash2 size={11} style={{ color: "#e07070" }} />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}

              {/* Contract check section */}
              {clauses.length > 0 && (
                <div style={{ marginTop: "32px", paddingTop: "24px", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "12px", flexWrap: "wrap", gap: "6px" }}>
                    <div style={{ fontSize: "10px", letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(201,168,76,0.6)", fontFamily: "var(--font-dm-sans)" }}>
                      Check Contract Against Playbook
                    </div>
                    <div style={{ fontSize: "10px", color: "rgba(201,168,76,0.5)", fontFamily: "var(--font-dm-sans)" }}>
                      Fully local · 0 bytes leave your device
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
                    <input ref={fileInputRef} type="file" accept=".pdf,.docx,.txt" style={{ display: "none" }}
                      onChange={(e) => { if (e.target.files?.[0]) { setCheckFile(e.target.files[0]); setCheckResults(null); } }} />
                    <label
                      onClick={() => fileInputRef.current?.click()}
                      style={{ padding: "8px 14px", borderRadius: "8px", background: "rgba(255,255,255,0.03)", border: `1px dashed ${checkFile ? "rgba(74,197,110,0.3)" : "rgba(255,255,255,0.1)"}`, color: checkFile ? "rgba(107,201,138,0.8)" : "#ffffff", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer", display: "flex", alignItems: "center", gap: "6px" }}>
                      <Upload size={12} /> {checkFile ? checkFile.name : "Upload contract (PDF, DOCX, TXT)"}
                    </label>
                    {checkFile && (
                      <button onClick={runCheck} disabled={checking}
                        style={{ padding: "8px 20px", borderRadius: "8px", background: "#c9a84c", border: "none", color: "#0b0b10", fontSize: "12px", fontFamily: "var(--font-dm-sans)", fontWeight: 600, cursor: checking ? "default" : "pointer", opacity: checking ? 0.6 : 1 }}>
                        {checking ? "Checking…" : "Check Contract"}
                      </button>
                    )}
                    {checkResults && (
                      <button onClick={() => { setCheckResults(null); setCheckFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
                        style={{ padding: "8px 12px", borderRadius: "8px", background: "transparent", border: "1px solid rgba(201,168,76,0.25)", color: "rgba(201,168,76,0.8)", fontSize: "12px", fontFamily: "var(--font-dm-sans)", cursor: "pointer" }}>
                        Clear
                      </button>
                    )}
                  </div>

                  {checkError && (
                    <div style={{ padding: "12px 16px", borderRadius: "10px", background: "rgba(200,50,50,0.08)", border: "1px solid rgba(200,50,50,0.2)", color: "#e07070", fontSize: "13px", fontFamily: "var(--font-dm-sans)", marginBottom: "12px" }}>
                      {checkError}
                    </div>
                  )}

                  {checkResults && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ display: "flex", gap: "16px", marginBottom: "8px", flexWrap: "wrap" }}>
                        {(["present", "modified", "absent", "conflict"] as const).map((s) => {
                          const count = checkResults.filter((r) => r.status === s).length;
                          return count > 0 ? (
                            <div key={s} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                              {s === "present" ? <CheckCircle2 size={12} style={{ color: "#6bc98a" }} /> : <AlertTriangle size={12} style={{ color: STATUS_COLORS[s].text }} />}
                              <span style={{ fontSize: "11px", color: STATUS_COLORS[s].text, fontFamily: "var(--font-dm-sans)" }}>{count} {STATUS_COLORS[s].label}</span>
                            </div>
                          ) : null;
                        })}
                      </div>
                      {checkResults.map((r, i) => {
                        const col = STATUS_COLORS[r.status];
                        return (
                          <div key={i} style={{ padding: "14px 16px", borderRadius: "10px", background: col.bg, border: `1px solid ${col.border}` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: r.finding ? "6px" : 0 }}>
                              <span style={{ fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", color: col.text, fontFamily: "var(--font-dm-sans)", padding: "2px 7px", borderRadius: "10px", background: `rgba(${col.text === "#6bc98a" ? "74,197,110" : col.text === "#d4a84c" ? "200,140,40" : "200,50,50"},0.12)` }}>{col.label}</span>
                              <span style={{ fontFamily: "var(--font-cormorant)", fontSize: "14px", color: "#e8d5a0" }}>{r.clause}</span>
                            </div>
                            {r.finding && <p style={{ fontSize: "12px", color: "#ffffff", fontFamily: "var(--font-dm-sans)", lineHeight: 1.6, marginBottom: r.recommendation ? "6px" : 0 }}>{r.finding}</p>}
                            {r.recommendation && <p style={{ fontSize: "11px", color: col.text, fontFamily: "var(--font-dm-sans)", lineHeight: 1.5, opacity: 0.9 }}>→ {r.recommendation}</p>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
