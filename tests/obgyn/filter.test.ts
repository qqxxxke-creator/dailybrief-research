import assert from "node:assert/strict";
import test from "node:test";

import {
  filterObgynCandidates,
  filterObgynCandidatesWithStats,
} from "../../lib/sources/obgyn-filter";
import { loadAllSources } from "../../lib/sources/registry";
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
  sourceClass: "official_authority",
  subcategory: "guidelines",
  keywords: ["Clinical Practice Guideline", "Practice Advisory"],
  excludeKeywords: ["patient education", "careers"],
  lookbackHours: 168,
};

function article(
  title: string,
  publishedAt: Date | undefined,
  excerpt = "",
  url = `https://www.acog.org/clinical/${encodeURIComponent(title)}`,
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
      article("Clinical Practice Guideline: pregnancy", new Date("2026-01-01T07:00:00.000Z")),
      article("Clinical Practice Guideline: pregnancy", undefined),
    ],
    [source],
    now,
  );

  assert.deepEqual(accepted.map((item) => item.url), ["https://example.test/good"]);
});

test("partitions candidates by routed 30/180d, 14/90d and 7/30d windows", () => {
  const guidelineSource = { ...source, lookbackHours: 4320 };
  const surgerySource: SourceDef = {
    ...source,
    id: "aagl-surgeryu",
    name: "AAGL SurgeryU",
    url: "https://surgeryu.aagl.org/",
    sourceClass: "professional_vertical",
    category: "finance",
    subcategory: "surgery",
    lookbackHours: 2160,
  };
  const internationalSource: SourceDef = {
    ...surgerySource,
    id: "acog-news",
    category: "politics",
    subcategory: "international-obgyn",
    lookbackHours: 720,
  };
  const chinaSource: SourceDef = {
    ...internationalSource,
    id: "cmcha-industry-news",
    subcategory: "china-obgyn",
  };
  const candidates: ArticleInput[] = [
    article("Clinical Practice Guideline: pregnancy care", new Date("2026-07-20T08:00:00.000Z")),
    article("Committee Opinion on maternal care", new Date("2026-06-05T08:00:00.000Z"), "Formal clinical recommendations."),
    {
      ...article("Surgical Technique: robotic hysterectomy", new Date("2026-08-01T08:00:00.000Z"), "Step-by-step operative method."),
      sourceId: surgerySource.id,
      source: surgerySource.name,
      category: surgerySource.category,
      url: "https://surgeryu.aagl.org/operating-theatre",
      documentType: "video",
      contentType: "video article",
    },
    {
      ...article("Technical Note: vNOTES entry", new Date("2026-07-16T08:00:00.000Z"), "Detailed operative access technique."),
      sourceId: surgerySource.id,
      source: surgerySource.name,
      category: surgerySource.category,
      url: "https://surgeryu.aagl.org/vnotes-entry",
    },
    {
      ...article("Updated maternity safety standards", new Date("2026-08-03T08:00:00.000Z"), "A substantive clinical update."),
      sourceId: internationalSource.id,
      source: internationalSource.name,
      category: internationalSource.category,
      url: "https://surgeryu.aagl.org/maternity-safety",
    },
    {
      ...article("Maternal health service update", new Date("2026-07-20T08:00:00.000Z"), "A substantive policy update."),
      sourceId: chinaSource.id,
      source: chinaSource.name,
      category: chinaSource.category,
      url: "https://surgeryu.aagl.org/maternal-health",
    },
    article("Clinical Guideline: expired", new Date("2026-01-01T08:00:00.000Z")),
  ];

  const result = filterObgynCandidatesWithStats(
    candidates,
    [guidelineSource, surgerySource, internationalSource, chinaSource],
    now,
  );

  assert.deepEqual(result.priorityArticles.map((item) => item.title), [
    "Clinical Practice Guideline: pregnancy care",
    "Surgical Technique: robotic hysterectomy",
    "Updated maternity safety standards",
  ]);
  assert.deepEqual(result.supplementalArticles.map((item) => item.title), [
    "Committee Opinion on maternal care",
    "Technical Note: vNOTES entry",
    "Maternal health service update",
  ]);
  assert.equal(result.stats.outsideTimeWindow, 1);
});

test("reports aggregate deterministic filter passes and rejection stages", () => {
  const current = article(
    "Clinical Practice Guideline: pregnancy care",
    new Date("2026-08-05T07:00:00.000Z"),
  );
  const advertisement = article(
    "Sponsored pregnancy guideline advertisement",
    new Date("2026-08-05T07:00:00.000Z"),
    "Commercial promotion",
  );
  const stale = article(
    "Clinical Practice Guideline: maternal care",
    new Date("2026-01-01T07:00:00.000Z"),
  );

  const result = filterObgynCandidatesWithStats(
    [current, advertisement, stale],
    [{ ...source, lookbackHours: 720 }],
    now,
  );

  assert.deepEqual(result.articles.map((item) => item.url), [current.url]);
  assert.deepEqual(result.stats, {
    total: 3,
    accepted: 1,
    rejected: 2,
    promotional: 1,
    invalidItem: 0,
    sourceExcluded: 0,
    outsideTimeWindow: 1,
    notObgyn: 0,
    unsupportedContentType: 0,
    missingContent: 0,
    duplicate: 0,
  });
});

test("general authority requires keyword match before semantic review", () => {
  const whoSource: SourceDef = {
    ...source,
    id: "who-womens-health",
    name: "WHO Women's Health",
    url: "https://www.who.int/womens-health",
    sourceClass: "general_authority",
    keywords: ["technical update"],
  };
  const unrelatedWhoItem: ArticleInput = {
    ...article("Technical update: laboratory procurement", new Date("2026-08-05T07:00:00.000Z"), "A substantive operational update."),
    sourceId: whoSource.id,
    source: whoSource.name,
    url: "https://www.who.int/laboratory-procurement",
  };

  assert.deepEqual(filterObgynCandidates([unrelatedWhoItem], [whoSource], now), []);
});

test("vertical substantive content can reach semantic review without keyword hit", () => {
  const aaglSource: SourceDef = {
    ...source,
    id: "aagl-surgeryu",
    name: "AAGL SurgeryU",
    url: "https://surgeryu.aagl.org/",
    sourceClass: "professional_vertical",
    category: "finance",
    subcategory: "surgery",
    keywords: ["laparoscopy"],
  };
  const substantiveAaglItem: ArticleInput = {
    ...article("Operating room workflow update", new Date("2026-08-05T07:00:00.000Z"), "A substantive review of surgical workflow."),
    sourceId: aaglSource.id,
    source: aaglSource.name,
    category: aaglSource.category,
    url: "https://surgeryu.aagl.org/workflow",
  };

  assert.equal(filterObgynCandidates([substantiveAaglItem], [aaglSource], now).length, 1);
});

test("substantive official news and academic techniques can reach review without keyword hits", () => {
  const officialNews: SourceDef = {
    ...source,
    id: "smfm-publications",
    name: "SMFM Publications",
    keywords: ["Consult Series"],
  };
  const journal: SourceDef = {
    ...source,
    id: "jmig-articles-in-press",
    name: "JMIG Articles in Press",
    sourceClass: "academic_journal",
    category: "finance",
    subcategory: "surgery",
    keywords: ["laparoscopy"],
  };
  const candidates: ArticleInput[] = [
    {
      ...article("SMFM clinical service update", new Date("2026-08-05T07:00:00.000Z"), "Changes to maternal-fetal medicine referral practice."),
      sourceId: officialNews.id,
      source: officialNews.name,
      documentType: "news",
    },
    {
      ...article("Technical Note: contained tissue extraction", new Date("2026-08-05T07:00:00.000Z"), "Detailed minimally invasive operative method."),
      sourceId: journal.id,
      source: journal.name,
      category: journal.category,
      url: "https://example.test/technical-note",
      contentType: "Technical Note",
    },
  ];

  assert.deepEqual(
    filterObgynCandidates(candidates, [officialNews, journal], now).map((item) => item.title),
    candidates.map((item) => item.title),
  );
});

test("substantive professional webinar and training items can reach semantic review", () => {
  const aaglSource: SourceDef = {
    ...source,
    id: "aagl-surgeryu",
    name: "AAGL SurgeryU",
    url: "https://surgeryu.aagl.org/",
    sourceClass: "professional_vertical",
    category: "finance",
    subcategory: "surgery",
    keywords: [],
  };
  const candidates = [
    article("Webinar: advanced vNOTES surgical technique", new Date("2026-08-05T07:00:00.000Z"), "Step-by-step operative technique and complication management."),
    article("Simulation training intervention for cesarean hemorrhage", new Date("2026-08-05T07:00:00.000Z"), "Controlled study of maternal safety outcomes."),
  ].map((candidate, index) => ({
    ...candidate,
    sourceId: aaglSource.id,
    source: aaglSource.name,
    category: aaglSource.category,
    url: `https://surgeryu.aagl.org/substantive-${index}`,
  }));

  assert.equal(filterObgynCandidates(candidates, [aaglSource], now).length, 2);
});

test("hard exclusions reject advertisements for every source class", () => {
  const classes: SourceDef["sourceClass"][] = [
    "official_authority",
    "academic_journal",
    "professional_vertical",
    "general_authority",
  ];
  for (const sourceClass of classes) {
    const classSource: SourceDef = {
      ...source,
      id: `${sourceClass}-source`,
      sourceClass,
      keywords: ["pregnancy"],
    };
    const advertisement: ArticleInput = {
      ...article("Advertisement: pregnancy clinical update", new Date("2026-08-05T07:00:00.000Z"), "Substantive-looking promotion."),
      sourceId: classSource.id,
      source: classSource.name,
    };
    assert.deepEqual(filterObgynCandidates([advertisement], [classSource], now), [], sourceClass);
  }
});

test("hard exclusions reject vertical sponsored, education, promotion, and operations content before review", () => {
  const verticalSource: SourceDef = {
    ...source,
    id: "vertical-source",
    name: "Vertical Source",
    sourceClass: "professional_vertical",
    category: "finance",
    subcategory: "surgery",
    keywords: [],
    excludeKeywords: [],
  };
  const rejected = [
    { title: "Clinical update", meta: "Sponsored content" },
    { title: "Clinical update", contentType: "Sponsored" },
    { title: "Clinical course registration" },
    { title: "Patient education: pregnancy care" },
    { title: "医院宣传：孕产妇服务" },
    { title: "Procurement notice for maternity equipment" },
    { title: "Pregnancy conference registration" },
  ];

  const candidates = rejected.map((overrides, index): ArticleInput => ({
    ...article(overrides.title, new Date("2026-08-05T07:00:00.000Z"), "Substantive-looking content."),
    ...overrides,
    sourceId: verticalSource.id,
    source: verticalSource.name,
    category: verticalSource.category,
    url: `https://vertical.example/${index}`,
  }));

  assert.deepEqual(filterObgynCandidates(candidates, [verticalSource], now), []);
});

test("general authority requires a configured non-empty source keyword match", () => {
  for (const keywords of [undefined, []] as Array<string[] | undefined>) {
    const unscopedSource: SourceDef = {
      ...source,
      id: `general-authority-${keywords === undefined ? "missing" : "empty"}`,
      name: "General Authority",
      sourceClass: "general_authority",
      keywords,
    };
    const pregnancyUpdate: ArticleInput = {
      ...article("Pregnancy clinical update", new Date("2026-08-05T07:00:00.000Z"), "Substantive policy update."),
      sourceId: unscopedSource.id,
      source: unscopedSource.name,
    };

    assert.deepEqual(filterObgynCandidates([pregnancyUpdate], [unscopedSource], now), []);
  }
});

test("configures exact category windows in the source manifest", () => {
  const sources = loadAllSources();
  for (const configuredSource of sources) {
    const expected = configuredSource.subcategory === "guidelines"
      ? 4320
      : configuredSource.subcategory === "surgery"
        ? 2160
        : ["international-obgyn", "china-obgyn"].includes(configuredSource.subcategory ?? "")
          ? 720
          : undefined;
    assert.equal(configuredSource.lookbackHours, expected, configuredSource.id);
  }
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
    "https://www.acog.org/clinical/guideline?utm_source=email",
  );
  const duplicate = { ...first, url: "https://www.acog.org/clinical/guideline?utm_medium=rss" };
  const future = article(
    "Clinical Practice Guideline: maternal care",
    new Date("2026-08-05T08:01:00.000Z"),
  );
  assert.deepEqual(filterObgynCandidates([first, duplicate, future], [source], now).map((item) => item.url), [first.url]);
});

test("semantic review keeps only explicitly accepted medical items", () => {
  const candidates = [
    article("Preeclampsia guideline update", new Date("2026-08-05T07:00:00.000Z"), "Clinical recommendation details.", "https://example.test/keep"),
    article("Hospital event registration", new Date("2026-08-05T07:00:00.000Z"), "", "https://example.test/drop"),
    article("Unreviewed item", new Date("2026-08-05T07:00:00.000Z"), "", "https://example.test/unlisted"),
  ];
  const response = JSON.stringify({
    reviews: [
      { url: "https://example.test/keep", status: "accepted", summary: "更新了子痫前期临床管理建议。" },
      { url: "https://example.test/drop", status: "rejected", summary: "" },
    ],
  });

  const accepted = parseObgynReviewResponse(candidates, response);
  assert.deepEqual(accepted.map((item) => item.url), ["https://example.test/keep"]);
  assert.equal(accepted[0].summary, "更新了子痫前期临床管理建议。");

  const prompt = buildObgynReviewUserPrompt(candidates);
  assert.match(prompt, /是否直接属于妇产科领域/);
  assert.match(prompt, /医院宣传|商业广告/);
  assert.doesNotMatch(prompt, /accepted=true/);
  assert.match(prompt, /accepted.*uncertain.*拒绝/s);
});

test("keeps uncertain only for official formal documents", () => {
  const official = article(
    "Practice Advisory: maternal health",
    new Date("2026-08-05T07:00:00.000Z"),
    "",
    "https://www.acog.org/clinical/practice-advisory",
  );
  const journal: ArticleInput = {
    ...article(
      "New minimally invasive gynecologic surgery findings",
      new Date("2026-08-05T07:00:00.000Z"),
      "Available abstract with clinical findings.",
      "https://www.sciencedirect.com/science/article/pii/example",
    ),
    sourceId: "jmig-articles-in-press",
    source: "Journal of Minimally Invasive Gynecology - Articles in Press",
    category: "finance",
    documentType: "research_article",
    contentType: "abstract",
  };
  const media: ArticleInput = {
    ...article(
      "Maternal health news update",
      new Date("2026-08-05T07:00:00.000Z"),
      "Available excerpt.",
      "https://www.who.int/news/item/maternal-health",
    ),
    sourceId: "who-maternal-health",
    source: "WHO Maternal Health",
    documentType: "news",
    contentType: "excerpt",
  };

  const result = parseObgynReviewResponse([official, journal, media], JSON.stringify({ reviews: [
    { url: official.url, status: "uncertain", summary: "" },
    { url: journal.url, status: "uncertain", summary: "available abstract" },
    { url: media.url, status: "uncertain", summary: "available excerpt" },
  ] }));

  assert.deepEqual(result.map((item) => item.url), [official.url]);
  assert.deepEqual(result.map((item) => item.reviewStatus), ["uncertain"]);
  assert.deepEqual(result.map((item) => item.lowPriority), [true]);
  assert.equal(result[0].summary, "原始页面暂未提供可解析摘要，请查看原文了解详细更新。");
});

test("normalizes an accepted official title-only document to uncertain", () => {
  const official = article(
    "Practice Advisory: maternal health",
    new Date("2026-08-05T07:00:00.000Z"),
    "",
    "https://www.acog.org/clinical/accepted-title-only",
  );

  const result = parseObgynReviewResponse([official], JSON.stringify({ reviews: [
    { url: official.url, status: "accepted", summary: "Invented clinical recommendation." },
  ] }));

  assert.equal(result.length, 1);
  assert.equal(result[0].reviewStatus, "uncertain");
  assert.equal(result[0].lowPriority, true);
  assert.equal(result[0].summary, "原始页面暂未提供可解析摘要，请查看原文了解详细更新。");
});

test("rejects title-only journal, news, and video candidates", () => {
  const journal: ArticleInput = {
    ...article(
      "Gynecologic surgery research",
      new Date("2026-08-05T07:00:00.000Z"),
      "",
      "https://www.sciencedirect.com/science/article/pii/title-only",
    ),
    sourceId: "jmig-articles-in-press",
    source: "Journal of Minimally Invasive Gynecology - Articles in Press",
    category: "finance",
    documentType: "research_article",
  };
  const news = article(
    "News update: maternal health",
    new Date("2026-08-05T07:00:00.000Z"),
    "",
    "https://www.acog.org/news/title-only",
  );
  const video = article(
    "Practice Advisory video overview",
    new Date("2026-08-05T07:00:00.000Z"),
    "",
    "https://www.acog.org/video/title-only",
  );

  const result = parseObgynReviewResponse([journal, news, video], JSON.stringify({ reviews: [
    { url: journal.url, status: "uncertain", summary: "" },
    { url: news.url, status: "uncertain", summary: "" },
    { url: video.url, status: "uncertain", summary: "" },
  ] }));

  assert.deepEqual(result, []);
});

test("rejected overrides keyword and authority", () => {
  const authoritativeCandidate = article(
    "Clinical Practice Guideline: pregnancy care",
    new Date("2026-08-05T07:00:00.000Z"),
    "Clinical recommendation details.",
    "https://www.acog.org/clinical/rejected-guideline",
  );

  assert.deepEqual(parseObgynReviewResponse([authoritativeCandidate], JSON.stringify({ reviews: [
    { url: authoritativeCandidate.url, status: "rejected", summary: "Do not keep." },
  ] })), []);
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
