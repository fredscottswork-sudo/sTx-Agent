// STX Trace — shared types
export type CheckStatus = "found" | "missing" | "unknown" | "skipped";
export type Confidence = "high" | "medium" | "low";

export interface SiteResult {
  site: string;
  url: string;
  category: string;
  status: CheckStatus;
  /** How trustworthy the classification is (echo/verification based). */
  confidence?: Confidence;
  note?: string;
  /** Set when the hit came from a derived username variant. */
  variant?: string;
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

export interface EmailDnsReport {
  ns: string[];
  a: string[];
  spf: string | null;
  dmarc: string | null;
  dmarcPolicy: string | null;
  bimi: boolean;
  dkim: { selector: string; present: boolean }[];
}

export interface RdapReport {
  registrar: string | null;
  registrantOrg: string | null;
  created: string | null;
  expires: string | null;
  status: string[];
  raw: boolean;
}

export interface EmailReport {
  email: string;
  valid: boolean;
  provider: string | null;
  disposable: boolean;
  domain: string;
  mx: { exchange: string; priority: number }[];
  mxOk: boolean;
  dns: EmailDnsReport | null;
  rdap: RdapReport | null;
  /** Plausible address formats for this domain (derived from local-part + provider patterns). */
  formats: string[];
  gravatar: {
    hash: string;
    imageUrl: string;
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
  rfc3966: string | null;
  country: string | null;
  countryName: string | null;
  countryCode: string | null;
  type: string | null;
  timezones: string[];
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

export interface WikipediaCandidate {
  title: string;
  url: string;
  extract: string;
}

export interface SeUserCandidate {
  display_name: string;
  link: string;
  reputation: number;
  site: string;
}

export interface GhUserCandidate {
  login: string;
  url: string;
}

export interface HnCandidate {
  author: string;
  title: string;
  url: string;
}

export interface IdentityReport {
  name: string;
  wikidata: WikidataCandidate[];
  wikipedia: WikipediaCandidate[];
  orcid: OrcidCandidate[];
  stackexchange: SeUserCandidate[];
  github: GhUserCandidate[];
  gitlab: GhUserCandidate[];
  hackernews: HnCandidate[];
  dorks: { engine: string; url: string }[];
  notes: string[];
  generatedAt: string;
}

export interface FaceResult {
  distance: number;
  similarity: number; // 0..100
  verdict: "match" | "likely" | "uncertain" | "different";
  verdictLabel: string;
  explanation: string;
  mode?: "fast" | "accurate";
  faceCountA?: number;
  faceCountB?: number;
  age?: string;
  gender?: string;
  expression?: string;
}

export interface ReportPayload {
  target: { username?: string; email?: string; phone?: string; name?: string };
  username?: { value: string; results: SiteResult[] };
  email?: EmailReport;
  phone?: PhoneReport;
  identity?: IdentityReport;
  face?: FaceResult;
}
