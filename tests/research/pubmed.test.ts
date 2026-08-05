import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildPubMedQuery,
  fetchPubMedPapers,
  parsePubMedXml,
} from "../../lib/research/sources/pubmed";
import type { ResearchTopic } from "../../lib/research/types";

const FIXTURES = path.resolve("tests/fixtures/research");
const FROM = new Date("2026-07-30T00:00:00.000Z");
const TO = new Date("2026-08-05T00:00:00.000Z");

function topics(): ResearchTopic[] {
  return [
    {
      id: "mfm",
      name: "母胎医学",
      description: "高危妊娠",
      includeKeywords: ["preeclampsia", "preterm birth"],
      excludeKeywords: [],
      publicationTypes: ["Randomized Controlled Trial"],
      enabled: true,
    },
    {
      id: "disabled",
      name: "停用",
      description: "停用",
      includeKeywords: ["must-not-appear"],
      excludeKeywords: [],
      publicationTypes: [],
      enabled: false,
    },
  ];
}

test("builds a date-bounded OR query from enabled interests", () => {
  const query = buildPubMedQuery(topics(), FROM, TO);
  assert.match(query, /preeclampsia\[Title\/Abstract\]/);
  assert.match(query, /preterm birth\[Title\/Abstract\]/);
  assert.match(query, /2026\/07\/30:2026\/08\/05\[EDAT\]/);
  assert.doesNotMatch(query, /must-not-appear/);
});

test("parses structured abstracts and PubMed metadata", () => {
  const xml = fs.readFileSync(path.join(FIXTURES, "pubmed-efetch.xml"), "utf8");
  const papers = parsePubMedXml(xml);
  assert.equal(papers.length, 2);
  assert.deepEqual(papers[0], {
    id: "pmid:123",
    pmid: "123",
    doi: "10.1000/abc",
    title: "Preeclampsia treatment & maternal outcomes",
    abstract: "BACKGROUND: The optimal treatment remains uncertain.\nRESULTS: Treatment reduced the primary outcome from 20% to 12%.",
    journal: "American Journal of Obstetrics and Gynecology",
    authors: ["Alice Smith", "OBGYN Trial Group"],
    publicationTypes: ["Randomized Controlled Trial"],
    publishedAt: "2026-08-03T00:00:00.000Z",
    activityAt: "2026-08-04T00:00:00.000Z",
    url: "https://pubmed.ncbi.nlm.nih.gov/123/",
    sourceKinds: ["pubmed"],
    matchedTopicIds: [],
  });
  assert.equal(papers[1].abstract, "");
  assert.equal(papers[1].activityAt, "2026-08-02T00:00:00.000Z");
});

test("runs ESearch then batches IDs through EFetch", async () => {
  const calls: URL[] = [];
  const esearch = fs.readFileSync(path.join(FIXTURES, "pubmed-esearch.json"), "utf8");
  const efetch = fs.readFileSync(path.join(FIXTURES, "pubmed-efetch.xml"), "utf8");
  const fakeFetch: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    return new Response(url.pathname.endsWith("esearch.fcgi") ? esearch : efetch, {
      status: 200,
      headers: { "content-type": url.pathname.endsWith("esearch.fcgi") ? "application/json" : "application/xml" },
    });
  };

  const result = await fetchPubMedPapers({ topics: topics(), from: FROM, to: TO, fetchImpl: fakeFetch });
  assert.equal(result.sourceId, "pubmed");
  assert.equal(result.papers.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].searchParams.get("datetype"), "edat");
  assert.equal(calls[0].searchParams.get("retmax"), "200");
  assert.equal(calls[1].searchParams.get("id"), "123,124");
  assert.equal(calls[1].searchParams.get("retmode"), "xml");
});

test("surfaces HTTP failures with the source id", async () => {
  const fakeFetch: typeof fetch = async () => new Response("rate limited", { status: 429 });
  await assert.rejects(
    () => fetchPubMedPapers({ topics: topics(), from: FROM, to: TO, fetchImpl: fakeFetch }),
    /\[research:pubmed\].*HTTP 429/,
  );
});
