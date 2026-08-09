import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { createEmptyDailyReport, type DailyReport } from "../../lib/ai/pipeline";
import { SYSTEM_PROMPT_DIGEST_ZH } from "../../lib/ai/prompts";
import { renderHtml, renderMarkdown, type RawByCategory } from "../../lib/output/render";

const EMPTY_BY_COLUMN = [
  "近90天暂无未展示过的权威指南或共识更新。",
  "近30天暂无通过专业筛选的新手术技术进展。",
  "近7天暂无通过领域与专业价值筛选的重要更新。",
  "近7天暂无与兴趣方向匹配且达到评分阈值的未展示论文。",
];

const EMPTY_TEXT = "过去24小时暂无符合质量要求的重要更新。";

function report(): DailyReport {
  return {
    hero_headline: "今日妇产科要闻",
    daily_overview: "今日仅保留具有临床或学术价值的妇产科更新。",
    tech_briefs: [],
    finance_briefs: [],
    politics_briefs: [],
    editor_note: "质量优先于数量。",
    keywords: ["妇产科", "临床指南"],
    research: {
      generatedAt: "2026-08-05T08:00:00.000Z",
      dataAsOf: "2026-08-05T08:00:00.000Z",
      isCachedFallback: false,
      dailySignal: EMPTY_TEXT,
      papers: [],
    },
  };
}

const raw: RawByCategory = {
  tech: [{ id: "guidelines", name: "指南与共识更新", sources: [] }],
  finance: [{ id: "surgery", name: "妇产科手术前沿", sources: [] }],
  politics: [
    { id: "international-obgyn", name: "国际妇产科动态", sources: [] },
    { id: "china-obgyn", name: "国内妇产科动态", sources: [] },
  ],
};

test("renders only the five OB-GYN content panels on the existing page shell", () => {
  const html = renderHtml(report(), raw, "2026-08-05");

  assert.match(html, /<title>妇产科医学晨报 · 2026-08-05<\/title>/);
  for (const label of [
    "今日妇产科要闻",
    "今日总览",
    "编辑短评",
    "今日关键词",
    "指南与共识更新",
    "妇产科手术前沿",
    "国际妇产科动态",
    "国内妇产科动态",
    "研究前沿论文",
  ]) {
    assert.match(html, new RegExp(label));
  }

  assert.doesNotMatch(
    html,
    /技术动态|市场行情|时政观察|财经要点|社区讨论|GitHub Trending|AI 媒体/,
  );
  assert.match(html, new RegExp(EMPTY_TEXT, "g"));

  const lastNewsPanel = html.lastIndexOf('data-panel="china-obgyn"');
  const researchPanel = html.indexOf('class="research-section"');
  const footer = html.indexOf("<footer>");
  assert.ok(lastNewsPanel < researchPanel);
  assert.ok(researchPanel < footer);
});

test("renders category-specific empty copy in HTML and Markdown", () => {
  const html = renderHtml(report(), raw, "2026-08-05");
  const markdown = renderMarkdown(report(), "2026-08-05", raw);
  for (const message of EMPTY_BY_COLUMN) {
    assert.ok(html.includes(message), `HTML must include: ${message}`);
    assert.ok(markdown.includes(message), `Markdown must include: ${message}`);
  }
});

test("enables every approved OB-GYN news source from the manifest", () => {
  const config = JSON.parse(
    fs.readFileSync(path.resolve("sources.config.json"), "utf8"),
  ) as Array<{ id: string; enabled?: boolean }>;
  const enabled = config
    .filter((source) => source.enabled !== false)
    .map((source) => source.id)
    .sort();

  assert.deepEqual(enabled, [
    "aagl-surgeryu",
    "acog-clinical-guidance",
    "acog-news",
    "china-clinical-obgyn-current",
    "cmcha-industry-news",
    "esge-guidelines",
    "esge-news",
    "esgo-guidelines",
    "fda-owh-news",
    "figo-guidance",
    "gocm-guidelines",
    "gocm-surgery",
    "jmig-articles-in-press",
    "nhc-maternal-child-health",
    "nice-fertility-pregnancy",
    "obgy-cn",
    "pubmed-asrm-guidance",
    "rcog-guidance",
    "rcog-news",
    "smfm-publications",
    "who-maternal-health",
    "who-womens-health",
  ]);

  const disabled = config
    .filter((source) => source.enabled === false)
    .map((source) => source.id);
  for (const id of [
    "asrm-practice-guidance",
    "chinese-journal-obgyn",
    "obg-project-guidance",
    "contemporary-obgyn-news",
  ]) {
    assert.ok(disabled.includes(id), `${id} must remain disabled after reachability testing`);
  }

  const serialized = JSON.stringify(config).toLowerCase();
  assert.doesNotMatch(serialized, /rsshub|feedspot|dxy|丁香园/);
});

test("uses an OB-GYN medical editor prompt with strict domain rejection", () => {
  assert.match(SYSTEM_PROMPT_DIGEST_ZH, /妇产科医学编辑/);
  assert.match(SYSTEM_PROMPT_DIGEST_ZH, /与妇产科无关.*丢弃/s);
  assert.match(SYSTEM_PROMPT_DIGEST_ZH, /医院宣传|商业广告/);
  assert.match(SYSTEM_PROMPT_DIGEST_ZH, /主要变化.*既往建议.*临床实践/s);
  assert.match(SYSTEM_PROMPT_DIGEST_ZH, /技术阶段.*探索阶段.*临床验证阶段.*推广应用阶段.*成熟实践/s);
});

test("creates a publishable empty report instead of using unrelated fallback content", () => {
  const empty = createEmptyDailyReport();
  assert.equal(empty.daily_overview, EMPTY_TEXT);
  assert.equal(empty.editor_note, EMPTY_TEXT);
  assert.deepEqual(empty.tech_briefs, []);
  assert.deepEqual(empty.finance_briefs, []);
  assert.deepEqual(empty.politics_briefs, []);
});

test("does not expose stale non-medical digest text when all configured news panels are empty", () => {
  const stale: DailyReport = {
    hero_headline: "OpenAI releases a coding model",
    daily_overview: "Stock markets and cryptocurrency rallied.",
    tech_briefs: [{
      title: "New AI model",
      url: "https://example.test/ai",
      source: "Tech News",
      summary: "A general technology story.",
      importance: 9,
    }],
    finance_briefs: [],
    politics_briefs: [],
    editor_note: "Watch the stock market.",
    keywords: ["AI", "stocks"],
  };
  const html = renderHtml(stale, raw, "2026-08-05");
  assert.doesNotMatch(html, /OpenAI|coding model|Stock markets|cryptocurrency|Tech News|stock market/);
  assert.match(html, /研究前沿论文/);
  assert.match(html, new RegExp(EMPTY_TEXT));
});

test("does not expose stale non-medical digest text when raw news exists but no digest URL matches", () => {
  const stale: DailyReport = {
    hero_headline: "OpenAI releases a coding model",
    daily_overview: "Stock markets and cryptocurrency rallied.",
    tech_briefs: [{
      title: "New AI model",
      url: "https://example.test/ai",
      source: "Tech News",
      summary: "A general technology story.",
      importance: 9,
    }],
    finance_briefs: [],
    politics_briefs: [],
    editor_note: "Watch the stock market.",
    keywords: ["AI", "stocks"],
  };
  const currentRaw: RawByCategory = {
    ...raw,
    tech: [{
      id: "guidelines",
      name: "指南与共识更新",
      sources: [{
        sourceId: "acog-clinical-guidance",
        sourceName: "ACOG Clinical Guidance",
        items: [{
          sourceId: "acog-clinical-guidance",
          source: "ACOG Clinical Guidance",
          category: "tech",
          title: "Current obstetric guideline",
          url: "https://example.test/obgyn-guideline",
          publishedAt: new Date("2026-08-05T00:00:00.000Z"),
        }],
      }],
    }],
  };

  const html = renderHtml(stale, currentRaw, "2026-08-05");
  assert.doesNotMatch(html, /OpenAI|coding model|Stock markets|cryptocurrency|Tech News|stock market/);
  assert.match(html, new RegExp(EMPTY_TEXT));
  const markdown = renderMarkdown(stale, "2026-08-05", currentRaw);
  assert.doesNotMatch(markdown, /OpenAI|coding model|Stock markets|cryptocurrency|Tech News|stock market/);
  for (const label of ["指南与共识更新", "妇产科手术前沿", "国际妇产科动态", "国内妇产科动态", "研究前沿论文"]) {
    assert.match(markdown, new RegExp(label));
  }
});

test("daily pipeline no longer invokes legacy enrichment or trading", () => {
  const daily = fs.readFileSync(path.resolve("scripts/daily.ts"), "utf8");
  for (const legacyCall of [
    "enrichGhTrending",
    "enrichTrendingPapers",
    "enrichFinanceNews",
    "enrichPolitics",
    "enrichAiNews",
    "enrichXViral",
    "runTrading",
  ]) {
    assert.doesNotMatch(daily, new RegExp(`await\\s+${legacyCall}\\s*\\(`));
  }
  assert.match(daily, /successfulSources\s*===\s*0/);
  assert.match(daily, /console\.warn/);
  assert.match(daily, /filterPreviouslyPublishedArticles/);
});

test("daily pipeline reviews priority content before conditionally reviewing supplements", () => {
  const daily = fs.readFileSync(path.resolve("scripts/daily.ts"), "utf8");

  assert.match(daily, /priorityArticles/);
  assert.match(daily, /supplementalArticles/);
  assert.match(daily, /priorityAccepted\.length\s*<\s*10/);
  assert.match(daily, /selectSupplementalObgynArticles/);
  assert.match(daily, /column counts:/);
  assert.match(daily, /rejection samples/);
});

test("daily pipeline persists display-only history and logs selection diagnostics", () => {
  const daily = fs.readFileSync(path.resolve("scripts/daily.ts"), "utf8");
  const history = fs.readFileSync(path.resolve("lib/sources/guideline-history.ts"), "utf8");

  assert.match(daily, /-displayed\.json/);
  assert.match(daily, /toDisplayedArticleRecords\(articles\)/);
  assert.doesNotMatch(history, /-articles\.json/);
  for (const metric of [
    "fetched_total",
    "deterministic_accepted",
    "history_rejected_by_url",
    "history_rejected_by_title",
    "semantic_accepted",
    "semantic_rejected",
    "priority_selected",
    "supplemental_pool",
    "supplemental_selected",
    "final_displayed",
  ]) {
    assert.match(daily, new RegExp(metric));
  }
});
