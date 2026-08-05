import { load, type Cheerio } from "cheerio";

import type { RawArticle, SourceDef } from "./types";

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function issueMetadata(text: string): { label: string; date?: Date } {
  const issue = text.match(/(20\d{2}年\s*[,，]?\s*第\d+卷\s*[,，]?\s*第\d+期)/)?.[1] ?? "";
  const dateMatch = text.match(/刊出日期[：:]\s*(20\d{2})-(\d{1,2})-(\d{1,2})/);
  const date = dateMatch
    ? new Date(Date.UTC(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3])))
    : undefined;
  return { label: clean(issue), date };
}

function articleContainer($: ReturnType<typeof load>, doiLink: Cheerio<any>): Cheerio<any> {
  let node = doiLink.parent();
  for (let depth = 0; depth < 7 && node.length > 0; depth += 1) {
    if (node.find('a[href]:not([href*="doi.org"])').filter((_, link) => clean($(link).text()).length >= 5).length > 0) {
      return node;
    }
    node = node.parent();
  }
  return doiLink.parent();
}

export function parseCjournalCurrentHtml(source: SourceDef, html: string): RawArticle[] {
  const $ = load(html);
  const issue = issueMetadata(clean($.root().text()));
  const results: RawArticle[] = [];
  const seen = new Set<string>();

  $('a[href*="doi.org/"]').each((_, element) => {
    const doiLink = $(element);
    const doiUrl = doiLink.attr("href")?.trim() ?? "";
    const doi = doiUrl.match(/doi\.org\/(.+)$/i)?.[1];
    if (!doi) return;
    const container = articleContainer($, doiLink);
    const titleLink = container
      .find('a[href]:not([href*="doi.org"])')
      .filter((_, link) => clean($(link).text()).length >= 5)
      .first();
    const title = clean(titleLink.text());
    const href = titleLink.attr("href")?.trim();
    if (!title || !href) return;
    let url: string;
    try {
      url = new URL(href, source.url).toString();
    } catch {
      return;
    }
    if (new URL(url).hostname !== new URL(source.url).hostname || seen.has(url)) return;
    seen.add(url);
    results.push({
      sourceId: source.id,
      title,
      url,
      excerpt: [issue.label, `DOI: ${decodeURIComponent(doi)}`].filter(Boolean).join(" · "),
      publishedAt: issue.date,
      category: source.category,
      contentType: "metadata_only",
    });
  });
  return results;
}

export async function fetchCjournalCurrent(source: SourceDef): Promise<RawArticle[]> {
  const response = await fetch(source.url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; DailyBriefOBGYN/1.0)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseCjournalCurrentHtml(source, await response.text());
}
