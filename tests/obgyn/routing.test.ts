import assert from "node:assert/strict";
import test from "node:test";

import { groupRaw } from "../../lib/output/render";
import {
  findLlmRejectedObgynArticles,
  routeObgynArticles,
  selectSupplementalObgynArticles,
} from "../../lib/sources/obgyn-filter";
import type { ArticleInput } from "../../lib/ai/pipeline";
import type { SourceDef } from "../../lib/sources/types";

function source(overrides: Partial<SourceDef>): SourceDef {
  return {
    id: "smfm-publications",
    name: "SMFM Publications",
    type: "scrape",
    url: "https://publications.smfm.org/publications/",
    category: "tech",
    subcategory: "guidelines",
    sourceClass: "official_authority",
    lang: "en",
    lookbackHours: 720,
    ...overrides,
  };
}

function article(origin: SourceDef, overrides: Partial<ArticleInput>): ArticleInput {
  return {
    sourceId: origin.id,
    source: origin.name,
    title: "Professional update",
    url: `https://example.test/${origin.id}`,
    excerpt: "Substantive professional information for clinicians.",
    publishedAt: new Date("2026-08-06T00:00:00.000Z"),
    category: origin.category,
    reviewStatus: "accepted",
    ...overrides,
  };
}

test("routes formal guidance by item type instead of source default category", () => {
  const esgeNews = source({
    id: "esge-news",
    name: "ESGE News",
    category: "finance",
    subcategory: "surgery",
    sourceClass: "professional_vertical",
  });
  const [routed] = routeObgynArticles([
    article(esgeNews, { title: "Consensus on endometrial care", documentType: "consensus" }),
  ], [esgeNews]);

  assert.equal(routed.category, "tech");
});

test("routes surgical techniques and video articles to surgery", () => {
  const gocm = source({ id: "gocm-guidelines", name: "GOCM", sourceClass: "academic_journal" });
  const [routed] = routeObgynArticles([
    article(gocm, {
      title: "Video Article: robotic hysterectomy technique",
      documentType: "video",
      contentType: "video article",
    }),
  ], [gocm]);

  assert.equal(routed.category, "finance");
});

test("routes society news, policy and clinical updates to international or China dynamics", () => {
  const smfm = source({});
  const china = source({
    id: "nhc-maternal-child-health",
    name: "国家卫健委妇幼健康司",
    lang: "zh",
  });
  const routed = routeObgynArticles([
    article(smfm, { title: "SMFM clinical service update", documentType: "news" }),
    article(china, { title: "孕产妇服务政策更新", documentType: "policy", url: "https://example.test/china" }),
  ], [smfm, china]);

  assert.deepEqual(routed.map((item) => item.category), ["politics", "politics"]);
});

test("keeps ambiguous accepted content in its configured source column", () => {
  const smfm = source({});
  const [routed] = routeObgynArticles([
    article(smfm, { title: "Maternal medicine professional resource", documentType: "unknown" }),
  ], [smfm]);

  assert.equal(routed.category, "tech");
});

test("keeps ordinary academic research out of every non-research column", () => {
  const journal = source({
    id: "china-clinical-obgyn-current",
    name: "中国临床妇产科杂志",
    sourceClass: "academic_journal",
    lang: "zh",
  });
  const routed = routeObgynArticles([
    article(journal, {
      title: "妊娠期高血压的多中心队列研究",
      documentType: "research_article",
      contentType: "Original Article",
    }),
    article(journal, {
      title: "子宫颈病变管理中国专家共识",
      documentType: "consensus",
      url: "https://example.test/consensus",
    }),
  ], [journal]);

  assert.deepEqual(routed.map((item) => item.title), ["子宫颈病变管理中国专家共识"]);
  assert.equal(routed[0].category, "tech");
});

test("structured ordinary research cannot masquerade as guidance or clinical news", () => {
  const journal = source({
    id: "jmig-articles-in-press",
    name: "JMIG",
    sourceClass: "academic_journal",
    category: "finance",
    subcategory: "surgery",
  });
  const organization = source({
    id: "smfm-publications",
    name: "SMFM",
    sourceClass: "official_authority",
  });
  const routed = routeObgynArticles([
    article(journal, {
      title: "Clinical update on guideline implementation outcomes",
      documentType: "research_article",
      contentType: "Original Article",
    }),
    article(journal, {
      title: "Systematic review of guideline implementation outcomes",
      url: "https://example.test/systematic-review",
    }),
    article(organization, {
      title: "Maternal guideline implementation cohort study",
      documentType: "research_article",
      url: "https://example.test/smfm-research",
    }),
  ], [journal, organization]);

  assert.deepEqual(routed, []);
});

test("adds only enough supplemental items to reach five and marks existing meta", () => {
  const origin = source({ id: "acog-news", category: "politics", subcategory: "international-obgyn" });
  const priority = [0, 1, 2].map((index) => article(origin, {
    title: `Priority ${index}`,
    url: `https://example.test/priority-${index}`,
  }));
  const supplemental = [0, 1, 2].map((index) => article(origin, {
    title: `Supplement ${index}`,
    url: `https://example.test/supplement-${index}`,
    meta: index === 0 ? "FDA" : undefined,
    publishedAt: new Date(`2026-08-0${5 - index}T00:00:00.000Z`),
  }));

  const selected = selectSupplementalObgynArticles(priority, supplemental, 5);

  assert.equal(selected.length, 5);
  assert.deepEqual(selected.slice(3).map((item) => item.meta), ["近期补充 · FDA", "近期补充"]);
});

test("LLM rejection diagnostics match cloned accepted articles by canonical URL", () => {
  const origin = source({ id: "acog-news", category: "politics", subcategory: "international-obgyn" });
  const acceptedCandidate = article(origin, {
    title: "Accepted clinical update",
    url: "https://example.test/accepted?utm_source=rss",
  });
  const rejectedCandidate = article(origin, {
    title: "Rejected clinical update",
    url: "https://example.test/rejected",
  });

  const rejected = findLlmRejectedObgynArticles(
    [acceptedCandidate, rejectedCandidate],
    [{ ...acceptedCandidate, url: "https://example.test/accepted?utm_medium=email", summary: "摘要" }],
  );

  assert.deepEqual(rejected, [{
    title: rejectedCandidate.title,
    sourceId: rejectedCandidate.sourceId,
    reason: "llm_rejected",
  }]);
});

test("render grouping uses the routed subgroup rather than the source default", () => {
  const smfm = source({});
  const [routed] = routeObgynArticles([
    article(smfm, { title: "SMFM clinical update", documentType: "news" }),
  ], [smfm]);
  const raw = groupRaw([routed], [smfm]);

  assert.equal(raw.tech.flatMap((sub) => sub.sources.flatMap((group) => group.items)).length, 0);
  assert.equal(raw.politics.find((sub) => sub.id === "international-obgyn")
    ?.sources.flatMap((group) => group.items).length, 1);
});
