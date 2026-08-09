import assert from "node:assert/strict";
import test from "node:test";
import { fetchRss } from "../../lib/sources/rss";
import { filterObgynCandidatesWithStats, selectSupplementalObgynArticles, routeObgynArticles } from "../../lib/sources/obgyn-filter";
import { parseObgynReviewResponse, capObgynReviewCandidates } from "../../lib/ai/enrich";
import { fetchSource } from "../../lib/sources/dispatch";
import type { SourceDef } from "../../lib/sources/types";

const source: SourceDef = { id: "figo-podcast", name: "FIGO Society Updates", type: "rss", url: "https://media.rss.com/figo/feed.xml", category: "politics", subcategory: "international-obgyn", sourceClass: "official_authority", enabled: true };
const xml = `<rss version="2.0"><channel>
<item><title>FIGO committee experts discuss maternal safety standards</title><guid>figo-committee-1</guid><link>https://media.rss.com/figo/committee-1</link><pubDate>Wed, 05 Aug 2026 07:00:00 GMT</pubDate><description>Committee experts explain practical maternal safety and quality improvements for obstetric services.</description></item>
<item><title>Clinical practice discussion on respectful maternity care</title><guid>figo-clinical-2</guid><link>https://media.rss.com/figo/clinical-2</link><pubDate>Wed, 30 Jul 2026 07:00:00 GMT</pubDate><description>FIGO specialists discuss clinical practice and implementation without issuing a formal guideline.</description></item>
<item><title>Register for FIGO congress webinar</title><guid>figo-promo-3</guid><link>https://media.rss.com/figo/promo-3</link><pubDate>Wed, 05 Aug 2026 07:00:00 GMT</pubDate><description>Join us for a webinar on maternal safety; registration and schedule details are available now.</description></item>
<item><title>FIGO update</title><guid>https://media.rss.com/figo/guid-fallback</guid><pubDate>Wed, 05 Aug 2026 07:00:00 GMT</pubDate><description>Brief.</description></item>
</channel></rss>`;

test("FIGO RSS fixture parses and admits professional updates while rejecting promo/missing content", async () => {
  const items = await fetchRss(source.id, source.url, source.category, { limit: 8, fetchImpl: (async () => new Response(xml)) as typeof fetch });
  assert.equal(items.length, 4);
  assert.equal(items[3].url, "https://media.rss.com/figo/guid-fallback");
  const result = filterObgynCandidatesWithStats(items.map((item) => ({ ...item, source: source.name })), [source], new Date("2026-08-06T00:00:00Z"));
  assert.deepEqual(result.articles.map((x) => x.title), ["FIGO committee experts discuss maternal safety standards", "Clinical practice discussion on respectful maternity care"]);
});

test("FIGO final source cap is two across pools", () => {
  const make = (i: number) => ({ sourceId: source.id, source: source.name, title: `FIGO committee update ${i}`, url: `https://x/${i}`, excerpt: "Committee experts discuss clinical practice and quality.", publishedAt: new Date("2026-08-05T00:00:00Z"), category: "politics" as const });
  const selected = selectSupplementalObgynArticles([make(1), make(2), make(3)], [make(4)], 0, 20, [source]);
  assert.equal(selected.length, 2);
});

test("committee substantive description enters politics international dynamics", async () => {
  const items = await fetchRss(source.id, source.url, source.category, { fetchImpl: (async () => new Response(xml)) as typeof fetch });
  const result = filterObgynCandidatesWithStats(items.map((x) => ({ ...x, source: source.name })), [source], new Date("2026-08-06"));
  assert.equal(result.articles[0].category, "politics");
  assert.equal(source.subcategory, "international-obgyn");
});

test("clinical practice discussion passes without guidance phrase", () => {
  const item = { sourceId: source.id, source: source.name, title: "Clinical practice discussion", url: "https://x/clinical", excerpt: "FIGO specialists discuss clinical practice implementation and patient safety.", publishedAt: new Date("2026-08-05"), category: "politics" as const };
  const result = filterObgynCandidatesWithStats([item], [source], new Date("2026-08-06"));
  assert.equal(result.articles.length, 1); assert.equal(result.articles[0].category, "politics");
  assert.equal(routeObgynArticles(result.articles, [source])[0].category, "politics");
});

test("congress/activity promotion is rejected", () => {
  const item = { sourceId: source.id, source: source.name, title: "Register for congress activity", url: "https://x/promo", excerpt: "Join us for a webinar on maternal safety; registration and schedule details.", publishedAt: new Date("2026-08-05"), category: "politics" as const };
  assert.equal(filterObgynCandidatesWithStats([item], [source], new Date("2026-08-06")).articles.length, 0);
});

test("missing pubDate and missing/short descriptions are rejected", () => {
  const base = { sourceId: source.id, source: source.name, title: "Clinical practice discussion", category: "politics" as const };
  const noDate = { ...base, url: "https://x/nodate", excerpt: "Committee experts discuss clinical practice." };
  const noDesc = { ...base, url: "https://x/nodesc", publishedAt: new Date("2026-08-05") };
  const short = { ...base, title: "Update", url: "https://x/short", publishedAt: new Date("2026-08-05"), excerpt: "Brief." };
  const noDateResult = filterObgynCandidatesWithStats([noDate as any], [source], new Date("2026-08-06"));
  const noDescResult = filterObgynCandidatesWithStats([noDesc as any], [source], new Date("2026-08-06"));
  const shortResult = filterObgynCandidatesWithStats([short], [source], new Date("2026-08-06"));
  assert.equal(noDateResult.articles.length, 0); assert.equal(noDateResult.rejections[0].reason, "invalid_item");
  assert.equal(noDescResult.articles.length, 0); assert.equal(noDescResult.rejections[0].reason, "missing_excerpt");
  assert.equal(shortResult.articles.length, 0); assert.ok(shortResult.rejections.length > 0);
});

test("uncertain FIGO LLM review is rejected", () => {
  const item = { sourceId: source.id, source: source.name, title: "Committee update", url: "https://x/u", excerpt: "Committee experts discuss clinical practice.", publishedAt: new Date("2026-08-05"), category: "politics" as const };
  assert.equal(parseObgynReviewResponse([item], JSON.stringify({ reviews: [{ url: item.url, status: "uncertain" }] })).length, 0);
});

test("FIGO fetch, LLM and final caps are 8, 2 and 2", async () => {
  const items = await fetchRss(source.id, source.url, source.category, { limit: 8, fetchImpl: (async () => new Response(`<rss version="2.0"><channel>${Array.from({ length: 9 }, (_, i) => `<item><title>Committee ${i}</title><link>https://x/${i}</link><pubDate>Wed, 05 Aug 2026 07:00:00 GMT</pubDate><description>Committee experts discuss clinical practice.</description></item>`).join("")}</channel></rss>`)) as typeof fetch });
  assert.equal(items.length, 8); assert.equal(capObgynReviewCandidates(items.map((x) => ({ ...x, source: source.name }))).length, 2);
  assert.equal(selectSupplementalObgynArticles(items.map((x) => ({ ...x, source: source.name })), [], 0, 20, [source]).length, 2);
});

test("disabled FIGO main-site source never calls network", async () => {
  let called = false; const original = globalThis.fetch; globalThis.fetch = (async () => { called = true; throw new Error("network"); }) as typeof fetch;
  try { assert.deepEqual(await fetchSource({ id: "figo-news", name: "FIGO News", type: "scrape", url: "https://www.figo.org/news", category: "politics", subcategory: "international-obgyn", sourceClass: "professional_vertical", enabled: false }), []); } finally { globalThis.fetch = original; }
  assert.equal(called, false);
});
