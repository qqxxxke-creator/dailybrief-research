import assert from "node:assert/strict";
import test from "node:test";

import { fetchSource } from "../../lib/sources/dispatch";
import { parseCogonlineGuidanceHtml, parseObgyncnProfessionalHtml } from "../../lib/sources/china-professional";
import type { SourceDef } from "../../lib/sources/types";

const cog: SourceDef = { id: "cogonline-clinical-guidance", name: "妇产科在线·临床指南", type: "scrape", url: "https://www.cogonline.com/article/LinChuangZhiNan", category: "politics", subcategory: "china-obgyn", sourceClass: "professional_vertical", enabled: false, lang: "zh" };
const journal: SourceDef = { id: "obgyncn-professional-content", name: "中国妇产科临床杂志·专业内容", type: "scrape", url: "https://www.obgyncn.com/CN/current", category: "politics", subcategory: "china-obgyn", sourceClass: "academic_journal", enabled: false, lang: "zh" };

test("disabled legacy and pending China sources never dispatch network", async () => {
  for (const id of ["obgy-cn", "nhc-maternal-child-health", "cmcha-industry-news", cog.id, journal.id]) {
    const source = { ...cog, id, url: `https://invalid.test/${id}`, enabled: false };
    assert.deepEqual(await fetchSource(source), []);
  }
});

test("COGOnline routes consensus and interpretation while rejecting promotions and research news", () => {
  const html = `<main><ul>
    <li><a href="/info/1">专家共识丨妊娠管理核心推荐</a><p>2026-08-05</p></li>
    <li><a href="/info/2">指南解读丨子宫内膜异位症临床路径</a><p>2026-08-04</p></li>
    <li><a href="/info/3">妇科肿瘤手术感染与并发症防控</a><p>2026-08-03</p></li>
    <li><a href="/info/4">会议通知：培训班火热报名</a><p>2026-08-02</p></li>
    <li><a href="/info/5">最新队列研究发现卵巢癌标志物</a><p>2026-08-01</p></li>
  </ul></main>`;
  const items = parseCogonlineGuidanceHtml(cog, html);
  assert.deepEqual(items.map((item) => [item.title, item.category, item.contentType]), [
    ["专家共识丨妊娠管理核心推荐", "tech", "consensus"],
    ["指南解读丨子宫内膜异位症临床路径", "tech", "guideline_interpretation"],
    ["妇科肿瘤手术感染与并发症防控", "finance", "complication_prevention"],
  ]);
  assert.equal(items[0].publishedAt?.toISOString(), "2026-08-05T00:00:00.000Z");
});

test("OBGYN clinical journal admits declared commentary and consensus only", () => {
  const html = `<div class="issue-date">2026-08-01</div><div class="article-list">
    <article><span class="section">述评</span><a class="title" href="/CN/10.1000/a">高危妊娠质量管理</a><time datetime="2026-08-03"></time><div class="abstract">围绕高危妊娠风险分层与质量改进提出临床建议。</div><span class="doi">10.1000/a</span><span class="authors">张三；李四</span></article>
    <article><span class="section">专家共识</span><a class="title" href="/CN/10.1000/b">胎盘植入诊治专家共识</a><div class="abstract">规范胎盘植入的诊断和围手术期管理。</div><span class="doi">10.1000/b</span></article>
    <article><span class="section">论著</span><a class="title" href="/CN/c">回顾性队列研究</a></article>
    <article><span class="section">病例报告</span><a class="title" href="/CN/d">罕见病例</a></article>
    <article><span class="section">综述</span><a class="title" href="/CN/e">普通临床综述</a></article>
  </div>`;
  const items = parseObgyncnProfessionalHtml(journal, html);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((item) => item.contentType), ["expert_commentary", "consensus"]);
  assert.equal(items[0].publishedAt?.toISOString(), "2026-08-03T00:00:00.000Z");
  assert.equal(items[1].publishedAt?.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.match(items[0].excerpt ?? "", /风险分层/);
  assert.match(items[0].meta ?? "", /10\.1000\/a.*张三/);
});
