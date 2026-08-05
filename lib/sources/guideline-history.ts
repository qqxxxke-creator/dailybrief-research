import fs from "node:fs";
import path from "node:path";

import type { ArticleInput } from "../ai/pipeline";
import { normalizeContentTitle, normalizeContentUrl } from "./obgyn-filter";

type ArticleSidecar = { articles?: Array<{ url?: string; title?: string }> };

function previouslyShownArticleKeys(
  reportsRoot: string,
  currentDate: string,
): { urls: Set<string>; titles: Set<string> } {
  const urls = new Set<string>();
  const titles = new Set<string>();
  if (!fs.existsSync(reportsRoot)) return { urls, titles };

  for (const date of fs.readdirSync(reportsRoot)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date === currentDate) continue;
    const sidecar = path.join(reportsRoot, date, `${date}-articles.json`);
    if (!fs.existsSync(sidecar)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(sidecar, "utf8")) as ArticleSidecar;
      for (const article of parsed.articles ?? []) {
        if (article.url) {
          urls.add(normalizeContentUrl(article.url));
        }
        if (article.title) {
          titles.add(normalizeContentTitle(article.title));
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[daily] unable to read historical article sidecar ${sidecar}: ${message}`);
    }
  }
  return { urls, titles };
}

export function filterPreviouslyPublishedArticles(
  articles: ArticleInput[],
  reportsRoot: string,
  currentDate: string,
): ArticleInput[] {
  const prior = previouslyShownArticleKeys(reportsRoot, currentDate);
  return articles.filter((article) => (
    !prior.urls.has(normalizeContentUrl(article.url))
    && !prior.titles.has(normalizeContentTitle(article.title))
  ));
}
