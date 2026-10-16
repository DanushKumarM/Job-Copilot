// DOM helpers shared by the site adapters. No chrome.* APIs here, so the adapters run under jsdom in tests.

export type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const TEXT_TYPES = new Set(["text", "email", "tel", "url", "number", "search", ""]);

export function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** Label text with required markers and "(optional)" removed. */
export function normalizeLabel(text: string): string {
  return clean(text.replace(/\*/g, " ").replace(/\((optional|required)\)/gi, " ")).toLowerCase();
}

/** The human label of a form control, from <label for>, aria attributes or the surrounding question block. */
export function labelOf(el: Element): string {
  const control = el as Fillable;
  const fromLabels = control.labels && control.labels.length ? clean(control.labels[0].textContent) : "";
  if (fromLabels) return fromLabels;
  const aria = el.getAttribute("aria-label");
  if (aria) return clean(aria);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (clean(text)) return clean(text);
  }
  // Lever wraps each question in .application-question with an .application-label; Greenhouse in .field.
  const block = el.closest(".application-question, .field, .form-field, [class*='question']");
  const blockLabel = block?.querySelector(".application-label, label, legend, .label");
  if (blockLabel && clean(blockLabel.textContent)) return clean(blockLabel.textContent);
  return clean(el.getAttribute("placeholder"));
}

export function isRequired(el: Element): boolean {
  const control = el as Fillable;
  return control.required || el.getAttribute("aria-required") === "true" || labelOf(el).includes("*");
}

export function isEmpty(el: Fillable): boolean {
  if (el instanceof HTMLInputElement && el.type === "file") return !el.files || el.files.length === 0;
  return clean(el.value) === "";
}

/** Text inputs, textareas and native selects the user could type into. Never checkboxes, radios or hidden. */
export function fillableControls(root: ParentNode): Fillable[] {
  const controls = Array.from(root.querySelectorAll<Fillable>("input, textarea, select"));
  return controls.filter((el) => {
    if (el.disabled || (el as HTMLInputElement).readOnly) return false;
    if (el instanceof HTMLInputElement) {
      if (!TEXT_TYPES.has(el.type)) return false;
      // Autocomplete widgets (location pickers, country comboboxes) need real choices from the user.
      if (el.getAttribute("role") === "combobox" || el.getAttribute("aria-autocomplete")) return false;
    }
    return true;
  });
}

/** Set a value so that React-controlled inputs notice: the native setter, then input and change events. */
export function setValue(el: Fillable, value: string): boolean {
  if (el instanceof HTMLSelectElement) {
    const wanted = value.trim().toLowerCase();
    const options = Array.from(el.options).filter((o) => o.value !== "");
    const exact = options.filter((o) => clean(o.textContent).toLowerCase() === wanted);
    const loose = options.filter((o) => clean(o.textContent).toLowerCase().startsWith(wanted));
    const match = exact.length === 1 ? exact[0] : exact.length === 0 && loose.length === 1 ? loose[0] : null;
    if (!match) return false; // ambiguous or absent: leave it to the user
    el.value = match.value;
  } else {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/** Put a file into an <input type=file> the way a user's file picker would. */
export function attachFile(input: HTMLInputElement, file: File): boolean {
  if (typeof DataTransfer === "undefined") return false;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

export function mark(el: Element, how: "filled" | "check"): void {
  const node = el as HTMLElement;
  node.dataset.jobcopilot = how;
  node.style.outline = how === "filled" ? "2px solid #2563eb" : "2px dashed #d97706";
  node.style.outlineOffset = "2px";
}

/** Visible heading and body text, for confirmation detection and hashing. */
export function pageText(doc: Document): { heading: string; body: string } {
  const heading = clean(doc.querySelector("main h1, main h2, h1, h2")?.textContent);
  const body = clean(doc.body?.textContent).slice(0, 4000);
  return { heading, body };
}
