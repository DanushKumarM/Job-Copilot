// The toolbar popup: which application this page is, and a Fill button when its packet is approved.
import { adapterFor } from "./adapters/index";
import { type AppSummary, type FillReport, type Lookup, ask } from "./messages";
import { loadSettings } from "./settings";

const root = document.getElementById("app")!;

const LABELS: Record<string, string> = {
  discovered: "New",
  rejected_by_rules: "Filtered out",
  shortlisted: "Shortlisted",
  prepared: "Drafted",
  awaiting_approval: "Needs review",
  approved: "Approved",
  submission_in_progress: "Applying",
  submitted_unconfirmed: "Submitted, unconfirmed",
  submission_confirmed: "Confirmed",
  assessment: "Assessment",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
  failed: "Failed",
  needs_manual_intervention: "Needs attention",
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  ...children: (Node | string | null)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const child of children) if (child !== null) el.append(child);
  return el;
}

function show(...nodes: (Node | null)[]) {
  root.replaceChildren(...nodes.filter((n): n is Node => n !== null));
}

function consoleLink(base: string, path: string, text: string) {
  const a = h("a", { href: `${base}${path}`, target: "_blank", rel: "noreferrer" }, text);
  return a;
}

function optionsButton(text = "Open options") {
  const b = h("button", { class: "btn" }, text);
  b.onclick = () => chrome.runtime.openOptionsPage();
  return b;
}

async function main() {
  const settings = await loadSettings();
  if (!settings.token) {
    show(
      h("p", {}, "Connect the extension to your job-copilot server first."),
      optionsButton("Set up"),
    );
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url ? new URL(tab.url) : null;
  const site = url ? adapterFor(url) : null;
  if (!tab?.id || !url || !/^https?:$/.test(url.protocol)) {
    show(h("p", { class: "muted" }, "Open a job application page to use job-copilot."));
    return;
  }

  show(h("p", { class: "muted" }, "Looking this page up…"));
  let found: Lookup | null;
  try {
    found = await ask<Lookup | null>({ type: "lookup", url: url.href });
  } catch (e) {
    show(h("p", { class: "error" }, (e as Error).message), optionsButton());
    return;
  }

  if (!found) {
    if (!site) {
      show(
        h("p", {}, "This page is not a job in job-copilot."),
        h("p", { class: "muted" }, "Filling works on Greenhouse and Lever application forms. Elsewhere, use the PDFs from the console."),
      );
      return;
    }
    await chooseApplication(tab.id, settings.baseUrl);
    return;
  }
  renderApplication(tab.id, found, settings.baseUrl, site !== null);
}

function header(app: AppSummary) {
  return h(
    "div",
    { class: "head" },
    h("div", { class: "title" }, app.job_title),
    h("div", { class: "muted" }, app.company),
    h("span", { class: `badge s-${app.status}` }, LABELS[app.status] ?? app.status),
  );
}

function renderApplication(tabId: number, found: Lookup, base: string, supported: boolean) {
  const app = found.application;
  const link = consoleLink(base, `/applications/${app.id}`, "Open in job-copilot");
  if (found.packet_ready && supported) {
    const button = h("button", { class: "btn primary" }, "Fill this form");
    button.onclick = () => void runFill(tabId, app, base, button);
    show(
      header(app),
      h("p", {}, "Fills the fields it is sure about from your approved packet and attaches your tailored resume."),
      button,
      h("p", { class: "muted small" }, "You review every field and press Submit yourself."),
      link,
    );
  } else if (found.packet_ready) {
    show(header(app), h("p", {}, "This site is not supported for filling. Download the resume and answers sheet PDFs from the console."), link);
  } else if (["shortlisted", "prepared", "awaiting_approval", "discovered", "needs_manual_intervention"].includes(app.status)) {
    show(header(app), h("p", {}, "Not approved yet. Review and approve the content in job-copilot first."), link);
  } else if (app.status === "submitted_unconfirmed") {
    show(header(app), h("p", {}, "Submitted. Waiting for proof: this site's confirmation page or a confirmation email."), link);
  } else {
    show(header(app), link);
  }
}

async function chooseApplication(tabId: number, base: string) {
  let approved: AppSummary[] = [];
  try {
    approved = await ask<AppSummary[]>({ type: "approved" });
  } catch (e) {
    show(h("p", { class: "error" }, (e as Error).message));
    return;
  }
  if (approved.length === 0) {
    show(
      h("p", {}, "This job is not in job-copilot, and nothing is approved and waiting to be submitted."),
      consoleLink(base, "/jobs", "Add the job in job-copilot"),
    );
    return;
  }
  const select = h("select", {});
  for (const app of approved) select.append(h("option", { value: app.id }, `${app.job_title} — ${app.company}`));
  const button = h("button", { class: "btn primary" }, "Fill with this application");
  button.onclick = () => void runFill(tabId, approved.find((a) => a.id === select.value)!, base, button);
  show(
    h("p", {}, "This page did not match a job in job-copilot. If it is the form for one of these, pick it:"),
    select,
    button,
    h("p", { class: "muted small" }, "You review every field and press Submit yourself."),
  );
}

async function runFill(tabId: number, app: AppSummary, base: string, button: HTMLButtonElement) {
  button.disabled = true;
  button.textContent = "Filling…";
  try {
    const report = await ask<FillReport>({ type: "fill", tabId, applicationId: app.id });
    renderReport(app, report, base);
  } catch (e) {
    button.disabled = false;
    button.textContent = "Try again";
    root.append(h("p", { class: "error" }, (e as Error).message));
  }
}

function renderReport(app: AppSummary, report: FillReport, base: string) {
  const list = (items: string[]) => h("ul", {}, ...items.map((i) => h("li", {}, i)));
  show(
    header({ ...app, status: "submission_in_progress" }),
    h(
      "p",
      { class: "ok" },
      `Filled ${report.filled.length} field${report.filled.length === 1 ? "" : "s"}${report.resumeAttached ? " and attached your resume" : ""}. Filled fields have a blue outline.`,
    ),
    report.resumeAttached ? null : h("p", { class: "warn" }, "No resume was attached: attach it yourself."),
    report.needsYou.length ? h("p", { class: "warn" }, "These need you (dashed orange outline):") : null,
    report.needsYou.length ? list(report.needsYou) : null,
    report.staleUsed.length ? h("p", { class: "warn" }, "Saved answers older than 90 days were used; check them:") : null,
    report.staleUsed.length ? list(report.staleUsed) : null,
    h("p", {}, h("strong", {}, "Review everything, then press Submit on the page.")),
    h("p", { class: "muted small" }, "The confirmation page is captured as evidence when it appears."),
    consoleLink(base, `/applications/${app.id}`, "Open in job-copilot"),
  );
}

void main();
