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

function candidate(sourceId: "acog-news" | "obgy-cn", url: string, overrides: Partial<ArticleInput> = {}): ArticleInput {
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
