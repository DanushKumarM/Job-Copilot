// Typed client for the job-copilot API. Types come from the backend's OpenAPI schema
// (shared/api.d.ts, regenerated with `npm run gen:api`), so the console cannot drift from the API.
import type { components } from "../../shared/api";

type S = components["schemas"];
export type JobSummary = S["JobSummary"];
export type JobDetail = S["JobDetail"];
export type PastedJob = S["PastedJobIn"];
export type Fact = S["FactOut"];
export type FactKind = S["FactIn"]["kind"];
export type Answer = S["AnswerOut"];
export type Preferences = S["Preferences"];
export type Source = S["SourceOut"];
export type AppSummary = S["ApplicationSummary"];
export type AppDetail = S["ApplicationDetail"];
export type AppOut = S["ApplicationOut"];
export type DocumentOut = S["DocumentOut"];
export type ClaimDraft = S["ClaimDraft"];
export type InboxMessage = S["InboundMessageOut"];
export type InboxStatus = S["InboxStatus"];
export type Status = S["StatusOut"];
export type AppStatus = S["TransitionIn"]["target"];
export type MessageClass = NonNullable<S["AssignIn"]["classification"]>;
export type DocumentKind = NonNullable<S["GenerateIn"]["kind"]>;
export type AuthUser = { id: string; email: string };

const TOKEN_KEY = "jobcopilot.token";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode: the token lasts for this page only.
  }
  memoryToken = token ?? "";
  window.dispatchEvent(new Event("jobcopilot:auth"));
}

let memoryToken = getToken();

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
  }
}

function describe(status: number, body: unknown): ApiError {
  const b = (body ?? {}) as { detail?: unknown; issues?: string[] };
  if (Array.isArray(b.issues)) return new ApiError(status, "The validator rejected this content", b.issues);
  if (typeof b.detail === "string") return new ApiError(status, b.detail);
  if (Array.isArray(b.detail)) {
    // FastAPI request validation: [{loc, msg}]
    const msgs = (b.detail as { loc?: unknown[]; msg?: string }[]).map(
      (d) => `${(d.loc ?? []).slice(1).join(".")}: ${d.msg}`,
    );
    return new ApiError(status, "Some fields are invalid", msgs);
  }
  return new ApiError(status, `Request failed (${status})`);
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (memoryToken) headers.Authorization = "Bearer " + memoryToken;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    setToken(null);
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      // not JSON
    }
    throw describe(res.status, parsed);
  }
  return res;
}
async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await call(method, path, body)).json() as Promise<T>;
}

const q = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : "";
};

export const api = {
  register: (email: string, password: string) =>
    json<{ user: AuthUser }>("POST", "/auth/register", { email, password }),
  login: (email: string, password: string) =>
    json<{ user: AuthUser }>("POST", "/auth/login", { email, password }),
  logout: () => call("POST", "/auth/logout"),
  me: () => json<{ user: AuthUser }>("GET", "/auth/me"),
  status: () => json<Status>("GET", "/status"),

  // profile
  facts: (status?: string) => json<Fact[]>("GET", `/profile/facts${q({ status })}`),
  importResume: (text: string, file_name: string) =>
    json<Fact[]>("POST", "/profile/resume", { text, file_name }),
  addFact: (kind: FactKind, statement: string, details: Record<string, unknown> = {}) =>
    json<Fact>("POST", "/profile/facts", { kind, statement, details }),
  verifyFact: (id: string) => json<Fact>("POST", `/profile/facts/${id}/verify`),
  rejectFact: (id: string) => json<Fact>("POST", `/profile/facts/${id}/reject`),
  reviseFact: (id: string, statement: string) => json<Fact>("POST", `/profile/facts/${id}/revise`, { statement }),
  preferences: () => json<Preferences>("GET", "/profile/preferences"),
  savePreferences: (p: Preferences) => json<Preferences>("PUT", "/profile/preferences", p),
  answers: () => json<Answer[]>("GET", "/profile/answers"),
  saveAnswer: (key: string, question: string, answer: string) =>
    json<Answer>("PUT", `/profile/answers/${encodeURIComponent(key)}`, { question, answer }),

  // jobs and sources
  jobs: () => json<JobSummary[]>("GET", "/jobs?limit=500"),
  job: (id: string) => json<JobDetail>("GET", `/jobs/${id}`),
  pasteJob: (job: PastedJob) => json<JobDetail>("POST", "/jobs", job),
  evaluate: (id: string) => json<unknown>("POST", `/jobs/${id}/evaluate`),
  extract: (id: string) => json<JobDetail>("POST", `/jobs/${id}/extract`),
  shortlist: (jobId: string) => json<AppOut>("POST", `/jobs/${jobId}/application`),
  splitPosting: (postingId: string) => json<JobDetail>("POST", `/postings/${postingId}/split`),
  sources: () => json<Source[]>("GET", "/sources"),
  addSource: (kind: "greenhouse" | "lever", config: Record<string, string>) =>
    json<Source>("POST", "/sources", { kind, config }),
  pollSource: (id: string) => json<JobSummary[]>("POST", `/sources/${id}/poll`),

  // applications
  applications: (status?: string) => json<AppSummary[]>("GET", `/applications${q({ status })}`),
  application: (id: string) => json<AppDetail>("GET", `/applications/${id}`),
  generate: (id: string, kind: DocumentKind) => json<DocumentOut>("POST", `/applications/${id}/generate`, { kind }),
  saveDocument: (id: string, kind: DocumentKind, claims: ClaimDraft[]) =>
    json<DocumentOut>("PUT", `/applications/${id}/documents/${kind}`, { claims }),
  approve: (id: string, lock_version: number) => json<AppOut>("POST", `/applications/${id}/approve`, { lock_version }),
  transition: (id: string, target: AppStatus, lock_version: number, note?: string) =>
    json<AppOut>("POST", `/applications/${id}/transition`, { target, lock_version, note }),
  pdf: async (id: string, kind: "resume" | "answers"): Promise<{ blob: Blob; filename: string }> => {
    const res = await call("GET", `/applications/${id}/${kind}.pdf`);
    const disposition = res.headers.get("content-disposition") ?? "";
    const filename = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? `${kind}.pdf`;
    return { blob: await res.blob(), filename };
  },
  queue: () => json<AppSummary[]>("GET", "/queue"),
  funnel: () => json<Funnel>("GET", "/analytics/funnel"),

  // inbox
  inboxStatus: () => json<InboxStatus>("GET", "/inbox/status"),
  inbox: () => json<InboxMessage[]>("GET", "/inbox"),
  syncInbox: () => json<{ queued: boolean }>("POST", "/inbox/sync"),
  assign: (id: string, application_id: string, classification?: MessageClass) =>
    json<AppOut>("POST", `/inbox/${id}/assign`, { application_id, classification }),
  importMessage: (id: string, body: { company: string; title: string; location?: string }) =>
    json<AppOut>("POST", `/inbox/${id}/import`, body),
  dismiss: (id: string) => json<InboxMessage>("POST", `/inbox/${id}/dismiss`),
};

export interface Funnel {
  funnel: Record<string, number>;
  by_source: Record<string, Record<string, number>>;
  current_status: Record<string, number>;
  submitted_unconfirmed_now: number;
  llm: { calls: number; cost_inr: number; tokens: number };
}
