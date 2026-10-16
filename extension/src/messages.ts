// Messages between the popup, the background service worker and the content script.
import type { components } from "../../shared/api";
import type { FillReport, Packet } from "./adapters/fill";

export type Lookup = components["schemas"]["ExtensionLookup"];
export type AppSummary = components["schemas"]["ApplicationSummary"];

export type ToBackground =
  | { type: "lookup"; url: string }
  | { type: "approved" }
  | { type: "fill"; tabId: number; applicationId: string }
  // from the content script
  | { type: "submitted"; url: string }
  | { type: "confirmation"; url: string; heading: string; hash: string }
  | { type: "session" };

export type ToContent =
  | { type: "ping" }
  | { type: "fill"; packet: Packet; resume: { name: string; base64: string } | null };

export interface Session {
  applicationId: string;
  startedAt: number;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

export async function ask<T>(message: ToBackground): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(message)) as Reply<T> | undefined;
  if (!reply) throw new Error("The extension's background worker did not answer.");
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}

export type { FillReport, Packet };
