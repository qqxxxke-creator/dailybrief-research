import { createHash } from "node:crypto";

import { REPORT_LOCALE } from "../sources/registry";
import {
  computeResearchWindow,
  loadResearchCache,
  mergeResearchCache,
  saveResearchCacheAtomic,
} from "./cache";
import { loadResearchConfig } from "./config";
import { dedupeResearchPapers } from "./normalize";
import { selectResearchPapers } from "./scoring";
import { fetchJournalRssPapers } from "./sources/journal-rss";
import { fetchPubMedPapers } from "./sources/pubmed";
import { summarizeResearchPapers } from "./summarize";
import type {
  ResearchCache,
  ResearchConfig,
  ResearchFetchResult,
  ResearchPaper,
  ResearchSection,
  ResearchSourceConfig,
} from "./types";

interface FetchContext {
  config: ResearchConfig;
  from: Date;
  to: Date;
}

export interface ResearchDeps {
  now?: () => Date;
  loadConfig?: () => ResearchConfig;
  loadCache?: (clearCache: boolean) => ResearchCache;
  saveCache?: (cache: ResearchCache) => void;
  fetchSource?: (
    source: ResearchSourceConfig,
    context: FetchContext,
  ) => Promise<ResearchFetchResult>;
  summarize?: (papers: ResearchPaper[]) => Promise<ResearchPaper[]>;
  warn?: (message: string) => void;
}

export interface ResearchDryRunResult {
  from: string;
  to: string;
  successfulSources: number;
  failedSources: number;
  sourceResults: Array<{
    sourceId: string;
    ok: boolean;
    fetched: number;
    rejected: Record<string, number>;
    error?: string;
  }>;
  fetchedCount: number;
  dedupedCount: number;
  candidates: ResearchPaper[];
}

export function researchSummaryFingerprint(paper: ResearchPaper): string {
  const payload = {
    title: paper.title,
    abstract: paper.abstract,
    journal: paper.journal,
    authors: [...paper.authors].sort(),
    publicationTypes: [...paper.publicationTypes].sort(),
    publishedAt: paper.publishedAt,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

async function defaultFetchSource(
  source: ResearchSourceConfig,
  context: FetchContext,
): Promise<ResearchFetchResult> {
  if (source.kind === "pubmed") {
    return fetchPubMedPapers({
      topics: context.config.topics,
      from: context.from,
      to: context.to,
      baseUrl: source.url,
      apiKey: process.env.NCBI_API_KEY,
      email: process.env.NCBI_EMAIL,
    });
  }
  return fetchJournalRssPapers({ source, from: context.from, to: context.to });
}

async function discover(
  config: ResearchConfig,
  from: Date,
  to: Date,
  deps: ResearchDeps,
): Promise<{
  successes: ResearchFetchResult[];
  sourceResults: ResearchDryRunResult["sourceResults"];
}> {
  const fetchSource = deps.fetchSource ?? defaultFetchSource;
  const warn = deps.warn ?? console.warn;
  const sources = config.sources.filter((source) => source.enabled);
  const settled = await Promise.all(
    sources.map(async (source) => {
      try {
        const result = await fetchSource(source, { config, from, to });
        return {
          result,
          status: {
            sourceId: source.id,
            ok: true,
            fetched: result.papers.length,
            rejected: result.rejected,
          },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`[research] source ${source.id} failed: ${message}`);
        return {
          status: {
            sourceId: source.id,
            ok: false,
            fetched: 0,
            rejected: {},
            error: message,
          },
        };
      }
    }),
  );
  return {
    successes: settled.flatMap((entry) => (entry.result ? [entry.result] : [])),
    sourceResults: settled.map((entry) => entry.status),
  };
}

function dailySignal(papers: ResearchPaper[]): string {
  if (papers.length === 0) {
    return REPORT_LOCALE === "en"
      ? "No newly indexed paper met today's evidence and relevance threshold."
      : "今日暂无同时达到相关性、证据等级和新近性阈值的新论文。";
  }
  const titles = papers.slice(0, 3).map((paper) => paper.summaryZh?.titleZh ?? paper.title);
  return REPORT_LOCALE === "en"
    ? `${papers.length} research paper(s) met today's threshold, led by ${titles.join("; ")}. Interpret individual studies in context rather than as guideline recommendations.`
    : `今日共筛选出${papers.length}篇达到阈值的研究，重点涉及${titles.join("、")}。以下内容用于研究情报追踪，单篇论文结论不等同于指南建议。`;
}

function dataAsOf(cache: ResearchCache, papers: ResearchPaper[], now: Date): string {
  if (cache.lastSuccessfulRun) return cache.lastSuccessfulRun;
  const latest = papers
    .map((paper) => paper.activityAt)
    .filter((value) => Number.isFinite(Date.parse(value)))
    .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  return latest ?? now.toISOString();
}

export async function runResearchIntelligence(
  deps: ResearchDeps = {},
): Promise<ResearchSection | undefined> {
  const config = (deps.loadConfig ?? loadResearchConfig)();
  if (!config.runtime.enabled) return undefined;

  const now = (deps.now ?? (() => new Date()))();
  const cache = (deps.loadCache ?? ((clear) => loadResearchCache(undefined, clear)))(
    config.runtime.clearCache,
  );
  const window = computeResearchWindow(cache, now, config.runtime);
  const discovery = await discover(config, window.from, window.to, deps);

  if (discovery.successes.length === 0) {
    const papers = selectResearchPapers(cache.papers, config, now);
    return {
      generatedAt: now.toISOString(),
      dataAsOf: dataAsOf(cache, papers, now),
      isCachedFallback: true,
      dailySignal: dailySignal(papers),
      papers,
    };
  }

  const fetched = discovery.successes.flatMap((result) => result.papers);
  const merged = mergeResearchCache({
    previous: cache,
    fetched,
    successfulSourceCount: discovery.successes.length,
    now,
    retentionDays: config.runtime.cacheDays,
  });
  const selected = selectResearchPapers(merged.papers, config, now);
  const needsSummary = selected.filter(
    (paper) =>
      paper.summaryStatus !== "success" ||
      !paper.summaryZh ||
      paper.summaryInputHash !== researchSummaryFingerprint(paper),
  );
  let newlySummarized: ResearchPaper[] = [];
  if (needsSummary.length > 0) {
    try {
      newlySummarized = await (deps.summarize ?? summarizeResearchPapers)(needsSummary);
    } catch {
      newlySummarized = needsSummary.map((paper) => ({ ...paper, summaryStatus: "failed" }));
    }
  }
  const summarizedById = new Map(
    newlySummarized.map((paper) => [
      paper.id,
      paper.summaryStatus === "success"
        ? { ...paper, summaryInputHash: researchSummaryFingerprint(paper) }
        : paper,
    ]),
  );
  const papers = selected.map((paper) => summarizedById.get(paper.id) ?? paper);
  const finalCache = mergeResearchCache({
    previous: merged,
    fetched: papers,
    successfulSourceCount: 0,
    now,
    retentionDays: config.runtime.cacheDays,
  });
  (deps.saveCache ?? saveResearchCacheAtomic)(finalCache);

  return {
    generatedAt: now.toISOString(),
    dataAsOf: dataAsOf(finalCache, papers, now),
    isCachedFallback: false,
    dailySignal: dailySignal(papers),
    papers,
  };
}

export async function runResearchDryRun(
  deps: ResearchDeps = {},
): Promise<ResearchDryRunResult> {
  const config = (deps.loadConfig ?? loadResearchConfig)();
  const now = (deps.now ?? (() => new Date()))();
  const window = computeResearchWindow({ schemaVersion: 1, papers: [] }, now, config.runtime);
  const discovery = await discover(config, window.from, window.to, deps);
  const fetched = discovery.successes.flatMap((result) => result.papers);
  const deduped = dedupeResearchPapers(fetched);
  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    successfulSources: discovery.successes.length,
    failedSources: discovery.sourceResults.length - discovery.successes.length,
    sourceResults: discovery.sourceResults,
    fetchedCount: fetched.length,
    dedupedCount: deduped.length,
    candidates: selectResearchPapers(deduped, config, now),
  };
}
