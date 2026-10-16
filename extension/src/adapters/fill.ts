// Form filling from an approved packet. Fills only what it is sure about, marks every field it touched,
// and lists the required fields it left for the user. It never submits, and never ticks consent,
// EEO or other checkbox/radio questions.

import type { components } from "../../../shared/api";
import {
  type Fillable,
  attachFile,
  fillableControls,
  isEmpty,
  isRequired,
  labelOf,
  mark,
  normalizeLabel,
  setValue,
} from "./dom";

export type Packet = components["schemas"]["PacketOut"];

export interface Adapter {
  name: "greenhouse" | "lever";
  /** Known fields by selector, tried before label matching. Keys are packet value keys (see values()). */
  fields: Record<string, string[]>;
  formRoot(doc: Document): ParentNode | null;
  resumeInput(doc: Document): HTMLInputElement | null;
  /** A text box for a cover letter or "additional information", if the form has one. */
  coverLetterBox(doc: Document): HTMLTextAreaElement | null;
  isConfirmation(doc: Document, url: URL): boolean;
}

export interface FillReport {
  filled: { label: string; key: string }[];
  /** Required fields still empty: the user must answer these. */
  needsYou: string[];
  resumeAttached: boolean;
  /** Saved answers older than 90 days that were used: worth a second look. */
  staleUsed: string[];
}

// Contact keys come from the answer bank (CONTACT_FIELDS on the backend), plus a first/last split.
const CONTACT_LABELS: [RegExp, string][] = [
  [/\bfirst name\b|^first$|given name/, "first_name"],
  [/\blast name\b|surname|family name/, "last_name"],
  [/^(full )?name$|^your name$|full name/, "full_name"],
  [/e-?mail/, "email"],
  [/phone|mobile/, "phone"],
  [/linkedin/, "linkedin"],
  [/github/, "github"],
  [/website|portfolio|personal (site|url)/, "website"],
  [/^(current )?(location|city)|where are you (based|located)/, "location"],
];

// Saved-answer keys with phrasings that differ a lot between forms. Sponsorship is deliberately absent:
// "need sponsorship?" and "authorised to work?" have opposite answers.
const ANSWER_LABELS: [RegExp, string][] = [
  [/notice period/, "notice_period"],
  [/expected (ctc|salary|compensation)|salary expectation/, "expected_ctc"],
  [/current (ctc|salary|compensation)/, "current_ctc"],
  [/years of (professional |relevant |work )?experience/, "years_of_experience"],
  [/relocat/, "willing_to_relocate"],
  [/authori[sz]ed to work|work authori[sz]ation|right to work/, "work_authorization"],
];

const STOP = new Set(
  "a an the is are do does you your what which how many much please enter provide of in to for with on at by be have".split(" "),
);

function tokens(text: string): Set<string> {
  return new Set(
    normalizeLabel(text)
      .replace(/[^a-z0-9 ]/g, " ")
      .split(" ")
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

/** Packet answers plus derived first and last names. */
export function values(packet: Packet): Record<string, string> {
  const v: Record<string, string> = { ...packet.answers };
  const full = (v.full_name ?? "").trim();
  if (full) {
    const parts = full.split(/\s+/);
    v.first_name ??= parts[0];
    if (parts.length > 1) v.last_name ??= parts.slice(1).join(" ");
  }
  return v;
}

/** Which value a label asks for, or null when unsure. */
export function keyForLabel(label: string, packet: Packet): string | null {
  const text = normalizeLabel(label);
  if (!text) return null;
  for (const [pattern, key] of CONTACT_LABELS) if (pattern.test(text)) return key;
  for (const [pattern, key] of ANSWER_LABELS) if (pattern.test(text) && key in packet.answers) return key;

  // Otherwise compare with the questions the user saved answers for. A clear single winner only.
  const wanted = tokens(text);
  let best: { key: string; score: number } | null = null;
  let tie = false;
  // `questions` is absent from servers older than the extension.
  for (const [key, question] of Object.entries(packet.questions ?? {})) {
    const q = tokens(question);
    if (q.size === 0) continue;
    const shared = [...q].filter((t) => wanted.has(t)).length;
    const score = shared / Math.max(q.size, wanted.size);
    if (score < 0.6) continue;
    if (!best || score > best.score) {
      best = { key, score };
      tie = false;
    } else if (score === best.score) tie = true;
  }
  return best && !tie ? best.key : null;
}

export function fill(doc: Document, adapter: Adapter, packet: Packet, resume: File | null): FillReport {
  const report: FillReport = { filled: [], needsYou: [], resumeAttached: false, staleUsed: [] };
  const root = adapter.formRoot(doc) ?? doc;
  const v = values(packet);
  const handled = new Set<Element>();

  const put = (el: Fillable, key: string) => {
    handled.add(el);
    const value = v[key];
    if (!value || !isEmpty(el)) return; // never overwrite what is already there
    if (setValue(el, value)) {
      mark(el, "filled");
      report.filled.push({ label: labelOf(el) || key, key });
      if (packet.stale_answers.includes(key)) report.staleUsed.push(packet.questions?.[key] ?? key);
    }
  };

  for (const [key, selectors] of Object.entries(adapter.fields)) {
    for (const selector of selectors) {
      const el = root.querySelector<Fillable>(selector);
      if (el && !handled.has(el)) {
        put(el, key);
        break;
      }
    }
  }

  const letter = (packet.documents.cover_letter ?? []).join(" ");
  const box = adapter.coverLetterBox(doc);
  if (box && letter && isEmpty(box) && setValue(box, letter)) {
    handled.add(box);
    mark(box, "filled");
    report.filled.push({ label: labelOf(box) || "Cover letter", key: "cover_letter" });
  }

  for (const el of fillableControls(root)) {
    if (handled.has(el)) continue;
    const key = keyForLabel(labelOf(el), packet);
    if (key) put(el, key);
  }

  const input = adapter.resumeInput(doc);
  if (input && resume && isEmpty(input)) {
    report.resumeAttached = attachFile(input, resume);
    if (report.resumeAttached) {
      handled.add(input);
      mark(input.closest("label, .field, .application-question, div") ?? input, "filled");
    }
  }

  for (const el of Array.from(root.querySelectorAll<Fillable>("input, textarea, select"))) {
    if (el instanceof HTMLInputElement && ["hidden", "submit", "button"].includes(el.type)) continue;
    if (!isRequired(el)) continue;
    const empty =
      el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")
        ? !Array.from(root.querySelectorAll<HTMLInputElement>("input")).some((o) => o.name === el.name && o.checked)
        : isEmpty(el);
    if (!empty) continue;
    const label = labelOf(el) || el.name || "an unlabelled field";
    if (!report.needsYou.includes(label)) {
      report.needsYou.push(label);
      mark(el, "check");
    }
  }
  return report;
}
