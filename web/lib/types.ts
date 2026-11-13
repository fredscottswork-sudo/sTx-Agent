// STX Trace — shared types
export type CheckStatus = "found" | "missing" | "unknown" | "skipped";

export interface SiteResult {
  site: string;
  url: string;
  category: string;
  status: CheckStatus;
  note?: string;
  ms: number;
}

export type UsernameEvent =
  | { type: "meta"; total: number; username: string }
  | { type: "result"; result: SiteResult; progress: number }
  | { type: "done"; found: number; missing: number; unknown: number; ms: number }
  | { type: "error"; message: string };

export interface GravatarAccount {
  shortname: string;
  url: string;
}

export interface EmailReport {
  email: string;
  valid: boolean;
  provider: string | null;
  disposable: boolean;
  domain: string;
  mx: { exchange: string; priority: number }[];
  mxOk: boolean;
  gravatar: {
    hash: string;
    hasAvatar: boolean;
    profileUrl: string | null;
    displayName?: string;
    location?: string;
    description?: string;
    jobs?: string[];
    accounts?: GravatarAccount[];
  } | null;
  breaches: string[] | null; // null = not checked (no API key)
  notes: string[];
  generatedAt: string;
}

export interface PhoneReport {
  input: string;
  valid: boolean;
  possible: boolean;
  e164: string | null;
  international: string | null;
  national: string | null;
  country: string | null;
  countryName: string | null;
  countryCode: string | null;
  type: string | null;
  notes: string[];
  generatedAt: string;
}

export interface WikidataCandidate {
  id: string;
  label: string;
  description: string | null;
  url: string;
  wikipedia: string | null;
}

export interface OrcidCandidate {
  orcid: string;
  givenNames: string | null;
  familyNames: string | null;
  url: string;
}

export interface IdentityReport {
  name: string;
  wikidata: WikidataCandidate[];
  orcid: OrcidCandidate[];
  notes: string[];
  generatedAt: string;
}

export interface FaceResult {
  distance: number;
  similarity: number; // 0..100
  verdict: "match" | "likely" | "uncertain" | "different";
  verdictLabel: string;
  explanation: string;
}

export interface ReportPayload {
  target: { username?: string; email?: string; phone?: string; name?: string };
  username?: { value: string; results: SiteResult[] };
  email?: EmailReport;
  phone?: PhoneReport;
  identity?: IdentityReport;
  face?: FaceResult;
}
