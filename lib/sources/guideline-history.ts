import fs from "node:fs";
import path from "node:path";

import type { ArticleInput } from "../ai/pipeline";
import { normalizeContentUrl } from "./obgyn-filter";

type ArticleSidecar = { articles?: Array<{ url?: string }> };

function previouslyShownArticleUrls(
  reportsRoot: string,
  currentDate: string,
): Set<string> {
  const seen = new Set<string>();
  if (!fs.existsSync(reportsRoot)) return seen;

  for (const date of fs.readdirSync(reportsRoot)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date === currentDate) continue;
    const sidecar = path.join(reportsRoot, date, `${date}-articles.json`);
    if (!fs.existsSync(sidecar)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(sidecar, "utf8")) as ArticleSidecar;
      for (const article of parsed.articles ?? []) {
        if (article.url) {
          seen.add(normalizeContentUrl(article.url));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[daily] unable to read historical article sidecar ${sidecar}: ${message}`);
    }
  }
  return seen;
}

export function filterPreviouslyPublishedArticles(
  articles: ArticleInput[],
  reportsRoot: string,
  currentDate: string,
): ArticleInput[] {
  const priorUrls = previouslyShownArticleUrls(reportsRoot, currentDate);
  return articles.filter((article) => !priorUrls.has(normalizeContentUrl(article.url)));
}
