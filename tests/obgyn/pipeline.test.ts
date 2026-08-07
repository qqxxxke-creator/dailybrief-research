import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { sanitizeDigestReport, type ArticleInput } from "../../lib/ai/pipeline";

const articles: ArticleInput[] = [
  {
    sourceId: "acog",
    source: "ACOG",
    title: "Canonical guideline title",
    url: "https://example.test/guideline",
    category: "tech",
    publishedAt: new Date("2026-08-05T00:00:00.000Z"),
    summary: "经语义复核的中文摘要。",
  },
  {
    sourceId: "figo",
    source: "FIGO",
    title: "Canonical international title",
    url: "https://example.test/international",
    category: "politics",
    publishedAt: new Date("2026-08-05T00:00:00.000Z"),
    summary: "国际妇产科动态摘要。",
  },
  {
    sourceId: "acog",
    source: "ACOG",
    title: "Canonical low-priority title",
    url: "https://example.test/low-priority",
    category: "tech",
    publishedAt: new Date("2026-08-05T00:00:00.000Z"),
    summary: "原始页面暂未提供可解析摘要，请查看原文了解详细更新。",
    reviewStatus: "uncertain",
    lowPriority: true,
  },
];

test("validates digest JSON, restores canonical metadata, and deduplicates URLs", () => {
  const report = sanitizeDigestReport({
    hero_headline: 42,
    daily_overview: "Overview",
    tech_briefs: [
      { title: "Fabricated", source: "Wrong", url: articles[0].url, summary: "LLM summary", importance: 99 },
      { title: "Low priority", source: "Wrong", url: articles[2].url, summary: "LLM summary", importance: 10 },
      { title: "Duplicate", source: "Wrong", url: articles[0].url, summary: "Duplicate", importance: 5 },
      { title: "Unknown", source: "Wrong", url: "https://example.test/unknown", summary: "No", importance: 5 },
    ],
    finance_briefs: "not an array",
    politics_briefs: [
      { title: "Wrong category", source: "Wrong", url: articles[0].url, summary: "No", importance: 5 },
      { title: "International", source: "Wrong", url: articles[1].url, summary: "Good", importance: 7 },
    ],
    editor_note: "Note",
    keywords: ["pregnancy", 1, "guideline"],
  }, articles);

  assert.equal(report.hero_headline, "");
  assert.deepEqual(report.tech_briefs, [{
    title: articles[0].title,
    source: articles[0].source,
    url: articles[0].url,
    summary: "LLM summary",
    importance: 10,
  }, {
    title: articles[2].title,
    source: articles[2].source,
    url: articles[2].url,
    summary: "LLM summary",
    importance: 5,
  }]);
  assert.deepEqual(report.finance_briefs, []);
  assert.deepEqual(report.politics_briefs.map((item) => item.url), [articles[1].url]);
  assert.deepEqual(report.keywords, ["pregnancy", "guideline"]);
});

test("daily pipeline enriches ACOG and OB-GYN network metadata before deterministic filtering", () => {
  const daily = fs.readFileSync(path.resolve("scripts/daily.ts"), "utf8");
  const fetchIndex = daily.indexOf("await fetchAll()");
  const enrichIndex = daily.indexOf("enrichObgynDetailMetadata(fetched)");
  const filterIndex = daily.indexOf("filterObgynCandidatesWithStats(");
  assert.ok(enrichIndex > fetchIndex);
  assert.ok(enrichIndex < filterIndex);
});
