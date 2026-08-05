import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeResearchWindow,
  loadResearchCache,
  mergeResearchCache,
  saveResearchCacheAtomic,
} from "../../lib/research/cache";
import type { ResearchCache, ResearchPaper, ResearchRuntimeConfig } from "../../lib/research/types";

const NOW = new Date("2026-08-05T12:00:00.000Z");

const runtime: ResearchRuntimeConfig = {
  enabled: true,
  clearCache: false,
  lookbackDays: 7,
  maxPapers: 5,
  cacheDays: 30,
  overlapHours: 48,
  minScore: 45,
  maxPerTopic: 2,
};

function paper(id: string, activityAt: string, abstract = `Abstract for ${id} with enough detail.`): ResearchPaper {
  return {
    id,
    title: `Title ${id}`,
    abstract,
    journal: "Journal",
    authors: [],
    publicationTypes: [],
    activityAt,
    url: `https://example.test/${id}`,
    sourceKinds: ["pubmed"],
    matchedTopicIds: [],
  };
}

test("first run uses the configured lookback window", () => {
  const window = computeResearchWindow({ schemaVersion: 1, papers: [] }, NOW, runtime);
  assert.equal(window.from.toISOString(), "2026-07-29T12:00:00.000Z");
  assert.equal(window.to.toISOString(), NOW.toISOString());
});

test("subsequent runs overlap the last success by 48 hours", () => {
  const window = computeResearchWindow(
    { schemaVersion: 1, lastSuccessfulRun: "2026-08-04T10:00:00.000Z", papers: [] },
    NOW,
    runtime,
  );
  assert.equal(window.from.toISOString(), "2026-08-02T10:00:00.000Z");
});

test("advances last success only when at least one source succeeds", () => {
  const previous: ResearchCache = {
    schemaVersion: 1,
    lastSuccessfulRun: "2026-08-01T00:00:00.000Z",
    papers: [paper("old", "2026-08-01T00:00:00.000Z")],
  };
  assert.equal(
    mergeResearchCache({ previous, fetched: [], successfulSourceCount: 0, now: NOW, retentionDays: 30 }).lastSuccessfulRun,
    previous.lastSuccessfulRun,
  );
  assert.equal(
    mergeResearchCache({ previous, fetched: [], successfulSourceCount: 1, now: NOW, retentionDays: 30 }).lastSuccessfulRun,
    NOW.toISOString(),
  );
});

test("deduplicates new records and drops papers older than retention", () => {
  const previous: ResearchCache = {
    schemaVersion: 1,
    papers: [
      paper("pmid:1", "2026-08-01T00:00:00.000Z", "Old cached abstract with enough detail."),
      paper("expired", "2026-06-01T00:00:00.000Z"),
    ],
  };
  const fresh = paper("pmid:1", "2026-08-04T00:00:00.000Z", "Fresh abstract with enough new detail.");
  fresh.pmid = "1";
  previous.papers[0].pmid = "1";
  const merged = mergeResearchCache({ previous, fetched: [fresh], successfulSourceCount: 1, now: NOW, retentionDays: 30 });
  assert.equal(merged.papers.length, 1);
  assert.equal(merged.papers[0].abstract, "Fresh abstract with enough new detail.");
});

test("round-trips an atomic cache file", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "research-cache-"));
  const file = path.join(directory, "research-cache.json");
  const cache: ResearchCache = { schemaVersion: 1, lastSuccessfulRun: NOW.toISOString(), papers: [paper("one", NOW.toISOString())] };
  saveResearchCacheAtomic(cache, file);
  assert.deepEqual(loadResearchCache(file), cache);
  assert.equal(fs.readdirSync(directory).filter((name) => name.endsWith(".tmp")).length, 0);
  fs.rmSync(directory, { recursive: true, force: true });
});

test("quarantines malformed JSON and recovers with an empty cache", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "research-corrupt-"));
  const file = path.join(directory, "research-cache.json");
  fs.writeFileSync(file, "{not-json", "utf8");
  assert.deepEqual(loadResearchCache(file, false, NOW, () => {}), { schemaVersion: 1, papers: [] });
  assert.ok(fs.readdirSync(directory).some((name) => name.startsWith("research-cache.json.corrupt-2026-08-05")));
  fs.rmSync(directory, { recursive: true, force: true });
});

test("clear-cache mode ignores a valid existing cache", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "research-clear-"));
  const file = path.join(directory, "research-cache.json");
  saveResearchCacheAtomic({ schemaVersion: 1, papers: [paper("one", NOW.toISOString())] }, file);
  assert.deepEqual(loadResearchCache(file, true, NOW), { schemaVersion: 1, papers: [] });
  fs.rmSync(directory, { recursive: true, force: true });
});
