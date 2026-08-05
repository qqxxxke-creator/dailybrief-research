import "./_env";

import fs from "node:fs";
import path from "node:path";

import { sources, REPORT_LOCALE } from "../lib/sources/registry";
import { fetchSource } from "../lib/sources/dispatch";
import {
  generateDailyReport,
  type ArticleInput,
} from "../lib/ai/pipeline";
import { getModelTag, validateBackendCredentials } from "../lib/ai/llm";
import {
  enrichFinanceNewsSummaries,
  enrichGithubTrendingSummaries,
  enrichTrendingPapersSummaries,
  enrichXViralSummaries,
} from "../lib/ai/enrich";
import {
  groupRaw,
  isSportsArticle,
  MERGED_SUBGROUP_LIMITS,
  renderHtml,
  renderMarkdown,
} from "../lib/output/render";
import { analyzeWatchlist } from "../lib/trading/runner";
import { fetchCryptoFearGreed } from "../lib/trading/fear-greed";
import { fetchCryptoGlobal } from "../lib/trading/coingecko";
import { generateTradingCommentary } from "../lib/ai/trading-commentary";
import type { TradingSection } from "../lib/ai/pipeline";
import { todayKey } from "../lib/utils";
import { runResearchSafely } from "../lib/research/integration";
import { runResearchIntelligence } from "../lib/research/runner";
import { loadPreviouslyShownResearchKeys } from "../lib/research/history";
import {
  filterObgynCandidatesWithStats,
  findLlmRejectedObgynArticles,
  normalizeContentUrl,
  selectSupplementalObgynArticles,
  type ObgynFilterRejection,
} from "../lib/sources/obgyn-filter";
import {
  filterPreviouslyPublishedArticlesWithStats,
  toDisplayedArticleRecords,
} from "../lib/sources/guideline-history";
import { reviewObgynCandidates } from "../lib/ai/enrich";

const OUTPUT_DIR = "daily_reports";

async function fetchAll(): Promise<{ articles: ArticleInput[]; successfulSources: number }> {
  const articles: ArticleInput[] = [];
  let successfulSources = 0;
  const enabled = sources.filter((s) => s.enabled !== false);
  for (const source of enabled) {
    try {
      const items = await fetchSource(source);
      successfulSources += 1;
      console.log(`  ${source.id.padEnd(20)} ${items.length}`);
      articles.push(...items.map((it) => ({ ...it, source: source.name })));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  ${source.id.padEnd(20)} WARNING — ${msg}`);
    }
  }
  return { articles, successfulSources };
}

async function enrichGhTrending(articles: ArticleInput[]): Promise<void> {
  const gh = articles.filter((a) => a.sourceId === "github-trending");
  if (gh.length === 0) return;
  console.log(
    `[daily] enriching ${gh.length} GitHub Trending repos with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichGithubTrendingSummaries(gh);
  for (const a of gh) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${gh.length}`,
  );
}

/**
 * finance:news is rendered as a merged time-sorted list (see
 * MERGED_SUBGROUP_LIMITS in render.ts). Enrich exactly the items that
 * will be displayed: take all enabled finance:news articles, sort by
 * publishedAt desc, slice to the merge limit, ask Sonnet for Chinese
 * factual summaries.
 */
async function enrichFinanceNews(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "finance", "news");
}

async function enrichPolitics(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "politics", "world");
}

async function enrichAiNews(articles: ArticleInput[]): Promise<void> {
  await enrichMergedSubgroup(articles, "tech", "ai-news");
}

/**
 * X 热帖 enrichment is different from merged subgroups — we preserve the
 * AttentionVC API's heat-rank order (do NOT sort by date) and cap to the
 * displayed limit (matches SOURCE_DISPLAY_LIMITS["tech:x-viral"]).
 *
 * The Sonnet prompt also differs (XVIRAL_SYSTEM_PROMPT in enrich.ts) — X
 * tweet titles are clickbait, the previewText holds the actual claim.
 */
async function enrichXViral(articles: ArticleInput[]): Promise<void> {
  const xPosts = articles
    .filter((a) => a.sourceId === "attentionvc-ai")
    .slice(0, 20);
  if (xPosts.length === 0) return;
  console.log(`[daily] enriching ${xPosts.length} X posts with ${REPORT_LOCALE} summaries…`);
  const t0 = Date.now();
  // Author handle is encoded in the URL (https://x.com/{handle}/status/{id})
  // — extract it to help the model identify whose claim it is.
  const summaries = await enrichXViralSummaries(
    xPosts.map((a) => ({
      url: a.url,
      title: a.title,
      excerpt: a.excerpt,
      author: a.url.match(/x\.com\/([^/]+)\//)?.[1] ?? "",
    })),
  );
  for (const a of xPosts) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${xPosts.length}`,
  );
}

/**
 * Trending papers enrichment — preserves the fetcher's upvote-desc order
 * (huggingface-papers is in PRESERVE_FETCH_ORDER_SOURCES) and caps to the
 * displayed limit (matches SOURCE_DISPLAY_LIMITS["tech:trending-papers"]).
 */
async function enrichTrendingPapers(articles: ArticleInput[]): Promise<void> {
  const papers = articles
    .filter((a) => a.sourceId === "huggingface-papers")
    .slice(0, 20);
  if (papers.length === 0) return;
  console.log(
    `[daily] enriching ${papers.length} trending papers with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichTrendingPapersSummaries(
    papers.map((a) => ({ url: a.url, title: a.title, excerpt: a.excerpt })),
  );
  for (const a of papers) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${papers.length}`,
  );
}

/**
 * Shared implementation for "merged subgroup" enrichment: collect all
 * enabled articles in (category, subcategory), sort by date desc, take
 * the display cap (from MERGED_SUBGROUP_LIMITS), and ask the LLM to
 * summarize them into REPORT_LOCALE in a single batch. Symmetric to the
 * merge logic in render.ts groupRaw, so display and enrichment stay aligned.
 *
 * Sources whose `lang` already matches REPORT_LOCALE are skipped — no
 * point translating English to English (en mode) or Chinese to Chinese
 * (zh mode).
 */
async function enrichMergedSubgroup(
  articles: ArticleInput[],
  category: "tech" | "finance" | "politics",
  subcategory: string,
): Promise<void> {
  const subSources = sources.filter(
    (s) =>
      s.category === category &&
      s.subcategory === subcategory &&
      s.enabled !== false,
  );
  const enabledIds = new Set(subSources.map((s) => s.id));
  const sameLocaleIds = new Set(
    subSources.filter((s) => (s.lang ?? "en") === REPORT_LOCALE).map((s) => s.id),
  );
  const limit = MERGED_SUBGROUP_LIMITS[`${category}:${subcategory}`] ?? 12;
  // Top-N respects all enabled sources (so we don't reshape the merged
  // timeline). Enrichment only targets items NOT already in the target
  // language within that slice.
  const top = articles
    .filter((a) => enabledIds.has(a.sourceId))
    .filter((a) => category !== "politics" || !isSportsArticle(a.title))
    .sort(
      (a, b) =>
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    )
    .slice(0, limit);
  const toEnrich = top.filter((a) => !sameLocaleIds.has(a.sourceId));
  if (toEnrich.length === 0) return;
  console.log(
    `[daily] enriching ${toEnrich.length}/${top.length} ${category}:${subcategory} items with ${REPORT_LOCALE} summaries…`,
  );
  const t0 = Date.now();
  const summaries = await enrichFinanceNewsSummaries(toEnrich);
  for (const a of toEnrich) {
    const s = summaries.get(a.url);
    if (s) a.summary = s;
  }
  console.log(
    `[daily] enrichment done in ${((Date.now() - t0) / 1000).toFixed(1)}s, matched ${summaries.size}/${toEnrich.length}`,
  );
}

/**
 * Pull daily OHLCV from Yahoo for every ticker in the watchlist, compute
 * indicators + signals, then ask Sonnet for a market overview + a
 * picks-to-watch list. Returns null if no ticker came back.
 */
async function runTrading(): Promise<TradingSection | null> {
  console.log(`[daily] analyzing watchlist + crypto context (Yahoo / alt.me / CoinGecko)…`);
  const t0 = Date.now();
  const [tickers, cryptoFearGreed, cryptoGlobal] = await Promise.all([
    analyzeWatchlist(),
    fetchCryptoFearGreed(),
    fetchCryptoGlobal(),
  ]);
  console.log(
    `[daily] indicators ready in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${tickers.length} tickers` +
      (cryptoFearGreed ? `, F&G ${cryptoFearGreed.value}` : ", F&G ✗") +
      (cryptoGlobal
        ? `, BTC dom ${cryptoGlobal.btcDominance.toFixed(1)}%`
        : ", CG ✗"),
  );
  if (tickers.length === 0) return null;
  console.log(`[daily] generating trading commentary with ${getModelTag()}…`);
  const t1 = Date.now();
  const commentary = await generateTradingCommentary({
    tickers,
    cryptoFearGreed: cryptoFearGreed ?? undefined,
    cryptoGlobal: cryptoGlobal ?? undefined,
  });
  console.log(
    `[daily] trading commentary ready in ${((Date.now() - t1) / 1000).toFixed(1)}s`,
  );
  return {
    ...commentary,
    tickers,
    crypto_fear_greed: cryptoFearGreed ?? undefined,
    crypto_global: cryptoGlobal ?? undefined,
    generated_at: new Date().toISOString(),
  };
}

async function main() {
  // Fail fast on misconfigured backend before we spend 30s fetching
  // 500+ articles only to discover the LLM has no credentials.
  validateBackendCredentials();

  const date = todayKey();
  console.log(`[daily] ${date} — fetching sources…\n`);
  const { articles: fetched, successfulSources } = await fetchAll();
  if (successfulSources === 0) {
    throw new Error("all enabled OB-GYN news sources failed; refusing to publish a false empty report");
  }
  console.log(`\n[daily] fetched articles: ${fetched.length}`);
  const filtered = filterObgynCandidatesWithStats(fetched, sources);
  const filterStats = filtered.stats;
  console.log(
    `[daily] OB-GYN rule filter: passed=${filterStats.accepted}, rejected=${filterStats.rejected}, total=${filterStats.total}`,
  );
  console.log(
    `[daily] rule rejects: window=${filterStats.outsideTimeWindow}, not_obgyn=${filterStats.notObgyn}, content_type=${filterStats.unsupportedContentType}, missing_content=${filterStats.missingContent}, promotional=${filterStats.promotional}, invalid=${filterStats.invalidItem}, source=${filterStats.sourceExcluded}, duplicate=${filterStats.duplicate}`,
  );

  const priorityHistory = filterPreviouslyPublishedArticlesWithStats(filtered.priorityArticles, OUTPUT_DIR, date);
  const supplementalHistory = filterPreviouslyPublishedArticlesWithStats(filtered.supplementalArticles, OUTPUT_DIR, date);
  const priorityArticles = priorityHistory.articles;
  const supplementalArticles = supplementalHistory.articles;
  const historyRejections = [...priorityHistory.rejections, ...supplementalHistory.rejections];
  const historyRejectedByUrl = priorityHistory.rejectedByUrl + supplementalHistory.rejectedByUrl;
  const historyRejectedByTitle = priorityHistory.rejectedByTitle + supplementalHistory.rejectedByTitle;
  const historyRejectedByDoi = priorityHistory.rejectedByDoi + supplementalHistory.rejectedByDoi;
  const historyRejectedByPmid = priorityHistory.rejectedByPmid + supplementalHistory.rejectedByPmid;
  const historyRejected = historyRejectedByUrl + historyRejectedByTitle + historyRejectedByDoi + historyRejectedByPmid;
  console.log(`[daily] article history: passed=${priorityArticles.length + supplementalArticles.length}, rejected=${historyRejected}, total=${filtered.articles.length}`);

  const priorityAccepted = await reviewObgynCandidates(priorityArticles);
  let supplementalAccepted: ArticleInput[] = [];
  if (priorityAccepted.length < 10 && supplementalArticles.length > 0) {
    supplementalAccepted = await reviewObgynCandidates(supplementalArticles);
  }
  const articles = selectSupplementalObgynArticles(priorityAccepted, supplementalAccepted, 10, 15, sources);
  const llmReviewed = priorityArticles.length
    + (priorityAccepted.length < 10 ? supplementalArticles.length : 0);
  const llmAccepted = priorityAccepted.length + supplementalAccepted.length;
  const llmRejected = llmReviewed - llmAccepted;
  const supplementalAcceptedUrls = new Set(supplementalAccepted.map((article) => normalizeContentUrl(article.url)));
  const supplementalSelectedCount = articles.filter(
    (article) => supplementalAcceptedUrls.has(normalizeContentUrl(article.url)),
  ).length;
  const prioritySelectedCount = articles.length - supplementalSelectedCount;
  console.log(`[daily] OB-GYN semantic review: passed=${llmAccepted}, rejected=${llmRejected}, total=${llmReviewed}`);
  console.log(`[daily] window selection: priority=${prioritySelectedCount}, supplemental=${supplementalSelectedCount}, final=${articles.length}`);
  console.log(
    `[daily] pipeline stats: fetched_total=${fetched.length}, deterministic_accepted=${filtered.articles.length}, history_rejected_by_url=${historyRejectedByUrl}, history_rejected_by_title=${historyRejectedByTitle}, history_rejected_by_doi=${historyRejectedByDoi}, history_rejected_by_pmid=${historyRejectedByPmid}, semantic_accepted=${llmAccepted}, semantic_rejected=${llmRejected}, priority_selected=${prioritySelectedCount}, supplemental_pool=${supplementalArticles.length}, supplemental_selected=${supplementalSelectedCount}, final_displayed=${articles.length}`,
  );

  if (historyRejected >= 20) {
    console.warn(`[daily] history rejection samples (${Math.min(historyRejections.length, 20)}/20 max):`);
    for (const rejection of historyRejections.slice(0, 20)) {
      console.warn(
        `  ${rejection.matchedBy} | ${rejection.matchedHistoryDate} | ${rejection.article.source} | ${rejection.article.title.slice(0, 140)}`,
      );
    }
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const columnCounts = {
    guidelines: articles.filter((article) => article.category === "tech").length,
    surgery: articles.filter((article) => article.category === "finance").length,
    international: articles.filter((article) => {
      const source = sourceById.get(article.sourceId);
      return article.category === "politics"
        && source?.subcategory !== "china-obgyn"
        && source?.lang !== "zh";
    }).length,
    china: articles.filter((article) => {
      const source = sourceById.get(article.sourceId);
      return article.category === "politics"
        && (source?.subcategory === "china-obgyn" || source?.lang === "zh");
    }).length,
  };
  console.log(`[daily] column counts: guidelines=${columnCounts.guidelines}, surgery=${columnCounts.surgery}, international=${columnCounts.international}, china=${columnCounts.china}`);

  if (articles.length < 3) {
    const historyKept = new Set([...priorityArticles, ...supplementalArticles]);
    const reviewedArticles = [
      ...priorityArticles,
      ...(priorityAccepted.length < 10 ? supplementalArticles : []),
    ];
    const rejectionSamples: ObgynFilterRejection[] = [
      ...filtered.rejections,
      ...filtered.articles
        .filter((article) => !historyKept.has(article))
        .map((article) => ({ title: article.title, sourceId: article.sourceId, reason: "duplicate" as const })),
      ...findLlmRejectedObgynArticles(
        reviewedArticles,
        [...priorityAccepted, ...supplementalAccepted],
      ),
    ].slice(0, 20);
    console.warn(`[daily] rejection samples (${rejectionSamples.length}/20 max):`);
    for (const sample of rejectionSamples) {
      console.warn(`  ${sample.reason} | ${sample.sourceId} | ${sample.title.slice(0, 140)}`);
    }
  }

  // Research Intelligence is isolated from the news digest. Source, cache,
  // or summarization failures must never prevent the morning brief shipping.
  const research = await runResearchSafely(() => runResearchIntelligence({
    loadShownKeys: () => loadPreviouslyShownResearchKeys(OUTPUT_DIR, date),
  }));

  console.log(`[daily] generating digest with ${getModelTag()}…`);
  const t0 = Date.now();
  const { report } = await generateDailyReport(articles);
  if (research) report.research = research;
  console.log(`[daily] digest ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const dateDir = path.join(OUTPUT_DIR, date);
  fs.mkdirSync(dateDir, { recursive: true });
  const base = path.join(dateDir, date);
  const raw = groupRaw(articles, sources);
  fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2), "utf8");
  // Sidecar with all fetched articles + LLM-attached summary, so
  // scripts/render.ts can rebuild HTML/MD for UI iteration without
  // re-fetching or re-calling the LLM.
  fs.writeFileSync(
    `${base}-articles.json`,
    JSON.stringify({ date, articles }, null, 2),
    "utf8",
  );
  fs.writeFileSync(`${base}.html`, renderHtml(report, raw, date), "utf8");
  fs.writeFileSync(
    `${base}-displayed.json`,
    JSON.stringify(toDisplayedArticleRecords(articles), null, 2),
    "utf8",
  );
  if (process.env.OUTPUT_MARKDOWN === "true") {
    fs.writeFileSync(`${base}.md`, renderMarkdown(report, date, raw), "utf8");
    console.log(`[daily] wrote ${base}.{json,html,md,articles.json,displayed.json}`);
  } else {
    console.log(`[daily] wrote ${base}.{json,html,articles.json,displayed.json}`);
  }

  console.log(`[daily] done.`);
}

main().catch((e) => {
  console.error(`[daily] FAILED:`, e);
  process.exit(1);
});
