import assert from "node:assert/strict";
import test from "node:test";

import { filterObgynCandidates } from "../../lib/sources/obgyn-filter";
import {
  buildObgynReviewUserPrompt,
  capObgynReviewCandidates,
  parseObgynReviewResponse,
  reviewObgynCandidates,
} from "../../lib/ai/enrich";
import type { ArticleInput } from "../../lib/ai/pipeline";
import type { SourceDef } from "../../lib/sources/types";

const now = new Date("2026-08-05T08:00:00.000Z");
const source: SourceDef = {
  id: "acog-clinical-guidance",
  name: "ACOG Clinical Guidance",
  type: "scrape",
  url: "https://www.acog.org/clinical/clinical-guidance",
  category: "tech",
  subcategory: "guidelines",
  keywords: ["Clinical Practice Guideline", "Practice Advisory"],
  excludeKeywords: ["patient education", "careers"],
  lookbackHours: 168,
};

function article(
  title: string,
  publishedAt: Date | undefined,
  excerpt = "",
  url = `https://example.test/${encodeURIComponent(title)}`,
): ArticleInput {
  return {
    sourceId: source.id,
    source: source.name,
    title,
    url,
    excerpt,
    publishedAt,
    category: source.category,
  };
}

test("keeps recent authoritative OB-GYN candidates", () => {
  const accepted = filterObgynCandidates(
    [
      article(
        "Clinical Practice Guideline: Preeclampsia management",
        new Date("2026-08-05T06:00:00.000Z"),
      ),
    ],
    [source],
    now,
  );
  assert.equal(accepted.length, 1);
});

test("rejects non-medical, promotional, stale, undated, and duplicate candidates", () => {
  const good = article(
    "Practice Advisory on maternal vaccination",
    new Date("2026-08-05T07:00:00.000Z"),
    "Updated obstetric recommendation.",
    "https://example.test/good",
  );
  const accepted = filterObgynCandidates(
    [
      good,
      { ...good },
      article("OpenAI launches a new coding model", new Date("2026-08-05T07:00:00.000Z")),
      article("医院宣传：妇科名医义诊活动", new Date("2026-08-05T07:00:00.000Z")),
      article("Clinical Practice Guideline: pregnancy", new Date("2026-07-28T07:00:00.000Z")),
      article("Clinical Practice Guideline: pregnancy", undefined),
    ],
    [source],
    now,
  );

  assert.deepEqual(accepted.map((item) => item.url), ["https://example.test/good"]);
});

test("uses a 7-day guideline window and a strict 24-hour news window", () => {
  const guideline = article(
    "Clinical Practice Guideline: pregnancy care",
    new Date("2026-08-01T08:00:00.000Z"),
  );
  const newsSource: SourceDef = {
    ...source,
    id: "acog-news",
    subcategory: "international-obgyn",
    category: "politics",
    lookbackHours: 24,
    keywords: ["maternal health"],
  };
  const news: ArticleInput = {
    ...guideline,
    sourceId: newsSource.id,
    source: newsSource.name,
    category: newsSource.category,
    title: "Maternal health policy update",
  };

  assert.deepEqual(filterObgynCandidates([guideline], [source], now).map((item) => item.url), [guideline.url]);
  assert.deepEqual(filterObgynCandidates([news], [newsSource], now), []);
});

test("requires both an OB-GYN anchor and the configured source rule", () => {
  assert.deepEqual(
    filterObgynCandidates([
      article("Clinical coding platform launches", new Date("2026-08-05T07:00:00.000Z")),
      article("Preeclampsia commentary", new Date("2026-08-05T07:00:00.000Z")),
    ], [source], now),
    [],
  );
});

test("rejects future timestamps and canonicalizes tracking URLs before dedupe", () => {
  const first = article(
    "Clinical Practice Guideline: pregnancy care",
    new Date("2026-08-05T07:00:00.000Z"),
    "",
    "https://example.test/guideline?utm_source=email",
  );
  const duplicate = { ...first, url: "https://example.test/guideline?utm_medium=rss" };
  const future = article(
    "Clinical Practice Guideline: maternal care",
    new Date("2026-08-05T08:01:00.000Z"),
  );
  assert.deepEqual(filterObgynCandidates([first, duplicate, future], [source], now).map((item) => item.url), [first.url]);
});

test("semantic review keeps only explicitly accepted medical items", () => {
  const candidates = [
    article("Preeclampsia guideline update", new Date("2026-08-05T07:00:00.000Z"), "", "https://example.test/keep"),
    article("Hospital event registration", new Date("2026-08-05T07:00:00.000Z"), "", "https://example.test/drop"),
    article("Unreviewed item", new Date("2026-08-05T07:00:00.000Z"), "", "https://example.test/unlisted"),
  ];
  const response = JSON.stringify({
    reviews: [
      { url: "https://example.test/keep", accepted: true, summary: "更新了子痫前期临床管理建议。" },
      { url: "https://example.test/drop", accepted: false, summary: "" },
    ],
  });

  const accepted = parseObgynReviewResponse(candidates, response);
  assert.deepEqual(accepted.map((item) => item.url), ["https://example.test/keep"]);
  assert.equal(accepted[0].summary, "更新了子痫前期临床管理建议。");

  const prompt = buildObgynReviewUserPrompt(candidates);
  assert.match(prompt, /是否直接属于妇产科领域/);
  assert.match(prompt, /医院宣传|商业广告/);
});

test("caps semantic review fairly across sources", () => {
  const secondSource = { ...source, id: "rcog-guidance", name: "RCOG Guidance" };
  const candidates = Array.from({ length: 80 }, (_, index) => ({
    ...article(
      `Clinical Practice Guideline: pregnancy ${index}`,
      new Date("2026-08-05T07:00:00.000Z"),
      "",
      `https://example.test/${index}`,
    ),
    sourceId: index < 70 ? source.id : secondSource.id,
    source: index < 70 ? source.name : secondSource.name,
  }));
  const capped = capObgynReviewCandidates(candidates, 60, 8);
  assert.equal(capped.length, 16);
  assert.equal(capped.filter((item) => item.sourceId === source.id).length, 8);
  assert.equal(capped.filter((item) => item.sourceId === secondSource.id).length, 8);
});

test("aborts when every semantic review chunk fails", async () => {
  await assert.rejects(
    () => reviewObgynCandidates(
      [article("Preeclampsia guideline update", new Date("2026-08-05T07:00:00.000Z"))],
      { run: async () => { throw new Error("LLM unavailable"); } },
    ),
    /all OB-GYN semantic review chunks failed/,
  );
});
