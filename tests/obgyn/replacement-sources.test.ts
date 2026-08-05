import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  filterPreviouslyPublishedArticles,
  filterPreviouslyPublishedArticlesWithStats,
  toDisplayedArticleRecords,
} from "../../lib/sources/guideline-history";
import { parseCjournalCurrentHtml } from "../../lib/sources/cjournal-current";
import { parseGocmRssXml } from "../../lib/sources/gocm";
import type { ArticleInput } from "../../lib/ai/pipeline";
import type { SourceDef } from "../../lib/sources/types";

const guidelineSource: SourceDef = {
  id: "china-clinical-obgyn-current",
  name: "中国妇产科临床杂志",
  type: "scrape",
  url: "https://cjournal.hep.com.cn/1672-1861/CN/current",
  category: "tech",
  sourceClass: "academic_journal",
  subcategory: "guidelines",
  keywords: ["指南", "共识"],
  lookbackHours: 168,
};

test("parses title, issue date, DOI and canonical article link from the Chinese current issue", () => {
  const html = `
    <div class="issue">2026年, 第27卷, 第3期 <span>刊出日期：2026-08-04</span></div>
    <div class="article-list">
      <div class="article">
        <a class="j-title" href="/1672-1861/CN/10.13390/j.issn.1672-1861.2026.03.030">子宫颈病变管理中国专家共识（2026版）</a>
        <a class="j-doi" href="https://doi.org/10.13390/j.issn.1672-1861.2026.03.030">DOI</a>
      </div>
    </div>`;

  const items = parseCjournalCurrentHtml(guidelineSource, html);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "子宫颈病变管理中国专家共识（2026版）");
  assert.equal(items[0].url, "https://cjournal.hep.com.cn/1672-1861/CN/10.13390/j.issn.1672-1861.2026.03.030");
  assert.equal(items[0].publishedAt?.toISOString(), "2026-08-04T00:00:00.000Z");
  assert.equal(items[0].contentType, "metadata_only");
  assert.match(items[0].excerpt ?? "", /第27卷.*第3期.*10\.13390/);
});

test("display history suppresses canonical URLs and normalized titles across columns", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guideline-history-"));
  const priorDir = path.join(root, "2026-08-04");
  fs.mkdirSync(priorDir, { recursive: true });
  fs.writeFileSync(
    path.join(priorDir, "2026-08-04-displayed.json"),
    JSON.stringify([{
        sourceId: "acog-news",
        category: "tech",
        url: "https://example.test/guideline?utm_source=email",
        title: "Pregnancy guideline: updated care",
    }]),
  );
  const candidates: ArticleInput[] = [
    {
      sourceId: "acog-news",
      source: guidelineSource.name,
      title: "Different URL title",
      url: "https://example.test/guideline?utm_medium=rss",
      publishedAt: new Date("2026-08-05T00:00:00.000Z"),
      category: "tech",
    },
    {
      sourceId: "rcog-news",
      source: "RCOG",
      title: "  Pregnancy Guideline — Updated Care! ",
      url: "https://example.test/a-different-copy",
      publishedAt: new Date("2026-08-05T00:00:00.000Z"),
      category: "politics",
    },
  ];

  assert.deepEqual(
    filterPreviouslyPublishedArticles(candidates, root, "2026-08-05"),
    [],
  );
});

test("display history ignores candidate sidecars, the current date, and warns past malformed display files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "article-history-"));
  const currentDir = path.join(root, "2026-08-05");
  const brokenDir = path.join(root, "2026-08-04");
  fs.mkdirSync(currentDir, { recursive: true });
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(
    path.join(currentDir, "2026-08-05-displayed.json"),
    JSON.stringify([{ url: "https://example.test/current", title: "Current report article" }]),
  );
  fs.writeFileSync(
    path.join(brokenDir, "2026-08-04-articles.json"),
    JSON.stringify({ articles: [{ url: "https://example.test/current", title: "Current report article" }] }),
  );
  fs.writeFileSync(path.join(brokenDir, "2026-08-04-displayed.json"), "not json");
  const candidates: ArticleInput[] = [{
    sourceId: guidelineSource.id,
    source: guidelineSource.name,
    title: "Current report article",
    url: "https://example.test/current",
    publishedAt: new Date("2026-08-05T00:00:00.000Z"),
    category: "tech",
  }];
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (message: string) => warnings.push(message);
  try {
    assert.deepEqual(filterPreviouslyPublishedArticles(candidates, root, "2026-08-05"), candidates);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /2026-08-04-displayed\.json/);
});

test("legacy article sidecars never count as display history", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "legacy-article-history-"));
  const priorDir = path.join(root, "2026-08-04");
  fs.mkdirSync(priorDir, { recursive: true });
  fs.writeFileSync(
    path.join(priorDir, "2026-08-04-articles.json"),
    JSON.stringify({
      articles: [{
        url: "https://example.test/never-displayed",
        title: "Candidate that was never displayed",
      }],
    }),
  );
  const candidate: ArticleInput = {
    sourceId: guidelineSource.id,
    source: guidelineSource.name,
    title: "Candidate that was never displayed",
    url: "https://example.test/never-displayed",
    publishedAt: new Date("2026-08-05T00:00:00.000Z"),
    category: "tech",
  };

  assert.deepEqual(
    filterPreviouslyPublishedArticles([candidate], root, "2026-08-05"),
    [candidate],
  );
});

test("display history diagnostics separate URL and title matches and retain their dates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "display-history-stats-"));
  const priorDir = path.join(root, "2026-08-03");
  fs.mkdirSync(priorDir, { recursive: true });
  fs.writeFileSync(
    path.join(priorDir, "2026-08-03-displayed.json"),
    JSON.stringify([
      { url: "https://example.test/a", title: "First shown item", category: "tech", sourceId: "acog-news" },
      { url: "https://example.test/b", title: "Second shown item", category: "politics", sourceId: "rcog-news" },
    ]),
  );
  const candidates: ArticleInput[] = [
    {
      sourceId: "acog-news",
      source: "ACOG",
      title: "A changed title",
      url: "https://example.test/a?utm_source=rss",
      publishedAt: new Date("2026-08-05T00:00:00.000Z"),
      category: "tech",
    },
    {
      sourceId: "rcog-news",
      source: "RCOG",
      title: "Second shown item!",
      url: "https://example.test/another-url",
      publishedAt: new Date("2026-08-05T00:00:00.000Z"),
      category: "politics",
    },
  ];

  const result = filterPreviouslyPublishedArticlesWithStats(candidates, root, "2026-08-05");
  assert.equal(result.rejectedByUrl, 1);
  assert.equal(result.rejectedByTitle, 1);
  assert.deepEqual(
    result.rejections.map(({ matchedBy, matchedHistoryDate }) => ({ matchedBy, matchedHistoryDate })),
    [
      { matchedBy: "url", matchedHistoryDate: "2026-08-03" },
      { matchedBy: "title", matchedHistoryDate: "2026-08-03" },
    ],
  );
});

test("display history records contain only the fields needed for non-research dedupe", () => {
  const article: ArticleInput = {
    sourceId: "acog-news",
    source: "ACOG",
    title: "Practice advisory",
    url: "https://example.test/advisory",
    publishedAt: new Date("2026-08-05T00:00:00.000Z"),
    category: "tech",
    excerpt: "Clinical details",
    summary: "Summary that should not enter display history",
  };

  assert.deepEqual(toDisplayedArticleRecords([article]), [{
    url: article.url,
    title: article.title,
    category: article.category,
    sourceId: article.sourceId,
  }]);
});

test("display history also deduplicates stable DOI and PMID identities when available", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "display-history-identities-"));
  const priorDir = path.join(root, "2026-08-03");
  fs.mkdirSync(priorDir, { recursive: true });
  fs.writeFileSync(
    path.join(priorDir, "2026-08-03-displayed.json"),
    JSON.stringify([
      { url: "https://example.test/old-doi", title: "Old DOI title", category: "tech", sourceId: "gocm-guidelines", doi: "10.1000/obgyn.1" },
      { url: "https://pubmed.ncbi.nlm.nih.gov/12345678/", title: "Old PMID title", category: "tech", sourceId: "pubmed-asrm-guidance", pmid: "12345678" },
    ]),
  );
  const candidates: ArticleInput[] = [
    {
      sourceId: "gocm-guidelines",
      source: "GOCM",
      title: "Retitled DOI item",
      url: "https://gocm.bmj.com/new-copy",
      excerpt: "DOI: 10.1000/obgyn.1",
      publishedAt: new Date("2026-08-05T00:00:00.000Z"),
      category: "tech",
    },
    {
      sourceId: "pubmed-asrm-guidance",
      source: "PubMed",
      title: "Retitled PMID item",
      url: "https://example.test/pmid-copy",
      excerpt: "PMID: 12345678",
      publishedAt: new Date("2026-08-05T00:00:00.000Z"),
      category: "tech",
    },
  ];

  const result = filterPreviouslyPublishedArticlesWithStats(candidates, root, "2026-08-05");
  assert.deepEqual(result.articles, []);
  assert.equal(result.rejectedByDoi, 1);
  assert.equal(result.rejectedByPmid, 1);
});

test("routes GOCM guideline and video sections to their requested columns", async () => {
  const xml = `<?xml version="1.0"?>
    <rss version="2.0" xmlns:prism="http://prismstandard.org/namespaces/basic/2.0/">
      <channel><title>GOCM</title>
        <item><title>Cervical consensus</title><link>https://gocm.bmj.com/a</link><pubDate>Tue, 04 Aug 2026 01:00:00 GMT</pubDate><prism:section>Guideline</prism:section></item>
        <item><title>Cerclage with a closure needle</title><link>https://gocm.bmj.com/b</link><pubDate>Tue, 04 Aug 2026 02:00:00 GMT</pubDate><prism:section>Video article</prism:section></item>
        <item><title>Pregnancy cohort outcomes</title><link>https://gocm.bmj.com/c</link><pubDate>Tue, 04 Aug 2026 03:00:00 GMT</pubDate><prism:section>Original research</prism:section></item>
        <item><title>Laparoscopic guideline update</title><link>https://gocm.bmj.com/d</link><pubDate>Tue, 04 Aug 2026 04:00:00 GMT</pubDate><prism:section>Guideline</prism:section></item>
        <item><title>Laparoscopic guideline outcomes</title><link>https://gocm.bmj.com/e</link><pubDate>Tue, 04 Aug 2026 05:00:00 GMT</pubDate><prism:section>Original research</prism:section></item>
      </channel>
    </rss>`;
  const guideline = { ...guidelineSource, id: "gocm-guidelines", url: "https://gocm.bmj.com/rss/recent.xml" };
  const surgery: SourceDef = { ...guideline, id: "gocm-surgery", category: "finance", subcategory: "surgery" };

  const guidelineItems = await parseGocmRssXml(guideline, xml);
  const surgeryItems = await parseGocmRssXml(surgery, xml);
  assert.deepEqual(guidelineItems.map((item) => item.url), ["https://gocm.bmj.com/a", "https://gocm.bmj.com/d"]);
  assert.ok(guidelineItems.every((item) => item.documentType === "guideline"));
  assert.deepEqual(surgeryItems.map((item) => item.url), ["https://gocm.bmj.com/b"]);
  assert.equal(surgeryItems[0].documentType, "video");
  assert.equal(surgeryItems[0].contentType, "video article");
});
