export interface Settings {
  baseUrl: string;
  token: string;
}

const DEFAULTS: Settings = { baseUrl: "http://localhost:8000", token: "" };

export async function loadSettings(): Promise<Settings> {
  const stored = (await chrome.storage.local.get(["baseUrl", "token"])) as Partial<Settings>;
  return { ...DEFAULTS, ...stored };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ baseUrl: settings.baseUrl.replace(/\/+$/, ""), token: settings.token.trim() });
}
