import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import Parser from "rss-parser";

import { fetchJournalRssPapers } from "../../lib/research/sources/journal-rss";
import type { ResearchSourceConfig } from "../../lib/research/types";

const FROM = new Date("2026-07-30T00:00:00.000Z");
const TO = new Date("2026-08-05T23:59:59.999Z");

const source: ResearchSourceConfig = {
  id: "example-rss",
  name: "Example OBGYN Journal",
  kind: "journal-rss",
  url: "https://journal.example/current.rss",
  enabled: true,
};

async function fixtureFeed() {
  const xml = fs.readFileSync(path.resolve("tests/fixtures/research/journal-rss.xml"), "utf8");
  const parser = new Parser({
    customFields: {
      item: [["content:encoded", "contentEncoded"], ["dc:creator", "dcCreator"], ["dc:identifier", "dcIdentifier"]],
    },
  });
  return parser.parseString(xml);
}

test("maps RSS metadata, strips HTML and normalizes DOI", async () => {
  const feed = await fixtureFeed();
  const result = await fetchJournalRssPapers({
    source,
    from: FROM,
    to: TO,
    parser: { parseURL: async () => feed },
  });
  assert.equal(result.papers.length, 1);
  assert.deepEqual(result.papers[0], {
    id: "doi:10.2000/robot.1",
    doi: "10.2000/robot.1",
    title: "Robotic surgery & recovery outcomes",
    abstract: "A prospective clinical study evaluated recovery outcomes in 240 patients after robotic surgery.",
    journal: "Example OBGYN Journal",
    authors: ["Alice Smith", "Bo Lee"],
    publicationTypes: [],
    publishedAt: "2026-08-03T12:00:00.000Z",
    activityAt: "2026-08-03T12:00:00.000Z",
    url: "https://journal.example/robotic-study",
    sourceKinds: ["journal-rss"],
    matchedTopicIds: [],
  });
});

test("counts missing abstracts and out-of-window items", async () => {
  const feed = await fixtureFeed();
  const result = await fetchJournalRssPapers({
    source,
    from: FROM,
    to: TO,
    parser: { parseURL: async () => feed },
  });
  assert.deepEqual(result.rejected, { missingAbstract: 1, outOfWindow: 1 });
});

test("surfaces parser errors with the configured source id", async () => {
  await assert.rejects(
    () =>
      fetchJournalRssPapers({
        source,
        from: FROM,
        to: TO,
        parser: { parseURL: async () => { throw new Error("feed unavailable"); } },
      }),
    /\[research:example-rss\].*feed unavailable/,
  );
});

test("uses the shared exclusive GOCM section classifier", async () => {
  const gocmSource: ResearchSourceConfig = {
    ...source,
    id: "gocm-rss",
    name: "Gynecology and Obstetrics Clinical Medicine",
  };
  const result = await fetchJournalRssPapers({
    source: gocmSource,
    from: FROM,
    to: TO,
    parser: {
      parseURL: async () => ({
        items: [
          {
            title: "Laparoscopic guideline update",
            link: "https://gocm.bmj.com/guideline",
            pubDate: "Tue, 04 Aug 2026 01:00:00 GMT",
            prismSection: "Guideline",
            description: "A clinical guideline for laparoscopic gynecologic surgery and patient care.",
          },
          {
            title: "Robotic surgical technique",
            link: "https://gocm.bmj.com/video",
            pubDate: "Tue, 04 Aug 2026 02:00:00 GMT",
            prismSection: "Video Article",
            description: "A surgical video describing robotic gynecologic technique and outcomes.",
          },
          {
            title: "Laparoscopic guideline outcomes cohort",
            link: "https://gocm.bmj.com/research",
            pubDate: "Tue, 04 Aug 2026 03:00:00 GMT",
            prismSection: "Original research",
            description: "A prospective cohort evaluated maternal and gynecologic clinical outcomes.",
          },
        ],
      }),
    },
  });

  assert.deepEqual(result.papers.map((paper) => paper.url), ["https://gocm.bmj.com/research"]);
  assert.deepEqual(result.rejected, { routedToGuidelineOrSurgery: 2 });
});
