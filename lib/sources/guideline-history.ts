import fs from "node:fs";
import path from "node:path";

import type { ArticleInput } from "../ai/pipeline";
import { normalizeContentUrl } from "./obgyn-filter";
import type { SourceDef } from "./types";

type ArticleSidecar = { articles?: Array<{ sourceId?: string; url?: string }> };

function previouslyShownGuidelineUrls(
  sources: SourceDef[],
  reportsRoot: string,
  currentDate: string,
): Set<string> {
  const guidelineIds = new Set(
    sources
      .filter((source) => source.subcategory === "guidelines")
      .map((source) => source.id),
  );
  const seen = new Set<string>();
  if (!fs.existsSync(reportsRoot)) return seen;

  for (const date of fs.readdirSync(reportsRoot)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date === currentDate) continue;
    const sidecar = path.join(reportsRoot, date, `${date}-articles.json`);
    if (!fs.existsSync(sidecar)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(sidecar, "utf8")) as ArticleSidecar;
      for (const article of parsed.articles ?? []) {
        if (article.sourceId && article.url && guidelineIds.has(article.sourceId)) {
          seen.add(normalizeContentUrl(article.url));
        }
      }
    } catch {
      // A malformed historical sidecar must not block today's report.
    }
  }
  return seen;
}

export function filterPreviouslyPublishedGuidelines(
  articles: ArticleInput[],
  sources: SourceDef[],
  reportsRoot: string,
  currentDate: string,
): ArticleInput[] {
  const guidelineIds = new Set(
    sources
      .filter((source) => source.subcategory === "guidelines")
      .map((source) => source.id),
  );
  const priorUrls = previouslyShownGuidelineUrls(sources, reportsRoot, currentDate);
  return articles.filter(
    (article) =>
      !guidelineIds.has(article.sourceId) || !priorUrls.has(normalizeContentUrl(article.url)),
  );
}
