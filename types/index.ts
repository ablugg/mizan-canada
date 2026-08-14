export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  createdAt: Date;
  attachedFiles?: { name: string; size: number }[];
}

export interface Citation {
  source: string;
  jurisdiction: string;
  statute?: string;
  section?: string;
  url?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  lastMessage?: { content: string; role: string };
  updatedAt: Date;
}

// Attorney types
export type UserRole = "USER" | "ATTORNEY" | "ADMIN";
export type ApplicationStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface AttorneyApplication {
  id: string;
  name: string;
  email: string;
  barNumber: string;
  jurisdiction: string;
  firm?: string | null;
  specializations: string[];
  status: ApplicationStatus;
  notes?: string | null;
  appliedAt: Date;
  reviewedAt?: Date | null;
  reviewedBy?: string | null;
  userId?: string | null;
}

export interface ReviewRisk {
  clause: string;
  text: string;
  risk: string;
  severity: "high" | "medium" | "low";
  recommendation: string;
}

export interface DocumentReviewResult {
  documentType: string;
  summary: string;
  risks: ReviewRisk[];
  missingClauses: string[];
  favorabilityScore: number;
  overallAssessment: string;
}

export interface RedlineChange {
  id: string;
  originalText: string;
  suggestedText: string;
  reason: string;
  severity: "critical" | "moderate" | "minor";
  category: string;
  location?: string;
  accepted?: boolean;
}

export interface RedlineResult {
  changes: RedlineChange[];
  overallRisk: "high" | "medium" | "low";
  summary: string;
}

export const DRAFT_TYPES = [
  "Non-Disclosure Agreement (NDA)",
  "Employment Contract",
  "Commercial Lease Agreement",
  "Service Agreement",
  "Memorandum of Understanding (MOU)",
  "Sale and Purchase Agreement",
  "Consultancy Agreement",
  "Power of Attorney",
] as const;

export type DraftType = (typeof DRAFT_TYPES)[number];

export const JURISDICTIONS = [
  "Canada – Federal",
  "Canada – Ontario",
  "Canada – Quebec",
  "Canada – British Columbia",
  "Canada – Alberta",
  "Canada – Manitoba",
  "Canada – Saskatchewan",
  "Canada – Nova Scotia",
  "Canada – New Brunswick",
  "Canada – Newfoundland and Labrador",
  "Canada – Prince Edward Island",
  "Canada – Northwest Territories",
  "Canada – Nunavut",
  "Canada – Yukon",
] as const;

export interface ClauseEntry {
  id: string;
  name: string;
  category: string;
  standardPosition: string;
  notes?: string;
}

export interface ClauseCheckResult {
  clause: string;
  status: "present" | "absent" | "modified" | "conflict";
  finding: string;
  recommendation?: string;
}

export interface TranslateResult {
  translatedText: string;
  detectedLanguage: "fr" | "en";
  glossary: { term: string; translation: string; notes?: string }[];
}

export const TRANSLATE_MODES = [
  "General Legal",
  "Contract & Commercial",
  "Litigation & Pleadings",
  "Finance & Banking",
  "Regulatory & Compliance",
] as const;
export type TranslateMode = (typeof TRANSLATE_MODES)[number];

export const CLAUSE_CATEGORIES = [
  "Liability & Indemnity",
  "Termination & Exit",
  "Dispute Resolution",
  "Governing Law & Jurisdiction",
  "Confidentiality",
  "Intellectual Property",
  "Payment & Fees",
  "Force Majeure",
  "Warranties & Representations",
  "Assignment & Transfer",
  "Non-Compete & Non-Solicit",
  "Other",
] as const;
export type ClauseCategory = (typeof CLAUSE_CATEGORIES)[number];

export interface DeadlineEntry {
  obligation: string;
  party: string;
  deadline: string;
  deadlineType: "fixed" | "relative" | "triggered" | "recurring";
  consequence?: string;
  clauseRef?: string;
  priority: "high" | "medium" | "low";
}

export const SPECIALIZATIONS = [
  "Corporate & Commercial",
  "Real Estate & Property",
  "Labour & Employment",
  "Banking & Finance",
  "Litigation & Arbitration",
  "Intellectual Property",
  "Privacy & Data Protection",
  "Construction",
  "Family Law",
  "Criminal Law",
  "Immigration",
  "Environmental Law",
  "Tax Law",
  "Indigenous Law",
] as const;
