import assert from "node:assert/strict";
import test from "node:test";

import { parseObgynPageHtml } from "../../lib/sources/obgyn-pages";
import type { SourceDef } from "../../lib/sources/types";

const source: SourceDef = {
  id: "rcog-guidance",
  name: "RCOG Guidance",
  type: "scrape",
  url: "https://www.rcog.org.uk/guidance/browse-all-guidance/",
  category: "tech",
  sourceClass: "official_authority",
  subcategory: "guidelines",
  keywords: ["Green-top Guideline", "Good Practice Paper"],
  excludeKeywords: ["historical unchanged documents"],
};

test("parses matching dated links and resolves canonical URLs", () => {
  const html = `
    <main>
      <article>
        <h2><a href="/guidance/browse-all-guidance/green-top-guidelines/birth-after-previous-caesarean-birth-green-top-guideline-no-45/">Birth after previous caesarean birth</a></h2>
        <p>Green-top Guideline · Updated 5 August 2026</p>
      </article>
      <article>
        <h2><a href="/careers">Careers at RCOG</a></h2>
        <p>5 August 2026</p>
      </article>
    </main>`;

  const items = parseObgynPageHtml(source, html);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Birth after previous caesarean birth");
  assert.equal(
    items[0].url,
    "https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/birth-after-previous-caesarean-birth-green-top-guideline-no-45/",
  );
  assert.equal(items[0].publishedAt?.toISOString(), "2026-08-05T00:00:00.000Z");
  assert.equal(items[0].category, "tech");
});

test("annotates explicit professional update and technique types without changing the page schema", () => {
  const newsSource: SourceDef = {
    ...source,
    id: "acog-news",
    name: "ACOG News",
    url: "https://www.acog.org/news",
    category: "politics",
    sourceClass: "professional_vertical",
    subcategory: "international-obgyn",
    keywords: ["Clinical practice update", "Society news"],
  };
  const html = `
    <main>
      <article><a href="/news/clinical-update">Clinical practice update for maternal safety</a><time datetime="2026-08-05">5 August 2026</time><p>Implementation details for obstetric clinicians.</p></article>
      <article><a href="/news/society-update">Society news: obstetric quality programme</a><time datetime="2026-08-05">5 August 2026</time><p>Professional standards and measurable quality actions.</p></article>
    </main>`;

  assert.deepEqual(
    parseObgynPageHtml(newsSource, html).map((item) => item.contentType),
    ["clinical_update", "society_update"],
  );
});

test("does not emit navigation or excluded links", () => {
  const html = `
    <nav><a href="/guidance">Guidance</a></nav>
    <article><a href="/old">Historical unchanged documents</a><time datetime="2026-08-05">5 August 2026</time></article>`;
  assert.deepEqual(parseObgynPageHtml(source, html), []);
});

test("does not attribute off-site links to the configured authority", () => {
  const html = `
    <article>
      <a href="https://sponsor.example/clinical-practice-guideline">Clinical Practice Guideline: pregnancy</a>
      <time datetime="2026-08-05">5 August 2026</time>
    </article>`;
  assert.deepEqual(parseObgynPageHtml(source, html), []);
});
