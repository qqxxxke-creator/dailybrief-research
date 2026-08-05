import assert from "node:assert/strict";
import test from "node:test";

import {
  researchSummaryFingerprint,
  runResearchDryRun,
  runResearchIntelligence,
} from "../../lib/research/runner";
import type {
  ResearchCache,
  ResearchConfig,
  ResearchFetchResult,
  ResearchPaper,
  ResearchSourceConfig,
} from "../../lib/research/types";

const NOW = new Date("2026-08-05T12:00:00.000Z");

function config(enabled = true): ResearchConfig {
  return {
    schemaVersion: 1,
    domainKeywords: ["preeclampsia", "pregnancy", "maternal"],
    runtime: {
      enabled,
      clearCache: false,
      lookbackDays: 1,
      maxPapers: 5,
      cacheDays: 30,
      overlapHours: 48,
      minScore: 45,
      maxPerTopic: 2,
    },
    sources: [
      { id: "pubmed", name: "PubMed", kind: "pubmed", url: "https://eutils.test", enabled: true },
      { id: "journal", name: "Journal", kind: "journal-rss", url: "https://rss.test", enabled: true },
    ],
    topics: [
      {
        id: "mfm",
        name: "母胎医学",
        description: "高危妊娠",
        includeKeywords: ["preeclampsia"],
        excludeKeywords: [],
        publicationTypes: ["Randomized Controlled Trial"],
        enabled: true,
      },
    ],
  };
}

function paper(overrides: Partial<ResearchPaper> = {}): ResearchPaper {
  return {
    id: "pmid:1",
    pmid: "1",
    title: "Preeclampsia treatment outcomes",
    abstract: "A randomized human trial evaluated treatment outcomes in 240 participants.",
    journal: "Journal",
    authors: ["A Author"],
    publicationTypes: ["Randomized Controlled Trial"],
    activityAt: "2026-08-05T00:00:00.000Z",
    url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    sourceKinds: ["pubmed"],
    matchedTopicIds: [],
    ...overrides,
  };
}

function success(source: ResearchSourceConfig, papers = [paper()]): ResearchFetchResult {
  return {
    sourceId: source.id,
    sourceKind: source.kind,
    fetchedAt: NOW.toISOString(),
    papers,
    rejected: {},
  };
}

const emptyCache: ResearchCache = { schemaVersion: 1, papers: [] };

test("returns undefined without touching dependencies when disabled", async () => {
  let loadedCache = false;
  const section = await runResearchIntelligence({
    loadConfig: () => config(false),
    loadCache: () => { loadedCache = true; return emptyCache; },
  });
  assert.equal(section, undefined);
  assert.equal(loadedCache, false);
});

test("continues when one source fails and advances the cache", async () => {
  let saved: ResearchCache | undefined;
  let summarized = 0;
  const section = await runResearchIntelligence({
    now: () => NOW,
    loadConfig: () => config(),
    loadCache: () => emptyCache,
    saveCache: (cache) => { saved = cache; },
    fetchSource: async (source) => {
      if (source.kind === "journal-rss") throw new Error("feed down");
      return success(source);
    },
    summarize: async (papers) => {
      summarized += papers.length;
      return papers.map((item) => ({
        ...item,
        summaryStatus: "success",
        summaryZh: {
          titleZh: "子痫前期治疗结局",
          researchQuestion: "问题",
          studyDesign: "随机试验",
          populationAndSample: "240人",
          methods: "比较治疗",
          keyResults: "摘要结果",
          limitations: "摘要未报告",
          clinicalInterpretation: "不能替代指南",
        },
      }));
    },
    warn: () => {},
  });
  assert.equal(section?.isCachedFallback, false);
  assert.equal(section?.papers.length, 1);
  assert.equal(summarized, 1);
  assert.equal(saved?.lastSuccessfulRun, NOW.toISOString());
  assert.equal(saved?.papers[0].summaryStatus, "success");
  assert.ok(saved?.papers[0].summaryInputHash);
});

test("uses cached papers without an LLM call when every source fails", async () => {
  const cachedPaper = paper({
    summaryStatus: "success",
    summaryZh: {
      titleZh: "缓存题名",
      researchQuestion: "问题",
      studyDesign: "设计",
      populationAndSample: "样本",
      methods: "方法",
      keyResults: "结果",
      limitations: "局限",
      clinicalInterpretation: "解释",
    },
  });
  cachedPaper.summaryInputHash = researchSummaryFingerprint(cachedPaper);
  let summarized = false;
  let saved = false;
  const section = await runResearchIntelligence({
    now: () => NOW,
    loadConfig: () => config(),
    loadCache: () => ({ schemaVersion: 1, lastSuccessfulRun: "2026-08-04T10:00:00.000Z", papers: [cachedPaper] }),
    saveCache: () => { saved = true; },
    fetchSource: async () => { throw new Error("offline"); },
    summarize: async (papers) => { summarized = true; return papers; },
    warn: () => {},
  });
  assert.equal(section?.isCachedFallback, true);
  assert.equal(section?.dataAsOf, "2026-08-04T10:00:00.000Z");
  assert.equal(section?.papers[0].summaryZh?.titleZh, "缓存题名");
  assert.equal(summarized, false);
  assert.equal(saved, false);
});

test("returns a marked empty fallback when no source or cache is available", async () => {
  const section = await runResearchIntelligence({
    now: () => NOW,
    loadConfig: () => config(),
    loadCache: () => emptyCache,
    fetchSource: async () => { throw new Error("offline"); },
    summarize: async (papers) => papers,
    warn: () => {},
  });
  assert.equal(section?.isCachedFallback, true);
  assert.deepEqual(section?.papers, []);
});

test("does not call the summarizer for irrelevant low-quality candidates", async () => {
  let summarized = false;
  const section = await runResearchIntelligence({
    now: () => NOW,
    loadConfig: () => config(),
    loadCache: () => emptyCache,
    saveCache: () => {},
    fetchSource: async (source) => success(source, [paper({ title: "Unrelated cardiology study" })]),
    summarize: async (papers) => { summarized = true; return papers; },
  });
  assert.equal(section?.papers.length, 0);
  assert.equal(summarized, false);
});

test("reuses a cached summary when the source fingerprint is unchanged", async () => {
  const cached = paper({
    summaryStatus: "success",
    summaryZh: {
      titleZh: "复用题名", researchQuestion: "问题", studyDesign: "设计",
      populationAndSample: "样本", methods: "方法", keyResults: "结果",
      limitations: "局限", clinicalInterpretation: "解释",
    },
  });
  cached.summaryInputHash = researchSummaryFingerprint(cached);
  let summarized = false;
  const section = await runResearchIntelligence({
    now: () => NOW,
    loadConfig: () => config(),
    loadCache: () => ({ schemaVersion: 1, papers: [cached] }),
    saveCache: () => {},
    fetchSource: async (source) => success(source, source.kind === "pubmed" ? [paper()] : []),
    summarize: async (papers) => { summarized = true; return papers; },
  });
  assert.equal(summarized, false);
  assert.equal(section?.papers[0].summaryZh?.titleZh, "复用题名");
});

test("dry-run returns discovery statistics without summary or cache writes", async () => {
  let summarized = false;
  let saved = false;
  const result = await runResearchDryRun({
    now: () => NOW,
    loadConfig: () => config(),
    saveCache: () => { saved = true; },
    fetchSource: async (source) => source.kind === "pubmed" ? success(source) : Promise.reject(new Error("down")),
    summarize: async (papers) => { summarized = true; return papers; },
    warn: () => {},
  });
  assert.equal(result.successfulSources, 1);
  assert.equal(result.failedSources, 1);
  assert.equal(result.fetchedCount, 1);
  assert.equal(result.candidates.length, 1);
  assert.equal(summarized, false);
  assert.equal(saved, false);
});
