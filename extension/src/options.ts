import { loadSettings, saveSettings } from "./settings";

const form = document.getElementById("form") as HTMLFormElement;
const baseUrl = document.getElementById("baseUrl") as HTMLInputElement;
const token = document.getElementById("token") as HTMLInputElement;
const result = document.getElementById("result")!;

function say(text: string, tone: "ok" | "error" | "muted") {
  result.textContent = text;
  result.className = tone;
}

void loadSettings().then((s) => {
  baseUrl.value = s.baseUrl;
  token.value = s.token;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  let origin: string;
  try {
    origin = new URL(baseUrl.value.trim()).origin;
  } catch {
    say("That is not a valid address.", "error");
    return;
  }
  // localhost is granted at install; any other server needs the user's permission (design 14: minimal access).
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if (!local && !(await chrome.permissions.request({ origins: [`${origin}/*`] }))) {
    say(`The extension needs permission to reach ${origin}.`, "error");
    return;
  }
  await saveSettings({ baseUrl: origin, token: token.value });
  say("Saved. Checking the connection…", "muted");
  try {
    const res = await fetch(`${origin}/api/status`, { headers: { Authorization: `Bearer ${token.value.trim()}` } });
    if (res.ok) say("Connected to job-copilot.", "ok");
    else if (res.status === 401) say("Saved, but the server did not accept this token.", "error");
    else say(`Saved, but the server answered ${res.status}.`, "error");
  } catch {
    say(`Saved, but ${origin} cannot be reached. Is the server running?`, "error");
  }
});
