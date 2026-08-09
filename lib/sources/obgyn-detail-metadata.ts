import fs from "node:fs";
import path from "node:path";

import { load } from "cheerio";

import type { ArticleInput } from "../ai/pipeline";
import { normalizeContentUrl } from "./obgyn-filter";
import { classifyDocumentType, hasSubstantiveContent, isHardExcluded } from "./content-policy";
import { OBGYN_REQUEST_HEADERS } from "./obgyn-pages";

const TARGET_SOURCE_IDS = new Set(["acog-news", "obgy-cn"]);
const CACHE_FILE = path.resolve("data/obgyn-detail-metadata-cache.json");
const CACHE_MS = 14 * 24 * 60 * 60 * 1000;
const EXCLUDED_RE = /\b(?:original|research) article\b|\b(?:systematic|scoping|umbrella) review\b|\bmeta[- ]analysis\b|\bcase (?:report|series)\b|\bprotocol\b|\b(?:randomi[sz]ed|clinical trial|cohort|case-control|cross-sectional)\b/iu;
const EXCLUDED_CN_RE = /原著|论著|系统综述|范围综述|伞状综述|荟萃分析|病例报告|研究方案/u;

export interface DetailMetadata {
  publishedAt?: Date;
  excerpt?: string;
  contentType?: string;
  contentTypeEvidence?: "metadata";
  dateModifiedFound?: boolean;
}

interface CachedDetailMetadata {
  expiresAt: number;
  publishedAt?: string;
  excerpt?: string;
  contentType?: string;
}

export interface ObgynDetailMetadataStats {
  requested: number;
  cacheHits: number;
  succeeded: number;
  failed: number;
  dateEnriched: number;
  excerptEnriched: number;
  typeEnriched: number;
}

export interface EnrichObgynDetailMetadataOptions {
  fetchHtml?: (url: string) => Promise<{ status: number; html: string }>;
  cache?: Map<string, CachedDetailMetadata>;
  cacheFile?: string;
  now?: Date;
  log?: (message: string) => void;
}

function validDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function explicitPublishedDate(text: string): Date | undefined {
  const match = text.match(/(?:news releases?|published|publication date|发布日期|发布时间)\s*(?:\||:)?\s*([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),?\s+(20\d{2})/i);
  if (!match) return undefined;
  const month = new Map([
    ["jan", 0], ["january", 0], ["feb", 1], ["february", 1], ["mar", 2], ["march", 2],
    ["apr", 3], ["april", 3], ["may", 4], ["jun", 5], ["june", 5], ["jul", 6], ["july", 6],
    ["aug", 7], ["august", 7], ["sep", 8], ["sept", 8], ["september", 8], ["oct", 9], ["october", 9],
    ["nov", 10], ["november", 10], ["dec", 11], ["december", 11],
  ]).get(match[1].toLowerCase());
  return month === undefined ? undefined : new Date(Date.UTC(Number(match[3]), month, Number(match[2])));
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function jsonLdObjects(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(jsonLdObjects);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  return [object, ...jsonLdObjects(object["@graph"])];
}

function firstString(...values: Array<unknown>): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return cleanText(value);
  }
  return undefined;
}

export function extractObgynDetailMetadata(html: string): DetailMetadata {
  const $ = load(html);
  const jsonLd = $("script[type='application/ld+json']").toArray().flatMap((element) => {
    try { return jsonLdObjects(JSON.parse($(element).text())); } catch { return []; }
  });
  $("nav, aside, footer, header, script, style, .cookie, [class*='cookie'], [class*='related'], [class*='recommend']").remove();
  const meta = (selector: string) => $(selector).first().attr("content")?.trim();
  const jsonDate = firstString(...jsonLd.map((entry) => entry.datePublished));
  const publishedAt = validDate(jsonDate)
    ?? validDate(meta("meta[property='article:published_time']"))
    ?? validDate(meta("meta[name='date']"))
    ?? validDate(meta("meta[name='DC.date'], meta[name='dc.date']"))
    ?? validDate(meta("meta[name='citation_publication_date']"))
    ?? validDate(meta("meta[name='citation_date']"))
    ?? validDate($("time[datetime]").first().attr("datetime"))
    ?? explicitPublishedDate(cleanText($("article, main, .article-meta, .news-date, [class*='publish']").text()));
  const dateModifiedFound = Boolean(firstString(...jsonLd.map((entry) => entry.dateModified)));

  const excerpt = firstString(
    ...jsonLd.map((entry) => entry.description),
    meta("meta[name='description']"),
    meta("meta[property='og:description']"),
    meta("meta[name='twitter:description']"),
    meta("meta[name='citation_abstract']"),
    $(".abstract, .summary, .lead, .standfirst, [class*='abstract'], [class*='summary'], [class*='lead']").first().text(),
    $("article, main").first().text(),
  );
  const contentType = firstString(
    meta("meta[name='citation_article_type']"),
    meta("meta[name='prism.section']"),
    ...jsonLd.map((entry) => entry.articleSection),
    $(".breadcrumb, .category, .article-category, [rel='category tag']").first().text(),
  );
  return {
    publishedAt,
    excerpt: excerpt && excerpt.length >= 30 ? excerpt.slice(0, 1200) : undefined,
    contentType: contentType?.replace(/\s*\|\s*(?:[A-Z][a-z]{2,8})\.?\s+\d{1,2},?\s+20\d{2}\s*$/i, ""),
    contentTypeEvidence: contentType ? "metadata" : undefined,
    dateModifiedFound,
  };
}

function loadFileCache(file: string, now: Date): Map<string, CachedDetailMetadata> {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, CachedDetailMetadata>;
    return new Map(Object.entries(parsed).filter(([, value]) => value.expiresAt > now.getTime()));
  } catch { return new Map(); }
}

function saveFileCache(file: string, cache: Map<string, CachedDetailMetadata>): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(Object.fromEntries(cache), null, 2)}\n`, "utf8");
  } catch { /* cache writes must never block a report */ }
}

function needsEnrichment(article: ArticleInput): boolean {
  const invalidDate = !article.publishedAt || Number.isNaN(article.publishedAt.getTime());
  return invalidDate || !hasSubstantiveContent(article) || !article.contentType || classifyDocumentType(article) === "unknown";
}

function eligible(article: ArticleInput): boolean {
  if (!TARGET_SOURCE_IDS.has(article.sourceId) || !needsEnrichment(article) || isHardExcluded(article)) return false;
  if (!/^https?:\/\//i.test(article.url)) return false;
  const text = [article.title, article.contentType, article.documentType].filter(Boolean).join("\n");
  return !EXCLUDED_RE.test(text) && !EXCLUDED_CN_RE.test(text);
}

function merge(article: ArticleInput, metadata: DetailMetadata): ArticleInput {
  return {
    ...article,
    publishedAt: article.publishedAt ?? metadata.publishedAt,
    excerpt: hasSubstantiveContent(article) ? article.excerpt : (metadata.excerpt ?? article.excerpt),
    contentType: article.contentType || metadata.contentType,
    contentTypeEvidence: article.contentTypeEvidence ?? metadata.contentTypeEvidence,
  };
}

async function fetchWithRetry(url: string, fetchHtml: NonNullable<EnrichObgynDetailMetadataOptions["fetchHtml"]>): Promise<{ status: number; html: string }> {
  let last: { status: number; html: string } | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      last = await fetchHtml(url);
      if (last.status === 200) return last;
    } catch { /* one retry */ }
  }
  return last ?? { status: 0, html: "" };
}

export async function enrichObgynDetailMetadata(
  articles: ArticleInput[],
  options: EnrichObgynDetailMetadataOptions = {},
): Promise<{ articles: ArticleInput[]; stats: ObgynDetailMetadataStats }> {
  const now = options.now ?? new Date();
  const log = options.log ?? console.log;
  const cache = options.cache ?? loadFileCache(options.cacheFile ?? CACHE_FILE, now);
  const fetchHtml = options.fetchHtml ?? (async (url: string) => {
    const response = await fetch(url, {
      headers: OBGYN_REQUEST_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    return { status: response.status, html: await response.text() };
  });
  const stats: ObgynDetailMetadataStats = { requested: 0, cacheHits: 0, succeeded: 0, failed: 0, dateEnriched: 0, excerptEnriched: 0, typeEnriched: 0 };
  const byUrl = new Map<string, DetailMetadata>();
  const candidates = articles.filter(eligible).filter((article) => {
    const key = normalizeContentUrl(article.url);
    if (byUrl.has(key)) return false;
    byUrl.set(key, {});
    return true;
  }).slice(0, 16);

  const perSource = new Map<string, number>();
  const limited = candidates.filter((article) => {
    const count = perSource.get(article.sourceId) ?? 0;
    if (count >= 8) return false;
    perSource.set(article.sourceId, count + 1);
    return true;
  });
  const queue = [...limited];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const article = queue.shift();
      if (!article) return;
      const key = normalizeContentUrl(article.url);
      const cached = cache.get(key);
      if (cached && cached.expiresAt > now.getTime()) {
        stats.cacheHits += 1;
        byUrl.set(key, { publishedAt: validDate(cached.publishedAt), excerpt: cached.excerpt, contentType: cached.contentType, contentTypeEvidence: cached.contentType ? "metadata" : undefined });
        log(`[detail] detail_cache_hit ${article.sourceId}`);
        continue;
      }
      stats.requested += 1;
      log(`[detail] detail_fetch_requested ${article.sourceId}`);
      const response = await fetchWithRetry(article.url, fetchHtml);
      if (response.status !== 200) {
        stats.failed += 1;
        log(`[detail] detail_fetch_failed ${article.sourceId} ${response.status || "network"}`);
        log(`[detail] per_source_failure_reason ${article.sourceId} ${response.status || "network"}`);
        continue;
      }
      const metadata = extractObgynDetailMetadata(response.html);
      if (!metadata.publishedAt && !metadata.excerpt && !metadata.contentType) {
        stats.failed += 1;
        log(`[detail] detail_fetch_failed ${article.sourceId} non_article_page`);
        log(`[detail] per_source_failure_reason ${article.sourceId} non_article_page`);
        continue;
      }
      stats.succeeded += 1;
      if (!article.publishedAt && metadata.publishedAt) stats.dateEnriched += 1;
      if (!article.publishedAt && metadata.publishedAt) log(`[detail] date_enriched ${article.sourceId}`);
      if (metadata.dateModifiedFound) log(`[detail] date_modified_found ${article.sourceId}`);
      if (!hasSubstantiveContent(article) && metadata.excerpt) {
        stats.excerptEnriched += 1;
        log(`[detail] excerpt_enriched ${article.sourceId}`);
      }
      if (!article.contentType && metadata.contentType) {
        stats.typeEnriched += 1;
        log(`[detail] type_enriched ${article.sourceId}`);
      }
      byUrl.set(key, metadata);
      cache.set(key, { expiresAt: now.getTime() + CACHE_MS, publishedAt: metadata.publishedAt?.toISOString(), excerpt: metadata.excerpt, contentType: metadata.contentType });
      log(`[detail] detail_fetch_success ${article.sourceId}`);
      log(`[detail] per_source_success ${article.sourceId}`);
    }
  });
  await Promise.all(workers);
  if (!options.cache) saveFileCache(options.cacheFile ?? CACHE_FILE, cache);
  return { articles: articles.map((article) => merge(article, byUrl.get(normalizeContentUrl(article.url)) ?? {})), stats };
}
