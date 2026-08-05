import assert from "node:assert/strict";
import test from "node:test";

import {
  dedupeResearchPapers,
  normalizeDoi,
  normalizeTitle,
  paperIdentityKeys,
} from "../../lib/research/normalize";
import type { ResearchPaper } from "../../lib/research/types";

function paper(overrides: Partial<ResearchPaper> = {}): ResearchPaper {
  return {
    id: "rss:1",
    doi: "10.1000/ABC",
    title: "A trial of treatment in preeclampsia",
    abstract: "RSS abstract",
    journal: "Example Journal",
    authors: ["A Author"],
    publicationTypes: [],
    activityAt: "2026-08-04T00:00:00.000Z",
    url: "https://journal.example/article",
    sourceKinds: ["journal-rss"],
    matchedTopicIds: ["maternal-fetal-medicine"],
    ...overrides,
  };
}

test("normalizes DOI URLs, casing and terminal punctuation", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1000/ABC."), "10.1000/abc");
  assert.equal(normalizeDoi("doi: 10.1000/ABC)"), "10.1000/abc");
  assert.equal(normalizeDoi(""), undefined);
});

test("normalizes title entities, punctuation and whitespace", () => {
  assert.equal(
    normalizeTitle("  IVF &amp; ICSI — a Trial: Results!  "),
    normalizeTitle("IVF & ICSI - A trial results"),
  );
});

test("identity keys are ordered PMID, DOI, then title", () => {
  assert.deepEqual(
    paperIdentityKeys(paper({ pmid: "123", doi: "10.1000/ABC" })),
    ["pmid:123", "doi:10.1000/abc", "title:a trial of treatment in preeclampsia"],
  );
});

test("prefers PubMed metadata while merging RSS provenance", () => {
  const rss = paper();
  const pubmed = paper({
    id: "pmid:123",
    pmid: "123",
    abstract: "Full PubMed abstract",
    authors: ["A Author", "B Author"],
    publicationTypes: ["Randomized Controlled Trial"],
    url: "https://pubmed.ncbi.nlm.nih.gov/123/",
    sourceKinds: ["pubmed"],
    matchedTopicIds: ["maternal-fetal-medicine", "clinical-surgery"],
  });
  const merged = dedupeResearchPapers([rss, pubmed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].abstract, "Full PubMed abstract");
  assert.equal(merged[0].pmid, "123");
  assert.deepEqual(merged[0].sourceKinds, ["journal-rss", "pubmed"]);
  assert.deepEqual(merged[0].matchedTopicIds, ["clinical-surgery", "maternal-fetal-medicine"]);
});

test("falls back to normalized title when PMID and DOI are absent", () => {
  const first = paper({ id: "rss:1", doi: undefined });
  const second = paper({
    id: "rss:2",
    doi: undefined,
    title: "A trial of treatment — in preeclampsia!",
  });
  assert.equal(dedupeResearchPapers([first, second]).length, 1);
});

test("collapses transitive identity matches", () => {
  const byDoi = paper({ id: "a", pmid: undefined, title: "Alpha title" });
  const bridge = paper({ id: "b", pmid: "77", title: "Alpha title" });
  const byPmid = paper({ id: "c", pmid: "77", doi: undefined, title: "Different title" });
  assert.equal(dedupeResearchPapers([byDoi, bridge, byPmid]).length, 1);
});
