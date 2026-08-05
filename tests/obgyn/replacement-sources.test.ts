import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { filterPreviouslyPublishedGuidelines } from "../../lib/sources/guideline-history";
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
  assert.match(items[0].excerpt ?? "", /第27卷.*第3期.*10\.13390/);
});

test("guideline URL history suppresses an item after it was shown on a prior date", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "guideline-history-"));
  const priorDir = path.join(root, "2026-08-04");
  fs.mkdirSync(priorDir, { recursive: true });
  fs.writeFileSync(
    path.join(priorDir, "2026-08-04-articles.json"),
    JSON.stringify({
      articles: [{
        sourceId: guidelineSource.id,
        category: "tech",
        url: "https://example.test/guideline?utm_source=email",
      }],
    }),
  );
  const candidates: ArticleInput[] = [{
    sourceId: guidelineSource.id,
    source: guidelineSource.name,
    title: "Pregnancy guideline",
    url: "https://example.test/guideline?utm_medium=rss",
    publishedAt: new Date("2026-08-05T00:00:00.000Z"),
    category: "tech",
  }];

  assert.deepEqual(
    filterPreviouslyPublishedGuidelines(candidates, [guidelineSource], root, "2026-08-05"),
    [],
  );
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

  assert.deepEqual((await parseGocmRssXml(guideline, xml)).map((item) => item.url), ["https://gocm.bmj.com/a", "https://gocm.bmj.com/d"]);
  assert.deepEqual((await parseGocmRssXml(surgery, xml)).map((item) => item.url), ["https://gocm.bmj.com/b"]);
});
