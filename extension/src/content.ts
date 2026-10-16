// Content script on Greenhouse and Lever pages. It fills the form only when the user clicks Fill in the
// popup, reports when the user submits, and reports a confirmation page. It never clicks anything.
import { pageText } from "./adapters/dom";
import { type Adapter, fill } from "./adapters/fill";
import { adapterFor } from "./adapters/index";
import { type Session, type ToContent, ask } from "./messages";

const adapter = adapterFor(new URL(location.href));

if (adapter) start(adapter);

function start(site: Adapter) {
  let watching = false;
  let lastSubmit = 0;
  let confirmed = false;

  chrome.runtime.onMessage.addListener((message: ToContent, _sender, sendResponse) => {
    if (message.type === "ping") {
      sendResponse({ adapter: site.name, form: Boolean(site.resumeInput(document) || site.formRoot(document)) });
      return;
    }
    if (message.type === "fill") {
      // The embedded Greenhouse form runs in an iframe; only the frame with a form answers.
      if (!site.formRoot(document) || site.isConfirmation(document, new URL(location.href))) return;
      const resume = message.resume ? toFile(message.resume.base64, message.resume.name) : null;
      sendResponse(fill(document, site, message.packet, resume));
      watchSubmit();
    }
  });

  function watchSubmit() {
    if (watching) return;
    watching = true;
    const onSubmit = () => {
      if (Date.now() - lastSubmit < 5000) return;
      lastSubmit = Date.now();
      void ask({ type: "submitted", url: location.href }).catch(() => undefined);
      watchForConfirmation(60_000);
    };
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener(
      "click",
      (e) => {
        const button = (e.target as Element | null)?.closest("button, input[type='submit']");
        if (!button) return;
        const text = (button.textContent || (button as HTMLInputElement).value || "").trim();
        if ((button as HTMLButtonElement).type === "submit" || /submit/i.test(text)) onSubmit();
      },
      true,
    );
  }

  /** Single-page forms swap in the confirmation without a navigation, so watch the DOM for a while. */
  function watchForConfirmation(ms: number) {
    const observer = new MutationObserver(() => void checkConfirmation());
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.setTimeout(() => observer.disconnect(), ms);
  }

  async function checkConfirmation() {
    if (confirmed || !site.isConfirmation(document, new URL(location.href))) return;
    confirmed = true;
    const { heading, body } = pageText(document);
    const hash = await sha256(`${location.origin}${location.pathname}\n${heading}\n${body}`);
    await ask({ type: "confirmation", url: location.href, heading, hash }).catch(() => undefined);
  }

  void checkConfirmation();
  // A page that reloads after the user submitted (same tab) keeps watching.
  void ask<Session | null>({ type: "session" })
    .then((session) => {
      if (session) {
        watchSubmit();
        watchForConfirmation(60_000);
      }
    })
    .catch(() => undefined);
}

function toFile(base64: string, name: string): File {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: "application/pdf" });
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
