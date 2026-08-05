import assert from "node:assert/strict";
import test from "node:test";

import type { DailyReport } from "../../lib/ai/pipeline";
import { renderHtml, renderMarkdown, type RawByCategory } from "../../lib/output/render";
import type { ResearchSection } from "../../lib/research/types";

const raw: RawByCategory = { tech: [], finance: [], politics: [] };

function baseReport(): DailyReport {
  return {
    hero_headline: "今日摘要",
    daily_overview: "今日概览",
    tech_briefs: [],
    finance_briefs: [],
    politics_briefs: [],
    editor_note: "编辑短评",
    keywords: ["妇产科"],
  };
}

function research(papers = 1): ResearchSection {
  return {
    generatedAt: "2026-08-05T08:00:00.000Z",
    dataAsOf: "2026-08-05T07:00:00.000Z",
    isCachedFallback: true,
    dailySignal: "今日研究信号 <script>alert(1)</script>",
    papers: papers
      ? [
          {
            id: "pmid:123",
            pmid: "123",
            doi: "10.1000/test",
            title: "English <b>paper</b> title",
            abstract: "Source abstract with enough detail for rendering.",
            journal: "Journal & Society",
            authors: ["A Author"],
            publicationTypes: ["Randomized Controlled Trial"],
            publishedAt: "2026-08-04T00:00:00.000Z",
            activityAt: "2026-08-04T00:00:00.000Z",
            url: "https://example.test/paper?a=1&b=2",
            sourceKinds: ["pubmed"],
            matchedTopicIds: ["mfm"],
            assignedTopicId: "mfm",
            score: {
              topicMatch: 50,
              evidence: 23.75,
              clinicalActionability: 15,
              recency: 10,
              total: 98.75,
              evidenceRank: 0.95,
            },
            summaryStatus: "success",
            summaryZh: {
              titleZh: "中文论文题名",
              researchQuestion: "研究问题",
              studyDesign: "随机对照试验",
              populationAndSample: "240名参与者",
              methods: "比较干预与对照",
              keyResults: "主要结局为12.5%",
              limitations: "摘要未报告",
              clinicalInterpretation: "不能替代指南建议",
            },
          },
        ]
      : [],
  };
}

test("renders the research section after all panels and before the footer", () => {
  const report = { ...baseReport(), research: research() };
  const html = renderHtml(report, raw, "2026-08-05");
  const panelIndex = html.lastIndexOf('data-panel="finance"');
  const researchIndex = html.indexOf('class="research-section"');
  const footerIndex = html.indexOf("<footer>");
  assert.ok(panelIndex < researchIndex);
  assert.ok(researchIndex < footerIndex);
  assert.match(html, /研究前沿论文/);
  assert.match(html, /缓存数据/);
  assert.match(html, /98\.75/);
  assert.match(html, /PMID 123/);
  assert.match(html, /DOI 10\.1000\/test/);
});

test("escapes research content and URLs", () => {
  const html = renderHtml({ ...baseReport(), research: research() }, raw, "2026-08-05");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /English &lt;b&gt;paper&lt;\/b&gt; title/);
  assert.match(html, /href="https:\/\/example\.test\/paper\?a=1&amp;b=2"/);
});

test("puts research last in Markdown", () => {
  const markdown = renderMarkdown({ ...baseReport(), research: research() }, "2026-08-05");
  assert.ok(markdown.indexOf("## 研究前沿论文") > markdown.indexOf("## 今日关键词"));
  assert.match(markdown, /### \[中文论文题名\]/);
  assert.match(markdown, /英文题名：English <b>paper<\/b> title/);
});

test("renders the required research panel with an explicit empty state", () => {
  const unavailable = renderHtml(baseReport(), raw, "2026-08-05");
  assert.match(unavailable, /研究前沿论文/);
  assert.match(unavailable, /过去24小时暂无符合质量要求的重要更新/);
  const html = renderHtml({ ...baseReport(), research: research(0) }, raw, "2026-08-05");
  assert.match(html, /过去24小时暂无符合质量要求的重要更新/);
});

test("uses the seven-day unseen-paper empty state", () => {
  const expected = "近7天暂无与兴趣方向匹配且达到评分阈值的未展示论文。";
  assert.ok(renderHtml(baseReport(), raw, "2026-08-05").includes(expected));
  assert.ok(renderHtml({ ...baseReport(), research: research(0) }, raw, "2026-08-05").includes(expected));
  assert.ok(renderMarkdown(baseReport(), "2026-08-05").includes(expected));
});
