import assert from "node:assert/strict";
import test from "node:test";
import { fetchRss, getRssDiagnostics, resetRssDiagnostics } from "../../lib/sources/rss";
import { capObgynReviewCandidates } from "../../lib/ai/enrich";
import { filterObgynCandidatesWithStats, selectSupplementalObgynArticles } from "../../lib/sources/obgyn-filter";
import { parseObgynReviewResponse } from "../../lib/ai/enrich";
import { filterPreviouslyPublishedArticlesWithStats } from "../../lib/sources/guideline-history";
import fs from "node:fs"; import os from "node:os"; import path from "node:path";
const mx = { id: "medical-xpress-obgyn", name: "Medical Xpress", url: "https://x.test", category: "politics" as const, keywords: ["guideline", "practice"] };
const mp = { id: "medpage-today-headlines", name: "MedPage", url: "https://m.test", category: "politics" as const, keywords: ["pregnancy", "obstetric"] };

test("RSS malformed and empty fixtures are non-blocking with diagnostics", async () => {
  resetRssDiagnostics();
  const fetchImpl = (async () => new Response("<not-rss", { status: 200 })) as typeof fetch;
  assert.deepEqual(await fetchRss("medical-xpress-obgyn", "https://fixture", "politics", { fetchImpl }), []);
  assert.equal(getRssDiagnostics("medical-xpress-obgyn").feed_parse_failure, 1);
  const empty = (async () => new Response("", { status: 200 })) as typeof fetch;
  assert.deepEqual(await fetchRss("medpage-today-headlines", "https://fixture", "politics", { fetchImpl: empty }), []);
  assert.equal(getRssDiagnostics("medpage-today-headlines").fetch_zero_items, 1);
});

test("normal RSS fixture preserves fields and limit eight", async () => {
  resetRssDiagnostics();
  const xml = `<rss version="2.0"><channel>${Array.from({ length: 9 }, (_, i) => `<item><title>Practice update ${i}</title><link>https://x.test/${i}</link><pubDate>Wed, 05 Aug 2026 07:00:00 GMT</pubDate><description>Substantive clinical recommendations ${i}</description></item>`).join("")}</channel></rss>`;
  const items = await fetchRss("medical-xpress-obgyn", "https://fixture", "politics", { limit: 8, fetchImpl: (async () => new Response(xml)) as typeof fetch });
  assert.equal(items.length, 8); assert.equal(items[0].title, "Practice update 0"); assert.equal(items[0].url, "https://x.test/0"); assert.ok(items[0].publishedAt); assert.match(items[0].excerpt ?? "", /Substantive clinical/);
});

test("LLM caps are explicit for both trial sources", () => {
  const mk = (sourceId: string, n: number) => Array.from({ length: n }, (_, i) => ({ sourceId, source: sourceId, title: `x${i}`, url: `https://x/${sourceId}/${i}`, category: "politics" as const }));
  assert.equal(capObgynReviewCandidates([...mk("medical-xpress-obgyn", 8)]).length, 4);
  assert.equal(capObgynReviewCandidates([...mk("medpage-today-headlines", 8)]).length, 2);
});

test("Medical Xpress deterministic gates and MedPage dual gate", () => {
  const now = new Date("2026-08-05T08:00:00Z");
  const mk = (sourceId: string, title: string, excerpt: string, publishedAt: Date | undefined) => ({ sourceId, source: sourceId, title, url: `https://fixture/${Math.random()}`, excerpt, publishedAt, category: "politics" as const });
  const good = mk(mx.id, "Clinical practice guideline update", "Substantive clinical recommendations for maternal safety.", now);
  const bad = [mk(mx.id, "Study reports mechanism", "Study found mechanism.", now), mk(mx.id, "Animal study", "Animal research.", now), mk(mx.id, "Cell in-vitro study", "Cell culture.", now), mk(mx.id, "Practice update", "", now), mk(mx.id, "Practice update", "Short", undefined)];
  const result = filterObgynCandidatesWithStats([good, ...bad], [{ ...mx, type: "rss", sourceClass: "professional_vertical" } as any], now);
  assert.equal(result.articles.length, 1); assert.ok(result.rejections.some((r) => r.reason === "ordinary_research_article")); assert.ok(result.rejections.some((r) => r.reason === "missing_excerpt"));
  const medGood = mk(mp.id, "Pregnancy obstetric practice", "Clinical update", now); const medOne = mk(mp.id, "Pregnancy update", "Clinical update", now);
  assert.equal(filterObgynCandidatesWithStats([medGood], [{ ...mp, type: "rss", sourceClass: "professional_vertical" } as any], now).articles.length, 1); assert.equal(filterObgynCandidatesWithStats([medOne], [{ ...mp, keywords: ["gynecolog"], type: "rss", sourceClass: "professional_vertical" } as any], now).articles.length, 0);
});

test("uncertain review responses are rejected for both RSS sources", () => {
  const items = [mx, mp].map((s) => ({ sourceId: s.id, source: s.name, title: "Practice update", url: `https://fixture/${s.id}`, excerpt: "Substantive clinical update", publishedAt: new Date("2026-08-05T00:00:00Z"), category: "politics" as const }));
  const response = JSON.stringify({ reviews: items.map((i) => ({ url: i.url, status: "uncertain", summary: "uncertain" })) });
  assert.equal(parseObgynReviewResponse(items, response).length, 0);
});

test("display history rejects new-source URL and title duplicates", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rss-history-")); const prior = path.join(dir, "2026-08-04"); fs.mkdirSync(prior); fs.writeFileSync(path.join(prior, "2026-08-04-displayed.json"), JSON.stringify([{ sourceId: mx.id, title: "Practice Update", url: "https://fixture/a" }]));
  const items = ["https://fixture/a?utm_source=x", "https://fixture/b"].map((url, i) => ({ sourceId: mx.id, source: mx.name, title: i ? "practice-update" : "Other", url, excerpt: "x", publishedAt: new Date("2026-08-05T00:00:00Z"), category: "politics" as const }));
  const result = filterPreviouslyPublishedArticlesWithStats(items, dir, "2026-08-05"); assert.deepEqual(result.articles, []); assert.equal(result.rejectedByUrl, 1); assert.equal(result.rejectedByTitle, 1);
});

test("final source caps apply across priority and supplemental pools", () => {
  const make = (id: string, n: number) => Array.from({ length: n }, (_, i) => ({ sourceId: id, source: id, title: `${id}-${i}`, url: `https://fixture/${id}/${i}`, excerpt: "substantive clinical update", publishedAt: new Date("2026-08-05T00:00:00Z"), category: "politics" as const }));
  const result = selectSupplementalObgynArticles(make(mx.id, 4).concat(make(mp.id, 2)), make(mx.id, 4).concat(make(mp.id, 2)), 0, 20, [{ ...mx, type: "rss", sourceClass: "professional_vertical" } as any, { ...mp, type: "rss", sourceClass: "professional_vertical" } as any]);
  assert.equal(result.filter((x) => x.sourceId === mx.id).length, 3); assert.equal(result.filter((x) => x.sourceId === mp.id).length, 1);
});

test("RSS 403 and timeout remain non-blocking with diagnostics", async () => {
  resetRssDiagnostics();
  const forbidden = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;
  assert.deepEqual(await fetchRss(mx.id, mx.url, mx.category, { fetchImpl: forbidden }), []);
  assert.equal(getRssDiagnostics(mx.id).fetch_http_403, 1);
  const timeout = (async () => { throw new Error("timeout"); }) as typeof fetch;
  assert.deepEqual(await fetchRss(mp.id, mp.url, mp.category, { fetchImpl: timeout }), []);
});
