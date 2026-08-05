export type GocmClassification = "guideline" | "surgery" | "research";

const GUIDELINE_RE = /guideline|consensus|recommendation|position statement/i;
const SURGERY_RE = /video article|surgical technique|laparoscop|hysteroscop|robotic|vnotes/i;

/**
 * GOCM's prism:section is authoritative when present. The title is only a
 * fallback for feeds/items that omit section metadata. Classification is
 * intentionally exclusive, with guideline precedence over surgery.
 */
export function classifyGocmItem(section?: string, title?: string): GocmClassification {
  const text = section?.trim() || title?.trim() || "";
  if (GUIDELINE_RE.test(text)) return "guideline";
  if (SURGERY_RE.test(text)) return "surgery";
  return "research";
}
