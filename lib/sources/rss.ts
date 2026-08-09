import Parser from "rss-parser";
import { curlFetch } from "./curl-fetch";
import type { Category, RawArticle } from "./types";

export interface RssDiagnostics { rss_items_fetched: number; fetch_http_403: number; fetch_zero_items: number; feed_parse_failure: number }
const diagnostics = new Map<string, RssDiagnostics>();
function diag(id: string): RssDiagnostics { const d = diagnostics.get(id) ?? { rss_items_fetched: 0, fetch_http_403: 0, fetch_zero_items: 0, feed_parse_failure: 0 }; diagnostics.set(id, d); return d; }
export function getRssDiagnostics(sourceId: string): RssDiagnostics { return { ...diag(sourceId) }; }
export function resetRssDiagnostics(): void { diagnostics.clear(); }

const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (compatible; DailyBriefBot/1.0; +https://github.com/)",
  },
});

const CURL_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/atom+xml, application/rss+xml, application/xml, text/xml, */*",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export async function fetchRss(
  sourceId: string,
  url: string,
  category: Category,
  options: { limit?: number; useCurl?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<RawArticle[]> {
  const limit = options.limit ?? 30;

  let feed: Awaited<ReturnType<Parser["parseURL"]>>;
  try {
    if (options.useCurl) {
      const xml = await curlFetch(url, CURL_HEADERS);
      if (!xml.trim()) {
        diag(sourceId).fetch_zero_items += 1;
        console.warn(`[rss] fetch_zero_items source=${sourceId}`);
        return [];
      }
      feed = await parser.parseString(xml);
    } else {
      if (options.fetchImpl) {
        const response = await options.fetchImpl(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.text();
        if (!body.trim()) { diag(sourceId).fetch_zero_items += 1; return []; }
        feed = await parser.parseString(body);
      }
      else feed = await parser.parseURL(url);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /\b403\b|forbidden/i.test(message) ? "fetch_http_403" : (options.fetchImpl || /parse|xml|rss|unexpected end/i.test(message)) ? "feed_parse_failure" : "fetch_failure";
    if (status === "fetch_http_403") diag(sourceId).fetch_http_403 += 1;
    if (status === "feed_parse_failure") diag(sourceId).feed_parse_failure += 1;
    console.warn(`[rss] ${status} source=${sourceId}: ${message}`);
    return [];
  }

  if (!feed.items?.length) {
    diag(sourceId).fetch_zero_items += 1;
    console.warn(`[rss] fetch_zero_items source=${sourceId}`);
    return [];
  }

  diag(sourceId).rss_items_fetched += Math.min(feed.items.length, limit);
  return (feed.items ?? [])
    .slice(0, limit)
    .map((item) => ({
      sourceId,
      title: (item.title ?? "").trim(),
      url: (item.link ?? "").trim(),
      excerpt: stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? "").slice(
        0,
        300,
      ),
      publishedAt: item.isoDate || item.pubDate ? new Date(item.isoDate ?? item.pubDate!) : undefined,
      category,
    }))
    .filter((a) => a.title && a.url);
}
