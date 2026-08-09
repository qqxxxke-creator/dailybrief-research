import { load } from "cheerio";

import type { RawArticle, SourceDef } from "./types";
import { OBGYN_REQUEST_HEADERS } from "./obgyn-pages";

const COG_ALLOWED = /指南|共识|核心推荐|临床实践建议|诊疗规范|专家述评|手术技术|手术感染|并发症(?:防控|防治)/u;
const COG_REJECTED = /会议|征稿|报名|培训|课程|直播|科普|医院|名医|专家风采|商业|推广|研究(?:发现|进展|新闻)|队列|回顾性|病例报告|论著/u;
const JOURNAL_ALLOWED = /^(?:述评|专家共识|指南|诊疗规范|指南解读|共识解读|临床实践建议)$/u;
const JOURNAL_REJECTED = /论著|普通综述|系统综述|Meta|荟萃分析|病例报告|临床研究|基础研究|回顾性|队列|Original Article/u;

function text(value: string): string { return value.replace(/\s+/g, " ").trim(); }
function date(value: string | undefined): Date | undefined {
  const match = value?.match(/(20\d{2})[-/.年](\d{1,2})[-/.月](\d{1,2})/u);
  if (!match) return undefined;
  const parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function cogRoute(title: string): Pick<RawArticle, "category" | "contentType" | "documentType"> | undefined {
  if (!COG_ALLOWED.test(title) || COG_REJECTED.test(title)) return undefined;
  if (/手术|并发症/u.test(title)) return { category: "finance", contentType: "complication_prevention", documentType: "education" };
  if (/指南解读/u.test(title)) return { category: "tech", contentType: "guideline_interpretation", documentType: "guideline" };
  if (/共识/u.test(title)) return { category: "tech", contentType: "consensus", documentType: "consensus" };
  if (/指南|规范/u.test(title)) return { category: "tech", contentType: "guideline", documentType: "guideline" };
  return { category: "politics", contentType: "clinical_practice_recommendation", documentType: "news" };
}

export function parseCogonlineGuidanceHtml(source: SourceDef, html: string): RawArticle[] {
  const $ = load(html); const items: RawArticle[] = []; const seen = new Set<string>();
  $("li").each((_, element) => {
    const link = $(element).find("a[href*='/info/']").first();
    const title = text(link.text()); const route = cogRoute(title);
    if (!route) return;
    let url: string; try { url = new URL(link.attr("href") ?? "", source.url).toString(); } catch { return; }
    if (new URL(url).hostname !== new URL(source.url).hostname || seen.has(url)) return;
    const publishedAt = date(text($(element).find("p, time").first().text()) || $(element).find("time").attr("datetime"));
    if (!publishedAt) return;
    seen.add(url); items.push({ sourceId: source.id, title, url, publishedAt, ...route, contentTypeEvidence: "declared" });
  });
  return items.slice(0, 8);
}

function journalRoute(section: string): Pick<RawArticle, "category" | "contentType" | "documentType"> | undefined {
  if (!JOURNAL_ALLOWED.test(section) || JOURNAL_REJECTED.test(section)) return undefined;
  if (section === "述评") return { category: "politics", contentType: "expert_commentary", documentType: "news" };
  if (section === "专家共识" || section === "共识解读") return { category: "tech", contentType: "consensus", documentType: "consensus" };
  return { category: "tech", contentType: section.includes("解读") ? "guideline_interpretation" : "guideline", documentType: "guideline" };
}

export function parseObgyncnProfessionalHtml(source: SourceDef, html: string): RawArticle[] {
  const $ = load(html); const issueDate = date(text($(".issue-date, .publish-date, [class*='issueDate']").first().text())); const items: RawArticle[] = [];
  $("article, .article-item, .article-list > li, .list-item").each((_, element) => {
    const node = $(element); const section = text(node.find(".section, .column, .article-type, [class*='section']").first().text()); const route = journalRoute(section);
    if (!route) return;
    const link = node.find("a.title, h3 a, h2 a, a[href*='/CN/']").first(); const title = text(link.text());
    if (!title || JOURNAL_REJECTED.test(`${section} ${title}`)) return;
    let url: string; try { url = new URL(link.attr("href") ?? "", source.url).toString(); } catch { return; }
    const ownDate = date(node.find("time").attr("datetime") ?? text(node.find("time, .date, [class*='date']").first().text()));
    const excerpt = text(node.find(".abstract, [class*='abstract'], .summary").first().text());
    const doi = text(node.find(".doi, [class*='doi']").first().text()).match(/10\.\d{4,9}\/\S+/i)?.[0];
    const authors = text(node.find(".authors, [class*='author']").first().text());
    items.push({ sourceId: source.id, title, url, publishedAt: ownDate ?? issueDate, excerpt: excerpt || undefined, meta: [doi, authors].filter(Boolean).join(" · ") || undefined, ...route, contentTypeEvidence: "declared" });
  });
  return items.slice(0, 8);
}

async function fetchHtml(url: string, fetchImpl: typeof fetch): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchImpl(url, { headers: OBGYN_REQUEST_HEADERS, signal: AbortSignal.timeout(15_000) });
      if (response.ok) return await response.text();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
  }
  throw lastError instanceof Error ? lastError : new Error("source fetch failed");
}

export async function fetchCogonlineGuidance(source: SourceDef, fetchImpl: typeof fetch = fetch): Promise<RawArticle[]> {
  return parseCogonlineGuidanceHtml(source, await fetchHtml(source.url, fetchImpl));
}
export async function fetchObgyncnProfessional(source: SourceDef, fetchImpl: typeof fetch = fetch): Promise<RawArticle[]> {
  return parseObgyncnProfessionalHtml(source, await fetchHtml(source.url, fetchImpl));
}
