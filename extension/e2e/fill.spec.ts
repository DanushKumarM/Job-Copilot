// The whole loop on a fixture page: Fill -> fields and resume in the form -> the user submits ->
// submission attempt and confirmation page recorded -> the application is confirmed in job-copilot.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { type BrowserContext, type Worker, chromium, expect, test } from "@playwright/test";

const API = process.env.E2E_API ?? "http://localhost:8765";
const TOKEN = process.env.E2E_TOKEN ?? "demo-token";
const fixture = (name: string) => readFileSync(resolve("test/fixtures", name), "utf8");

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

type Fact = { id: string; statement: string; status: string };
type App = { id: string; status: string; lock_version: number; evidence: { kind: string }[] };

/** A verified profile with contact details, then an approved application for a new job at `url`. */
async function approvedApplication(url: string, title: string): Promise<string> {
  const answers: [string, string, string][] = [
    ["full_name", "Full name", "Asha Rao"],
    ["email", "Email", "asha.rao@example.com"],
    ["phone", "Phone", "+91 98765 43210"],
    ["location", "Current location", "Bengaluru"],
    ["linkedin", "LinkedIn URL", "https://linkedin.com/in/asharao"],
    ["notice_period", "What is your notice period?", "30 days"],
    ["work_authorization", "Are you authorised to work in India?", "Yes"],
    ["expected_ctc", "What is your expected CTC?", "32 LPA"],
  ];
  for (const [key, question, answer] of answers) await api("PUT", `/profile/answers/${key}`, { question, answer });

  let facts = await api<Fact[]>("GET", "/profile/facts?status=verified");
  let fact = facts.find((f) => f.statement.includes("billing services in Python"));
  if (!fact) {
    const added = await api<Fact>("POST", "/profile/facts", {
      kind: "achievement",
      statement: "Built billing services in Python handling 2 million invoices a month",
      details: { skills: ["python"] },
    });
    fact = await api<Fact>("POST", `/profile/facts/${added.id}/verify`);
    facts = [...facts, fact];
  }

  const job = await api<{ id: string; application_id: string | null; application_status: string | null }>(
    "POST",
    "/jobs",
    {
      title,
      company: "Acme E2E",
      location: "Bengaluru",
      url,
      description: "Requirements\n- Strong Python\n- 3+ years of professional software development experience",
    },
  );
  const app = await api<{ id: string }>("POST", `/jobs/${job.id}/application`);
  await api("PUT", `/applications/${app.id}/documents/resume_bullets`, {
    claims: [{ body: "Built Python billing services handling 2 million invoices a month", fact_ids: [fact.id] }],
  });
  const detail = await api<App>("GET", `/applications/${app.id}`);
  await api("POST", `/applications/${app.id}/approve`, { lock_version: detail.lock_version });
  return app.id;
}

async function launch(): Promise<{ context: BrowserContext; worker: Worker }> {
  const dist = resolve("dist");
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await worker.evaluate(
    ([baseUrl, token]) => chrome.storage.local.set({ baseUrl, token }),
    [API, TOKEN] as [string, string],
  );
  // Serve the fixtures at the real hosts; anything else on those hosts is refused.
  await context.route(/^https:\/\/(boards|job-boards)\.greenhouse\.io\//, (route) =>
    route.fulfill({ contentType: "text/html", body: fixture("greenhouse-apply.html") }),
  );
  await context.route(/^https:\/\/jobs\.lever\.co\//, (route) => {
    const thanks = route.request().method() === "POST" || route.request().url().endsWith("/thanks");
    return route.fulfill({ contentType: "text/html", body: fixture(thanks ? "lever-thanks.html" : "lever-apply.html") });
  });
  return { context, worker };
}

async function fillFromExtension(worker: Worker, pageUrl: string, applicationId: string) {
  return worker.evaluate(
    async ([url, id]) => {
      const [tab] = await chrome.tabs.query({ url });
      const g = globalThis as unknown as { jobcopilot: { fillTab: (t: number, a: string) => Promise<unknown> } };
      return g.jobcopilot.fillTab(tab.id!, id);
    },
    [pageUrl, applicationId] as [string, string],
  ) as Promise<{ filled: { key: string }[]; needsYou: string[]; resumeAttached: boolean }>;
}

async function waitForStatus(id: string, status: string): Promise<App> {
  let app = await api<App>("GET", `/applications/${id}`);
  for (let i = 0; i < 40 && app.status !== status; i++) {
    await new Promise((r) => setTimeout(r, 250));
    app = await api<App>("GET", `/applications/${id}`);
  }
  return app;
}

test("greenhouse: fill, the user submits, the confirmation page confirms", async () => {
  const jobId = String(Date.now()).slice(-9);
  const url = `https://boards.greenhouse.io/acmee2e/jobs/${jobId}`;
  const applicationId = await approvedApplication(url, `Backend Engineer GH ${jobId}`);
  const { context, worker } = await launch();
  try {
    const page = await context.newPage();
    await page.goto(url);
    const report = await fillFromExtension(worker, `${url}*`, applicationId);

    expect(report.resumeAttached).toBe(true);
    await expect(page.locator("#first_name")).toHaveValue("Asha");
    await expect(page.locator("#last_name")).toHaveValue("Rao");
    await expect(page.locator("#question_103")).toHaveValue("30 days");
    await expect(page.locator("#question_104")).toHaveValue("1");
    expect(await page.locator("#resume").evaluate((el: HTMLInputElement) => el.files?.[0]?.name)).toMatch(/^resume-.*\.pdf$/);
    expect(report.needsYou).toContain("Why do you want to work at Acme?*");
    expect((await api<App>("GET", `/applications/${applicationId}`)).status).toBe("submission_in_progress");

    // The human part: answer what the extension left, then press Submit.
    await page.fill("#question_106", "Payments at scale.");
    await page.check("#gdpr");
    await page.click("button[type=submit]");
    await expect(page.locator("h1")).toHaveText("Thank you for applying.");

    const app = await waitForStatus(applicationId, "submission_confirmed");
    expect(app.status).toBe("submission_confirmed");
    expect(app.evidence.map((e) => e.kind).sort()).toEqual(["confirmation_page", "submission_attempt"]);
  } finally {
    await context.close();
  }
});

test("lever: fill, the user submits, /thanks confirms", async () => {
  const posting = crypto.randomUUID();
  const url = `https://jobs.lever.co/acmee2e/${posting}`;
  const applicationId = await approvedApplication(url, `Backend Engineer LV ${posting.slice(0, 8)}`);
  const { context, worker } = await launch();
  try {
    const page = await context.newPage();
    await page.goto(`${url}/apply`);
    const report = await fillFromExtension(worker, `${url}/apply`, applicationId);

    expect(report.resumeAttached).toBe(true);
    await expect(page.locator("input[name='name']")).toHaveValue("Asha Rao");
    await expect(page.locator("input[name='cards[c1][field0]']")).toHaveValue("32 LPA");

    await page.fill("textarea[name='cards[c1][field1]']", "No, but I have built queue-based billing services.");
    await page.click("button[type=submit]");
    await page.waitForURL(/\/thanks$/);

    const app = await waitForStatus(applicationId, "submission_confirmed");
    expect(app.status).toBe("submission_confirmed");
    expect(app.evidence.map((e) => e.kind).sort()).toEqual(["confirmation_page", "submission_attempt"]);
  } finally {
    await context.close();
  }
});

test("loading a form never fills it: only Fill does", async () => {
  const { context } = await launch();
  try {
    const page = await context.newPage();
    await page.goto("https://boards.greenhouse.io/someoneelse/jobs/1");
    await page.waitForTimeout(1500);
    await expect(page.locator("#first_name")).toHaveValue("");
    expect(await page.locator("[data-jobcopilot]").count()).toBe(0);
  } finally {
    await context.close();
  }
});
