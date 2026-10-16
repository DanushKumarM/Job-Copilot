// Background service worker: the only part that talks to the backend. It remembers which application each
// tab is filling (chrome.storage.session, cleared when the browser closes) so that a later submit and
// confirmation page on that tab become evidence for the right application.
import { api } from "./api";
import type { FillReport, Reply, Session, ToBackground, ToContent } from "./messages";

const SUBMITTING = new Set(["submission_in_progress", "submitted_unconfirmed"]);

async function getSession(tabId: number): Promise<Session | null> {
  const key = `tab:${tabId}`;
  return ((await chrome.storage.session.get(key))[key] as Session | undefined) ?? null;
}

async function setSession(tabId: number, session: Session | null): Promise<void> {
  const key = `tab:${tabId}`;
  if (session) await chrome.storage.session.set({ [key]: session });
  else await chrome.storage.session.remove(key);
}

/** Mark the application as being submitted, then hand the packet and resume to the page's content script. */
export async function fillTab(tabId: number, applicationId: string): Promise<FillReport> {
  const app = await api.application(applicationId);
  if (app.status === "approved") await api.startSubmission(applicationId, app.lock_version);
  else if (app.status !== "submission_in_progress") {
    throw new Error(`This application is "${app.status.replaceAll("_", " ")}". Approve it in job-copilot first.`);
  }
  const [packet, resume] = await Promise.all([api.packet(applicationId), api.resume(applicationId)]);
  const message: ToContent = { type: "fill", packet, resume };
  let report: FillReport | undefined;
  try {
    report = (await chrome.tabs.sendMessage(tabId, message)) as FillReport | undefined;
  } catch {
    report = undefined;
  }
  if (!report) throw new Error("This page has no form the extension can fill. Reload the page and try again.");
  await setSession(tabId, { applicationId, startedAt: Date.now() });
  return report;
}

async function onSubmitted(tabId: number, url: string): Promise<string> {
  const session = await getSession(tabId);
  if (!session) return "no fill session on this tab";
  // One attempt per minute per application: double clicks and re-renders do not create more.
  const ref = `attempt:${session.applicationId}:${Math.floor(Date.now() / 60_000)}`;
  const { action } = await api.evidence(session.applicationId, "submission_attempt", ref, { url });
  return action;
}

async function onConfirmation(tabId: number, url: string, heading: string, hash: string): Promise<string> {
  let applicationId = (await getSession(tabId))?.applicationId;
  if (!applicationId) {
    // Opened in a new tab, or the worker restarted: accept it only for an application mid-submission.
    const found = await api.lookup(url);
    if (!found || !SUBMITTING.has(found.application.status)) return "not an application being submitted";
    applicationId = found.application.id;
  }
  const { action } = await api.evidence(applicationId, "confirmation_page", `page:${applicationId}:${hash}`, {
    url,
    heading: heading.slice(0, 200),
  });
  await setSession(tabId, null);
  await chrome.action.setBadgeText({ tabId, text: "✓" });
  await chrome.action.setBadgeBackgroundColor({ tabId, color: "#157a46" });
  return action;
}

async function handle(message: ToBackground, sender: chrome.runtime.MessageSender): Promise<unknown> {
  const tabId = sender.tab?.id;
  switch (message.type) {
    case "lookup":
      return api.lookup(message.url);
    case "approved":
      return api.approved();
    case "fill":
      return fillTab(message.tabId, message.applicationId);
    case "submitted":
      return tabId === undefined ? null : onSubmitted(tabId, message.url);
    case "confirmation":
      return tabId === undefined ? null : onConfirmation(tabId, message.url, message.heading, message.hash);
    case "session":
      return tabId === undefined ? null : getSession(tabId);
  }
}

chrome.runtime.onMessage.addListener((message: ToBackground, sender, sendResponse: (r: Reply<unknown>) => void) => {
  handle(message, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
  );
  return true; // the response is sent asynchronously
});

chrome.tabs.onRemoved.addListener((tabId) => void setSession(tabId, null));

// End-to-end tests drive the worker directly instead of clicking the popup.
(globalThis as unknown as { jobcopilot: unknown }).jobcopilot = { fillTab };
