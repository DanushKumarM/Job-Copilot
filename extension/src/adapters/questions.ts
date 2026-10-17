import type { Adapter } from "./fill";
import { fillableControls, labelOf, normalizeLabel } from "./dom";

// Labels that are standard contact info or file uploads, not custom screening questions.
const SKIP_PATTERNS = [
  /\bfirst name\b|\blast name\b|^(full )?name$|e-?mail|phone|mobile|linkedin|github|website|portfolio/i,
  /resume|cv|cover letter|additional info/i,
  /^(current )?(location|city)|where are you (based|located)/i,
  /notice period|expected (ctc|salary)|current (ctc|salary)/i,
];

/**
 * Scrape custom screening questions from a job application form.
 * Returns the label text of textarea or text input fields that look like custom questions.
 */
export function scrapeQuestions(doc: Document, adapter: Adapter): string[] {
  const root = adapter.formRoot(doc) ?? doc;
  const questions: string[] = [];
  const seen = new Set<string>();

  for (const el of fillableControls(root)) {
    if (el instanceof HTMLInputElement && !["text", ""].includes(el.type)) continue;
    if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement)) continue;

    const label = labelOf(el);
    if (!label || label.length < 8) continue;

    const normalized = normalizeLabel(label);
    if (SKIP_PATTERNS.some((p) => p.test(normalized))) continue;
    if (seen.has(normalized)) continue;

    seen.add(normalized);
    questions.push(label);
  }
  return questions;
}
