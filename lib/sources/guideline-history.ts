import fs from "node:fs";
import path from "node:path";

import type { ArticleInput } from "../ai/pipeline";
import { normalizeContentTitle, normalizeContentUrl } from "./obgyn-filter";

export interface DisplayedArticleRecord {
  url: string;
  title: string;
  category: string;
  sourceId: string;
  doi?: string;
  pmid?: string;
}

export interface ArticleHistoryRejection {
  article: ArticleInput;
  matchedHistoryDate: string;
  matchedBy: "url" | "title" | "doi" | "pmid";
}

export interface ArticleHistoryFilterResult {
  articles: ArticleInput[];
  rejections: ArticleHistoryRejection[];
  rejectedByUrl: number;
  rejectedByTitle: number;
  rejectedByDoi: number;
  rejectedByPmid: number;
}

interface HistoricalKey {
  date: string;
}

function previouslyShownArticleKeys(
  reportsRoot: string,
  currentDate: string,
): {
  urls: Map<string, HistoricalKey>;
  titles: Map<string, HistoricalKey>;
  dois: Map<string, HistoricalKey>;
  pmids: Map<string, HistoricalKey>;
} {
  const urls = new Map<string, HistoricalKey>();
  const titles = new Map<string, HistoricalKey>();
  const dois = new Map<string, HistoricalKey>();
  const pmids = new Map<string, HistoricalKey>();
  if (!fs.existsSync(reportsRoot)) return { urls, titles, dois, pmids };

  const historicalDates = fs.readdirSync(reportsRoot)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && date !== currentDate)
    .sort();

  for (const date of historicalDates) {
    const displayedFile = path.join(reportsRoot, date, `${date}-displayed.json`);
    if (!fs.existsSync(displayedFile)) continue;
    try {
      const parsed = JSON.parse(fs.readFileSync(displayedFile, "utf8")) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error("expected a JSON array");
      }
      for (const article of parsed as Array<Partial<DisplayedArticleRecord>>) {
        if (article.url) {
          const normalizedUrl = normalizeContentUrl(article.url);
          if (normalizedUrl) urls.set(normalizedUrl, { date });
        }
        if (article.title) {
          const normalizedTitle = normalizeContentTitle(article.title);
          if (normalizedTitle) titles.set(normalizedTitle, { date });
        }
        if (article.doi) dois.set(article.doi.toLowerCase(), { date });
        if (article.pmid) pmids.set(article.pmid, { date });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[daily] unable to read historical display file ${displayedFile}: ${message}`);
    }
  }
  return { urls, titles, dois, pmids };
}

function articleDoi(article: ArticleInput): string | undefined {
  const text = [article.url, article.excerpt, article.meta].filter(Boolean).join(" ");
  return text.match(/10\.\d{4,9}\/[\w.()/:;-]+/i)?.[0]
    ?.replace(/[).,;]+$/, "")
    .toLowerCase();
}

function articlePmid(article: ArticleInput): string | undefined {
  const pubmedUrl = article.url.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1];
  if (pubmedUrl) return pubmedUrl;
  return [article.excerpt, article.meta].filter(Boolean).join(" ").match(/\bPMID\s*:?\s*(\d{6,9})\b/i)?.[1];
}

export function filterPreviouslyPublishedArticlesWithStats(
  articles: ArticleInput[],
  reportsRoot: string,
  currentDate: string,
): ArticleHistoryFilterResult {
  const prior = previouslyShownArticleKeys(reportsRoot, currentDate);
  const kept: ArticleInput[] = [];
  const rejections: ArticleHistoryRejection[] = [];
  let rejectedByUrl = 0;
  let rejectedByTitle = 0;
  let rejectedByDoi = 0;
  let rejectedByPmid = 0;

  for (const article of articles) {
    const urlMatch = prior.urls.get(normalizeContentUrl(article.url));
    if (urlMatch) {
      rejectedByUrl += 1;
      rejections.push({ article, matchedHistoryDate: urlMatch.date, matchedBy: "url" });
      continue;
    }
    const titleMatch = prior.titles.get(normalizeContentTitle(article.title));
    if (titleMatch) {
      rejectedByTitle += 1;
      rejections.push({ article, matchedHistoryDate: titleMatch.date, matchedBy: "title" });
      continue;
    }
    const doiMatch = articleDoi(article);
    const priorDoi = doiMatch ? prior.dois.get(doiMatch) : undefined;
    if (priorDoi) {
      rejectedByDoi += 1;
      rejections.push({ article, matchedHistoryDate: priorDoi.date, matchedBy: "doi" });
      continue;
    }
    const pmidMatch = articlePmid(article);
    const priorPmid = pmidMatch ? prior.pmids.get(pmidMatch) : undefined;
    if (priorPmid) {
      rejectedByPmid += 1;
      rejections.push({ article, matchedHistoryDate: priorPmid.date, matchedBy: "pmid" });
      continue;
    }
    kept.push(article);
  }

  return {
    articles: kept,
    rejections,
    rejectedByUrl,
    rejectedByTitle,
    rejectedByDoi,
    rejectedByPmid,
  };
}

export function filterPreviouslyPublishedArticles(
  articles: ArticleInput[],
  reportsRoot: string,
  currentDate: string,
): ArticleInput[] {
  return filterPreviouslyPublishedArticlesWithStats(articles, reportsRoot, currentDate).articles;
}

export function toDisplayedArticleRecords(articles: ArticleInput[]): DisplayedArticleRecord[] {
  return articles.map((article) => {
    const doi = articleDoi(article);
    const pmid = articlePmid(article);
    return {
      url: article.url,
      title: article.title,
      category: article.category,
      sourceId: article.sourceId,
      ...(doi ? { doi } : {}),
      ...(pmid ? { pmid } : {}),
    };
  });
}
