import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchFigoSocietyPubmed } from "../../lib/sources/figo-society-pubmed";
import { fetchSource } from "../../lib/sources/dispatch";
import { capObgynReviewCandidates } from "../../lib/ai/enrich";
import { filterObgynCandidatesWithStats, selectSupplementalObgynArticles } from "../../lib/sources/obgyn-filter";

const article = (title: string, abstract: string, author: string, type = "Journal Article", pmid = "1", doi = "10.1/x") => `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article><ArticleTitle>${title}</ArticleTitle><Abstract><AbstractText>${abstract}</AbstractText></Abstract><Journal><Title>Int J Gynaecol Obstet</Title></Journal><AuthorList><Author><CollectiveName>${author}</CollectiveName></Author></AuthorList><PublicationTypeList><PublicationType>${type}</PublicationType></PublicationTypeList><ArticleDate><Year>2026</Year><Month>8</Month><Day>1</Day></ArticleDate>${doi ? `<ELocationID EIdType="doi">${doi}</ELocationID>` : ""}</Article></MedlineCitation><PubmedData><ArticleIdList></ArticleIdList></PubmedData></PubmedArticle></PubmedArticleSet>`;
const run = async (xml: string, crossrefFetchImpl?: typeof fetch) => fetchFigoSocietyPubmed({ from: new Date("2026-07-01"), to: new Date("2026-08-09"), fetchImpl: async (u: any) => new Response(u.pathname.endsWith("esearch.fcgi") ? JSON.stringify({ esearchresult: { idlist: ["1"] } }) : u.pathname.endsWith("efetch.fcgi") ? xml : "", { headers: { "content-type": "text/xml" } }), crossrefFetchImpl });

test("FIGO society signals and attribution pass; formal guidance and unowned content reject", async () => {
  assert.equal((await run(article("FIGO expert opinion on safety", "FIGO Committee provides practical safety actions", "FIGO Committee"))).length, 1);
  assert.equal((await run(article("FIGO call to action", "Developed by FIGO working group", "FIGO Working Group"))).length, 1);
  assert.equal((await run(article("FIGO guideline", "FIGO Committee guidance", "FIGO Committee"))).length, 0);
  assert.equal((await run(article("Maternal safety perspective", "This paper cites FIGO only", "Smith J"))).length, 0);
  assert.equal((await run(article("FIGO committee editorial", "Editorial discussion", "Smith J", "Editorial"))).length, 0);
  assert.equal((await run(article("FIGO safety comment", "FIGO Committee comment", "FIGO Committee", "Comment"))).length, 0);
});

test("Crossref does not overwrite an existing DOI", async () => {
  const items = await run(article("FIGO expert opinion on safety", "FIGO Committee practical safety", "FIGO Committee", "Journal Article", "2"), async () => new Response(JSON.stringify({ message: { items: [{ title: ["FIGO expert opinion on safety"], ISSN: ["1879-3479"], DOI: "10.9/exact", issued: { "date-parts": [[2026, 7, 20]] } }] } })));
  assert.equal(items[0].url, "https://doi.org/10.1/x");
});

test("Crossref fills a missing DOI for an exact title and ISSN", async () => {
  const items = await run(article("FIGO expert opinion on safety", "FIGO Committee practical safety", "FIGO Committee", "Journal Article", "3", ""), async () => new Response(JSON.stringify({ message: { items: [{ title: ["FIGO expert opinion on safety"], ISSN: ["1879-3479"], DOI: "10.9/exact" }] } })));
  assert.equal(items[0].url, "https://doi.org/10.9/exact");
});

test("Crossref ignores same-title records with a different ISSN", async () => {
  const items = await run(article("FIGO expert opinion on safety", "FIGO Committee practical safety", "FIGO Committee", "Journal Article", "4", ""), async () => new Response(JSON.stringify({ message: { items: [{ title: ["FIGO expert opinion on safety"], ISSN: ["0000-0000"], DOI: "10.9/wrong" }] } })));
  assert.equal(items[0].url, "https://pubmed.ncbi.nlm.nih.gov/4/");
});

test("Editorial content is rejected even with FIGO attribution", async () => {
  assert.equal((await run(article("FIGO safety perspective", "FIGO Committee discussion", "FIGO Committee", "Editorial"))).length, 0);
});

test("Narrative review content is rejected as research", async () => {
  assert.equal((await run(article("FIGO safety perspective", "FIGO Committee discussion", "FIGO Committee", "Narrative Review"))).length, 0);
});

test("ordinary FIGO citation without official attribution is rejected", async () => {
  assert.equal((await run(article("FIGO expert opinion on safety", "This paper cites FIGO only", "Smith J"))).length, 0);
});

test("a personal author name containing FIGO is not official attribution", async () => {
  assert.equal((await run(article("FIGO expert opinion on safety", "FIGO safety actions are discussed", "FIGO Smith"))).length, 0);
});

test("Society entries share LLM cap four with source round-robin", () => {
  const make = (sourceId: string, i: number) => ({ sourceId, source: sourceId, title: `FIGO update ${sourceId} ${i}`, url: `https://x/${sourceId}/${i}`, excerpt: "Committee experts discuss safety and quality.", publishedAt: new Date("2026-08-05"), category: "politics" as const });
  const selected = capObgynReviewCandidates([
    ...Array.from({ length: 6 }, (_, i) => make("figo-podcast", i)),
    ...Array.from({ length: 6 }, (_, i) => make("figo-society-pubmed", i)),
  ]);
  assert.deepEqual(selected.map((x) => x.sourceId), ["figo-podcast", "figo-society-pubmed", "figo-podcast", "figo-society-pubmed"]);
});

test("Society deterministic check cap eight is round-robin across sources", () => {
  const source = (id: string) => ({ id, name: id, type: "rss" as const, url: `https://x/${id}`, category: "politics" as const, sourceClass: "official_authority" as const, enabled: true });
  const make = (sourceId: string, i: number) => ({ sourceId, source: sourceId, title: `FIGO committee experts discuss maternal safety standards ${sourceId === "figo-podcast" ? "Alpha" : "Beta"} ${i}`, url: `https://x/${sourceId}/${i}`, excerpt: "Committee experts explain practical maternal safety and quality improvements for obstetric services.", publishedAt: new Date("2026-08-05"), category: "politics" as const });
  const result = filterObgynCandidatesWithStats([
    ...Array.from({ length: 8 }, (_, i) => make("figo-podcast", i)),
    ...Array.from({ length: 8 }, (_, i) => make("figo-society-pubmed", i)),
  ], [source("figo-podcast"), source("figo-society-pubmed")], new Date("2026-08-06"));
  assert.equal(result.articles.filter((x) => x.sourceId === "figo-podcast").length, 4);
  assert.equal(result.articles.filter((x) => x.sourceId === "figo-society-pubmed").length, 4);
});

test("Society final cap three spans priority and supplemental pools", () => {
  const source = (id: string) => ({ id, name: id, type: "rss" as const, url: `https://x/${id}`, category: "politics" as const, sourceClass: "official_authority" as const, enabled: true });
  const make = (sourceId: string, i: number) => ({ sourceId, source: sourceId, title: `FIGO update ${sourceId} ${i}`, url: `https://x/${sourceId}/${i}`, excerpt: "Committee experts discuss safety and quality.", publishedAt: new Date("2026-08-05"), category: "politics" as const });
  const selected = selectSupplementalObgynArticles([make("figo-podcast", 1), make("figo-society-pubmed", 1)], [make("figo-podcast", 2), make("figo-society-pubmed", 2), make("figo-podcast", 3)], 10, 3, [source("figo-podcast"), source("figo-society-pubmed")]);
  assert.equal(selected.length, 3);
  assert.equal(selected.filter((x) => x.sourceId === "figo-podcast").length, 2);
  assert.equal(selected.filter((x) => x.sourceId === "figo-society-pubmed").length, 1);
});

test("dispatch uses a 30-day FIGO PubMed lookback", async () => {
  const original = globalThis.fetch;
  let term = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("esearch.fcgi")) { term = url.searchParams.get("term") ?? ""; return new Response(JSON.stringify({ esearchresult: { idlist: [] } })); }
    return new Response(JSON.stringify({ message: { items: [] } }));
  }) as typeof fetch;
  try { await fetchSource({ id: "figo-society-pubmed", name: "FIGO Society Updates (PubMed)", type: "api", url: "https://eutils.ncbi.nlm.nih.gov/entrez/eutils", category: "politics", sourceClass: "official_authority", enabled: true }); }
  finally { globalThis.fetch = original; }
  const dates = term.match(/(\d{4}\/\d{2}\/\d{2}):(\d{4}\/\d{2}\/\d{2})/);
  assert.ok(dates);
  const span = Date.parse(dates![2].replaceAll("/", "-")) - Date.parse(dates![1].replaceAll("/", "-"));
  assert.ok(span >= 29 * 86400000 && span <= 31 * 86400000);
});
