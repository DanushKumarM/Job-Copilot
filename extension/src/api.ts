// The backend calls the extension makes, all from the background worker (which has host permission for
// the server, so no CORS is involved). The extension only ever reads the approved packet.
import type { components } from "../../shared/api";
import type { AppSummary, Lookup, Packet } from "./messages";
import { loadSettings } from "./settings";

type AppDetail = components["schemas"]["ApplicationDetail"];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function call(method: string, path: string, body?: unknown): Promise<Response> {
  const { baseUrl, token } = await loadSettings();
  if (!token) throw new ApiError(0, "Open the extension's options and enter your server address and access token.");
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Cannot reach job-copilot at ${baseUrl}. Is the server running?`);
  }
  if (res.status === 401) throw new ApiError(401, "The access token was not accepted. Check the extension's options.");
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const parsed = (await res.json()) as { detail?: unknown; issues?: string[] };
      if (typeof parsed.detail === "string") detail = parsed.detail;
      if (parsed.issues?.length) detail += `: ${parsed.issues.join("; ")}`;
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, detail);
  }
  return res;
}

async function json<T>(method: string, path: string, body?: unknown): Promise<T> {
  return (await call(method, path, body)).json() as Promise<T>;
}

export const api = {
  lookup: async (url: string): Promise<Lookup | null> => {
    try {
      return await json<Lookup>("GET", `/extension/lookup?url=${encodeURIComponent(url)}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  },
  approved: () => json<AppSummary[]>("GET", "/applications?status=approved"),
  application: (id: string) => json<AppDetail>("GET", `/applications/${id}`),
  startSubmission: (id: string, lockVersion: number) =>
    json("POST", `/applications/${id}/transition`, {
      target: "submission_in_progress",
      lock_version: lockVersion,
      note: "form filled by the extension",
    }),
  packet: (id: string) => json<Packet>("GET", `/applications/${id}/packet`),
  resume: async (id: string): Promise<{ name: string; base64: string } | null> => {
    try {
      const res = await call("GET", `/applications/${id}/resume.pdf`);
      const name = /filename="?([^";]+)"?/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "resume.pdf";
      return { name, base64: toBase64(new Uint8Array(await res.arrayBuffer())) };
    } catch (e) {
      // No approved resume bullets: fill the form without attaching a resume.
      if (e instanceof ApiError && (e.status === 409 || e.status === 422)) return null;
      throw e;
    }
  },
  evidence: (id: string, kind: "submission_attempt" | "confirmation_page", externalRef: string, extracted: object) =>
    json<{ action: string }>("POST", `/applications/${id}/evidence`, { kind, external_ref: externalRef, extracted }),
};

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
