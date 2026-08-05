import { load } from "cheerio";
import { classifyObgynContentType } from "./content-policy";
import type { RawArticle, SourceDef } from "./types";

const REQUEST_HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; DailyBriefOBGYN/1.0; +https://github.com/qqxxxke-creator/dailybrief-research)",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
};

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function containsAny(text: string, keywords: string[]): boolean {
  const normalized = text.toLocaleLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase()));
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function dateFromText(text: string): Date | undefined {
  const iso = text.match(/\b(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?\b/);
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));

  const dayFirst = text.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (dayFirst) {
    return new Date(Date.UTC(Number(dayFirst[3]), MONTHS[dayFirst[2].toLocaleLowerCase()], Number(dayFirst[1])));
  }

  const monthFirst = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/i);
  if (monthFirst) {
    return new Date(Date.UTC(Number(monthFirst[3]), MONTHS[monthFirst[1].toLocaleLowerCase()], Number(monthFirst[2])));
  }

  return undefined;
}

export function parseObgynPageHtml(
  source: SourceDef,
  html: string,
): RawArticle[] {
  const $ = load(html);
  const results: RawArticle[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, element) => {
    const link = $(element);
    if (link.closest("nav, header, footer").length > 0) return;

    const title = cleanText(link.text());
    const href = link.attr("href")?.trim() ?? "";
    if (title.length < 8 || !href || href.startsWith("#") || href.startsWith("javascript:")) return;

    let url: string;
    try {
      url = new URL(href, source.url).toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(url) || url === source.url || seen.has(url)) return;
    const sourceHost = new URL(source.url).hostname.toLocaleLowerCase();
    const allowedHosts = new Set([
      sourceHost,
      ...(source.allowedHosts ?? []).map((host) => host.toLocaleLowerCase()),
    ]);
    if (!allowedHosts.has(new URL(url).hostname.toLocaleLowerCase())) return;

    const container = link.closest(
      "article, li, .card, .listing-item, .content-item, .news-listing-item, .views-row, .list-item",
    );
    const contextNode = container.length ? container : link.parent();
    const context = cleanText(contextNode.text());
    const searchable = `${title}\n${context}`;
    if ((source.keywords?.length ?? 0) > 0 && !containsAny(searchable, source.keywords ?? [])) return;
    if (containsAny(searchable, source.excludeKeywords ?? [])) return;

    const datetime = contextNode.find("time[datetime]").attr("datetime");
    const publishedAt = datetime ? dateFromText(datetime) ?? new Date(datetime) : dateFromText(context);
    const excerpt = cleanText(context.replace(title, "")).slice(0, 500);

    seen.add(url);
    const article: RawArticle = {
      sourceId: source.id,
      title,
      url,
      excerpt: excerpt || undefined,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      category: source.category,
    };
    const contentType = classifyObgynContentType(article);
    results.push(contentType ? { ...article, contentType } : article);
  });

  return results.slice(0, 50);
}

export async function fetchObgynPage(source: SourceDef): Promise<RawArticle[]> {
  const response = await fetch(source.url, {
    headers: REQUEST_HEADERS,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseObgynPageHtml(source, await response.text());
}
