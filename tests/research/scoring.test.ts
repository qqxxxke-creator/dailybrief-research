import assert from "node:assert/strict";
import test from "node:test";

import {
  actionabilityWeight,
  evidenceWeight,
  matchTopics,
  recencyWeight,
  scorePaper,
  selectResearchPapers,
} from "../../lib/research/scoring";
import type {
  ResearchConfig,
  ResearchPaper,
  ResearchTopic,
} from "../../lib/research/types";

const NOW = new Date("2026-08-05T00:00:00.000Z");

function topic(overrides: Partial<ResearchTopic> = {}): ResearchTopic {
  return {
    id: "mfm",
    name: "母胎医学",
    description: "高危妊娠",
    includeKeywords: ["preeclampsia"],
    excludeKeywords: ["animal only"],
    publicationTypes: ["Randomized Controlled Trial"],
    enabled: true,
    ...overrides,
  };
}

function paper(overrides: Partial<ResearchPaper> = {}): ResearchPaper {
  return {
    id: "pmid:1",
    pmid: "1",
    title: "Preeclampsia treatment improves patient outcomes",
    abstract: "A randomized human trial evaluated treatment and patient outcomes in 500 participants.",
    journal: "Example Journal",
    authors: ["A Author"],
    publicationTypes: ["Randomized Controlled Trial"],
    activityAt: "2026-08-04T00:00:00.000Z",
    url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    sourceKinds: ["pubmed"],
    matchedTopicIds: [],
    ...overrides,
  };
}

const EVIDENCE_CASES: Array<[string, number]> = [
  ["Systematic Review", 1],
  ["Meta-Analysis", 1],
  ["Randomized Controlled Trial", 0.95],
  ["Clinical Trial", 0.85],
  ["Prospective Cohort Study", 0.75],
  ["Diagnostic Validation Study", 0.7],
  ["Cohort Study", 0.65],
  ["Case-Control Study", 0.65],
  ["Cross-Sectional Study", 0.65],
  ["Retrospective Study", 0.55],
  ["Feasibility Study", 0.35],
  ["Case Series", 0.35],
  ["Case Reports", 0.2],
  ["Editorial", 0.1],
  ["Comment", 0.1],
  ["Study Protocol", 0.1],
  ["Unmapped Type", 0.4],
];

for (const [publicationType, expected] of EVIDENCE_CASES) {
  test(`maps ${publicationType} to evidence weight ${expected}`, () => {
    assert.equal(evidenceWeight([publicationType]), expected);
  });
}

test("uses the strongest evidence type when multiple are present", () => {
  assert.equal(evidenceWeight(["Editorial", "Meta-Analysis"]), 1);
});

test("classifies clinical actionability without promoting basic research", () => {
  assert.equal(actionabilityWeight(paper()), 1);
  assert.equal(
    actionabilityWeight(
      paper({
        publicationTypes: ["Cohort Study"],
        title: "Maternal cohort outcomes",
        abstract: "A prospective observational cohort described maternal outcomes in routine care.",
      }),
    ),
    0.75,
  );
  assert.equal(
    actionabilityWeight(paper({ publicationTypes: ["Feasibility Study"], title: "Robotic device feasibility" })),
    0.5,
  );
  assert.equal(
    actionabilityWeight(paper({ publicationTypes: [], title: "Mouse model", abstract: "An in vitro animal model of placental cells was studied extensively." })),
    0.25,
  );
  assert.equal(
    actionabilityWeight(
      paper({
        publicationTypes: [],
        title: "Unknown mechanism",
        abstract: "Mechanistic signals were explored without a reported clinical setting.",
      }),
    ),
    0.4,
  );
});

test("maps recency to the four configured bands", () => {
  assert.equal(recencyWeight("2026-08-04T00:00:00.000Z", NOW), 1);
  assert.equal(recencyWeight("2026-08-02T00:00:00.000Z", NOW), 0.75);
  assert.equal(recencyWeight("2026-07-30T00:00:00.000Z", NOW), 0.5);
  assert.equal(recencyWeight("2026-07-28T00:00:00.000Z", NOW), 0);
});

test("scores an RCT deterministically", () => {
  assert.deepEqual(scorePaper(paper(), topic(), NOW), {
    topicMatch: 50,
    evidence: 23.75,
    clinicalActionability: 15,
    recency: 10,
    total: 98.75,
    evidenceRank: 0.95,
  });
});

test("matches title and abstract but honors exclusions", () => {
  const topics = [topic(), topic({ id: "onc", includeKeywords: ["ovarian cancer"] })];
  assert.deepEqual(matchTopics(paper(), topics), ["mfm"]);
  assert.deepEqual(matchTopics(paper({ abstract: `${paper().abstract} animal only` }), topics), []);
});

function config(topics: ResearchTopic[]): ResearchConfig {
  return {
    schemaVersion: 1,
    domainKeywords: ["preeclampsia", "ovarian cancer", "infertility"],
    sources: [],
    topics,
    runtime: {
      enabled: true,
      clearCache: false,
      lookbackDays: 7,
      maxPapers: 5,
      cacheDays: 30,
      overlapHours: 48,
      minScore: 45,
      maxPerTopic: 2,
    },
  };
}

test("filters invalid records and enforces topic and global quotas", () => {
  const topics = [
    topic(),
    topic({ id: "onc", includeKeywords: ["ovarian cancer"] }),
    topic({ id: "repro", includeKeywords: ["infertility"] }),
  ];
  const papers = [
    paper({ id: "m1", pmid: "1" }),
    paper({ id: "m2", pmid: "2", activityAt: "2026-08-03T00:00:00.000Z" }),
    paper({ id: "m3", pmid: "3", activityAt: "2026-08-02T00:00:00.000Z" }),
    paper({ id: "o1", pmid: "4", title: "Ovarian cancer treatment outcomes" }),
    paper({ id: "o2", pmid: "5", title: "Ovarian cancer screening outcomes" }),
    paper({ id: "r1", pmid: "6", title: "Infertility treatment outcomes" }),
    paper({ id: "old", pmid: "7", activityAt: "2026-07-20T00:00:00.000Z" }),
    paper({ id: "empty", pmid: "8", abstract: "" }),
  ];
  const selected = selectResearchPapers(papers, config(topics), NOW);
  assert.equal(selected.length, 5);
  assert.equal(selected.filter((item) => item.assignedTopicId === "mfm").length, 2);
  assert.ok(!selected.some((item) => item.id === "m3"));
  assert.ok(!selected.some((item) => item.id === "old"));
  assert.ok(!selected.some((item) => item.id === "empty"));
});

test("sorts ties by total, evidence, activity date, then id", () => {
  const topics = [topic()];
  const selected = selectResearchPapers(
    [
      paper({ id: "b", pmid: "2" }),
      paper({ id: "a", pmid: "1" }),
    ],
    { ...config(topics), runtime: { ...config(topics).runtime, maxPerTopic: 5 } },
    NOW,
  );
  assert.deepEqual(selected.map((item) => item.id), ["a", "b"]);
});

test("filters guidelines, corrections and retractions", () => {
  const selected = selectResearchPapers(
    [
      paper({ id: "guide", publicationTypes: ["Practice Guideline"] }),
      paper({ id: "correction", title: "Correction: preeclampsia treatment" }),
      paper({ id: "retracted", publicationTypes: ["Retracted Publication"] }),
      paper({ id: "protocol", title: "Protocol for a preeclampsia cohort", publicationTypes: ["Study Protocol"] }),
      paper({ id: "editorial", title: "Preeclampsia editorial", publicationTypes: ["Editorial"] }),
      paper({ id: "comment", title: "Comment on preeclampsia care", publicationTypes: ["Comment"] }),
    ],
    config([topic()]),
    NOW,
  );
  assert.deepEqual(selected, []);
});

test("requires an OB-GYN domain anchor in addition to a broad interest phrase", () => {
  const surgeryTopic = topic({ id: "surgery", includeKeywords: ["surgical outcomes"] });
  const diabetesTopic = topic({ id: "mfm", includeKeywords: ["gestational diabetes"] });
  const noisy = [
    paper({
      id: "running",
      title: "Diabetes Mellitus and Long-Distance Running",
      abstract: "Patients with gestational diabetes were excluded from this endurance review.",
      publicationTypes: ["Systematic Review"],
    }),
    paper({
      id: "neonatal-surgery",
      title: "Surgical outcomes in extremely preterm neonates",
      abstract: "A pediatric surgical database study compared postoperative neonatal outcomes.",
      publicationTypes: ["Journal Article"],
    }),
  ];
  const noisyConfig = config([diabetesTopic, surgeryTopic]);
  noisyConfig.domainKeywords = ["pregnancy", "maternal", "obstetric", "gynecologic"];
  assert.deepEqual(selectResearchPapers(noisy, noisyConfig, NOW), []);
});
