import assert from "node:assert/strict";
import test from "node:test";

import {
  enrichObgynDetailMetadata,
  extractObgynDetailMetadata,
} from "../../lib/sources/obgyn-detail-metadata";
import type { ArticleInput } from "../../lib/ai/pipeline";

const acogPage = `
  <html><head>
    <meta property="article:published_time" content="2026-08-06T12:00:00Z">
    <meta name="description" content="ACOG updates obstetric clinical guidance for managing hypertensive disorders of pregnancy in clinical practice.">
    <meta name="citation_article_type" content="Clinical Update">
  </head><body><footer>Copyright 2026 ACOG</footer></body></html>`;

const obgyPage = `
  <html><head>
    <script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-08-05T08:00:00+08:00","articleSection":"专家论坛","description":"围绕高危妊娠规范化管理，专家讨论产科临床实践中的风险识别、转诊协作与质量改进要点。"}</script>
  </head><body>
    <nav>首页 登录 Cookie 设置 推荐阅读</nav>
    <article><p class="lead">围绕高危妊娠规范化管理，专家讨论产科临床实践中的风险识别、转诊协作与质量改进要点。</p></article>
    <aside>报名 培训 作者简介 广告</aside>
  </body></html>`;

function candidate(sourceId: "acog-news" | "obgy-cn" | "smfm-publications", url: string, overrides: Partial<ArticleInput> = {}): ArticleInput {
  return {
    sourceId,
    source: sourceId === "acog-news" ? "ACOG News" : "妇产科网",
    title: sourceId === "acog-news" ? "ACOG clinical update on pregnancy care" : "高危妊娠专家论坛",
    url,
    excerpt: "",
    category: "politics",
    ...overrides,
  };
}

test("extracts reliable ACOG published date without using a footer year", () => {
  const metadata = extractObgynDetailMetadata(acogPage);
  assert.equal(metadata.publishedAt?.toISOString(), "2026-08-06T12:00:00.000Z");
  assert.equal(metadata.contentType, "Clinical Update");
});

test("extracts an explicitly labelled ACOG release date from article text", () => {
  const metadata = extractObgynDetailMetadata(`
    <article><div class="article-meta">News Releases | Jul 16, 2026</div></article>
    <footer>Copyright 2026 ACOG</footer>
  `);
  assert.equal(metadata.publishedAt?.toISOString(), "2026-07-16T00:00:00.000Z");
});

test("extracts only verified SMFM publication dates", () => {
  const structured = extractObgynDetailMetadata(`
    <script type="application/ld+json">{"@type":"ScholarlyArticle","datePublished":"2026-07-14","dateModified":"2026-08-01"}</script>
    <main><p>Last updated August 1, 2026</p></main>
  `, "smfm-publications");
  assert.equal(structured.publishedAt?.toISOString(), "2026-07-14T00:00:00.000Z");

  const labelled = extractObgynDetailMetadata(`
    <main><dl><dt>Publication Date</dt><dd>July 16, 2026</dd></dl></main>
  `, "smfm-publications");
  assert.equal(labelled.publishedAt?.toISOString(), "2026-07-16T00:00:00.000Z");

  for (const html of [
    `<main><p>Last updated July 16, 2026</p></main>`,
    `<main><p>Last reviewed July 16, 2026</p></main>`,
    `<main><time datetime="2026-07-16">Updated July 16, 2026</time></main>`,
    `<footer>Copyright 2026</footer>`,
  ]) {
    assert.equal(extractObgynDetailMetadata(html, "smfm-publications").publishedAt, undefined);
  }
});

test("SMFM date enrichment is cached and failures remain non-blocking", async () => {
  const cache = new Map();
  const logs: string[] = [];
  let calls = 0;
  const item = candidate("smfm-publications", "https://publications.smfm.org/publications/999-smfm-consult-series/", {
    source: "SMFM Publications",
    title: "SMFM Consult Series on maternal care",
    excerpt: "Formal maternal-fetal medicine recommendations for clinical practice.",
    contentType: "guideline",
  });
  const fetchHtml = async () => {
    calls += 1;
    return { status: 200, html: `<main><p>Published: July 16, 2026</p></main>` };
  };
  const first = await enrichObgynDetailMetadata([item], { fetchHtml, cache, log: (line) => logs.push(line), now: new Date("2026-08-09") });
  assert.equal(first.articles[0].publishedAt?.toISOString(), "2026-07-16T00:00:00.000Z");
  assert.equal(first.stats.dateEnriched, 1);
  await enrichObgynDetailMetadata([item], { fetchHtml, cache, log: (line) => logs.push(line), now: new Date("2026-08-09") });
  assert.equal(calls, 1);

  const failed = await enrichObgynDetailMetadata([
    candidate("smfm-publications", "https://publications.smfm.org/publications/unavailable", {
      source: "SMFM Publications", title: "SMFM Statement on pregnancy", excerpt: "Formal obstetric guidance details.", contentType: "guideline",
    }),
  ], { fetchHtml: async () => ({ status: 503, html: "" }), cache: new Map(), log: (line) => logs.push(line) });
  assert.equal(failed.articles[0].publishedAt, undefined);
  assert.equal(failed.stats.failed, 1);
});

test("extracts OB-GYN network summary and type while ignoring boilerplate", () => {
  const metadata = extractObgynDetailMetadata(obgyPage);
  assert.match(metadata.excerpt ?? "", /高危妊娠规范化管理/);
  assert.doesNotMatch(metadata.excerpt ?? "", /Cookie|报名|广告/);
  assert.equal(metadata.contentType, "专家论坛");
});

test("enriches only eligible target candidates once per canonical URL and uses cache", async () => {
  const cache = new Map();
  let calls = 0;
  const fetchHtml = async (url: string) => {
    calls += 1;
    return { status: 200, html: url.includes("acog") ? acogPage : obgyPage };
  };
  const articles = [
    candidate("acog-news", "https://www.acog.org/news/item?utm_source=rss"),
    candidate("acog-news", "https://www.acog.org/news/item?utm_medium=email"),
    candidate("obgy-cn", "https://www.obgy.cn/article/123"),
    candidate("acog-news", "https://www.acog.org/complete", { publishedAt: new Date("2026-08-06T00:00:00Z"), excerpt: "Existing substantive obstetric clinical update.", contentType: "clinical_update" }),
  ];

  const first = await enrichObgynDetailMetadata(articles, { fetchHtml, cache, now: new Date("2026-08-07T00:00:00Z") });
  assert.equal(calls, 2);
  assert.equal(first.stats.requested, 2);
  assert.equal(first.articles[0].publishedAt?.toISOString(), "2026-08-06T12:00:00.000Z");
  assert.match(first.articles[2].excerpt ?? "", /风险识别/);

  await enrichObgynDetailMetadata([candidate("acog-news", "https://www.acog.org/news/item")], { fetchHtml, cache, now: new Date("2026-08-07T00:00:00Z") });
  assert.equal(calls, 2);
});

test("keeps candidates unchanged when detail fetch fails or content is clearly research", async () => {
  let calls = 0;
  const research = candidate("acog-news", "https://www.acog.org/research", { contentType: "Original Article" });
  const target = candidate("obgy-cn", "https://www.obgy.cn/unavailable");
  const result = await enrichObgynDetailMetadata([research, target], {
    fetchHtml: async () => { calls += 1; return { status: 403, html: "" }; },
    cache: new Map(),
    now: new Date("2026-08-07T00:00:00Z"),
  });
  assert.equal(calls, 2);
  assert.equal(result.articles[0].publishedAt, undefined);
  assert.equal(result.articles[1].excerpt, "");
  assert.equal(result.stats.failed, 1);
});

test("rejects mixed systematic and narrative review labels", async () => {
  const mixed = candidate("acog-news", "https://www.acog.org/mixed", { title: "Systematic Review and Narrative Review" });
  const result = await enrichObgynDetailMetadata([mixed], { fetchHtml: async () => ({ status: 200, html: acogPage }), cache: new Map() });
  assert.equal(result.stats.requested, 0);
});

test("rejects Chinese original and systematic reviews", async () => {
  const items = ["原著：妊娠管理研究", "系统综述：妊娠管理"].map((title, i) => candidate("acog-news", `https://www.acog.org/cn${i}`, { title }));
  const result = await enrichObgynDetailMetadata(items, { fetchHtml: async () => ({ status: 200, html: acogPage }), cache: new Map() });
  assert.equal(result.stats.requested, 0);
});
