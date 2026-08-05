import assert from "node:assert/strict";
import test from "node:test";

import {
  parseResearchConfig,
  type ResearchConfigInput,
} from "../../lib/research/config";

function validConfig(): ResearchConfigInput {
  return {
    schema_version: 1,
    domain_keywords: ["pregnancy", "preeclampsia", "gynecologic"],
    runtime: {
      lookback_days: 7,
      max_papers: 5,
      cache_days: 30,
      overlap_hours: 48,
      min_score: 45,
      max_per_topic: 2,
    },
    sources: [
      {
        id: "pubmed",
        name: "PubMed",
        kind: "pubmed",
        url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils",
        enabled: true,
      },
    ],
    topics: [
      {
        id: "mfm",
        name: "母胎医学",
        description: "高危妊娠",
        include_keywords: ["preeclampsia"],
        exclude_keywords: ["animal only"],
        publication_types: ["Randomized Controlled Trial"],
        enabled: true,
      },
      {
        id: "gyn-onc",
        name: "妇科肿瘤",
        description: "妇科恶性肿瘤",
        include_keywords: ["ovarian cancer"],
        exclude_keywords: [],
        publication_types: ["Clinical Trial"],
        enabled: true,
      },
    ],
  };
}

test("parses snake_case boundary fields into typed runtime config", () => {
  const config = parseResearchConfig(validConfig(), {});
  assert.equal(config.schemaVersion, 1);
  assert.deepEqual(config.domainKeywords, ["pregnancy", "preeclampsia", "gynecologic"]);
  assert.equal(config.topics[0].includeKeywords[0], "preeclampsia");
  assert.equal(config.sources[0].kind, "pubmed");
  assert.equal(config.runtime.enabled, true);
});

test("rejects duplicate topic ids with a field path", () => {
  const input = validConfig();
  input.topics[1].id = input.topics[0].id;
  assert.throws(
    () => parseResearchConfig(input, {}),
    /topics\[1\]\.id.*duplicate/,
  );
});

test("rejects empty include keyword lists", () => {
  const input = validConfig();
  input.topics[0].include_keywords = [];
  assert.throws(
    () => parseResearchConfig(input, {}),
    /topics\[0\]\.include_keywords.*non-empty/,
  );
});

test("rejects unsupported research source kinds", () => {
  const input = validConfig();
  input.sources[0].kind = "website" as "pubmed";
  assert.throws(
    () => parseResearchConfig(input, {}),
    /sources\[0\]\.kind.*pubmed.*journal-rss/,
  );
});

test("environment overrides bounded runtime values", () => {
  const config = parseResearchConfig(validConfig(), {
    RESEARCH_ENABLED: "false",
    RESEARCH_LOOKBACK_DAYS: "5",
    MAX_RESEARCH_PAPERS: "4",
    RESEARCH_CACHE_DAYS: "21",
    CLEAR_RESEARCH_CACHE: "true",
  });
  assert.equal(config.runtime.enabled, false);
  assert.equal(config.runtime.lookbackDays, 5);
  assert.equal(config.runtime.maxPapers, 4);
  assert.equal(config.runtime.cacheDays, 21);
  assert.equal(config.runtime.clearCache, true);
});

test("rejects out-of-range environment values", () => {
  assert.throws(
    () => parseResearchConfig(validConfig(), { MAX_RESEARCH_PAPERS: "21" }),
    /MAX_RESEARCH_PAPERS.*between 1 and 20/,
  );
  assert.throws(
    () => parseResearchConfig(validConfig(), { RESEARCH_LOOKBACK_DAYS: "-1" }),
    /RESEARCH_LOOKBACK_DAYS.*between 1 and 30/,
  );
});
