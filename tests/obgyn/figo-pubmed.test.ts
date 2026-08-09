import test from "node:test";
import assert from "node:assert/strict";
import { fetchFigoGuidance } from "../../lib/sources/figo-pubmed";
import { fetchSource } from "../../lib/sources/dispatch";
import { sources } from "../../lib/sources/registry";

const xml = (title: string, types: string, author = "FIGO Committee", abstract = "FIGO Committee guidance abstract", pmid = "9", withDoi = true, withDate = true) => `<PubmedArticleSet><PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article><ArticleTitle>${title}</ArticleTitle><Abstract><AbstractText>${abstract}</AbstractText></Abstract><Journal><Title>Int J Gynaecol Obstet</Title></Journal><AuthorList><Author><CollectiveName>${author}</CollectiveName></Author></AuthorList><PublicationTypeList>${types.split("|").map(t => `<PublicationType>${t}</PublicationType>`).join("")}</PublicationTypeList>${withDate ? '<ArticleDate><Year>2026</Year><Month>8</Month><Day>1</Day></ArticleDate>' : ''}</Article></MedlineCitation><PubmedData><ArticleIdList>${withDoi ? '<ArticleId IdType="doi">10.1/figo</ArticleId>' : ''}</ArticleIdList><History><PubMedPubDate PubStatus="pubmed"><Year>2026</Year><Month>8</Month><Day>2</Day></PubMedPubDate></History></PubmedData></PubmedArticle></PubmedArticleSet>`;
function fakeFetch(body: string): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(input));
    return new Response(url.pathname === "/entrez/eutils/esearch.fcgi" ? JSON.stringify({ esearchresult: { idlist: ["9"] } }) : body, { status: 200 });
  }) as typeof fetch;
}

test("routes FIGO best practice guidance with institutional evidence", async () => {
  const items = await fetchFigoGuidance({ from: new Date("2026-02-01"), to: new Date("2026-08-09"), fetchImpl: fakeFetch(xml("FIGO Best Practice Advice on pregnancy", "Practice Guideline")) });
  assert.equal(items.length, 1); assert.equal(items[0].contentType, "guideline"); assert.equal(items[0].sourceId, "figo-guidance");
  assert.equal(sources.find((source) => source.id === items[0].sourceId)?.enabled, true);
});

test("rejects IJGO research and FIGO mentions without evidence", async () => {
  assert.equal((await fetchFigoGuidance({ from: new Date("2026-02-01"), to: new Date("2026-08-09"), fetchImpl: fakeFetch(xml("FIGO associated outcomes study", "Original Article", "Smith J")) })).length, 0);
});

test("accepts committee consensus metadata and rejects a bare FIGO title mention", async () => {
  const accepted = await fetchFigoGuidance({
    from: new Date("2026-02-01"), to: new Date("2026-08-09"),
    fetchImpl: fakeFetch(xml("FIGO Committee Consensus Statement on postpartum care", "Consensus Development Conference", "FIGO Working Group")),
  });
  assert.equal(accepted.length, 1);

  const rejected = await fetchFigoGuidance({
    from: new Date("2026-02-01"), to: new Date("2026-08-09"),
    fetchImpl: fakeFetch(xml("FIGO guideline adherence outcomes", "Journal Article", "Smith J", "This observational study mentions FIGO guidance.")),
  });
  assert.equal(rejected.length, 0);

  const genericCommittee = await fetchFigoGuidance({
    from: new Date("2026-02-01"), to: new Date("2026-08-09"),
    fetchImpl: fakeFetch(xml("FIGO Statement on postpartum care", "Statement", "International Committee", "This paper reports routine outcomes.")),
  });
  assert.equal(genericCommittee.length, 0);
});

test("hard-excludes mixed formal and research publication types", async () => {
  const items = await fetchFigoGuidance({
    from: new Date("2026-02-01"), to: new Date("2026-08-09"),
    fetchImpl: fakeFetch(xml("FIGO Best Practice Advice on pregnancy", "Practice Guideline|Original Article")),
  });
  assert.equal(items.length, 0);
});

test("supplements only exact IJGO title matches from Crossref and tolerates failures", async () => {
  const fetchImpl = fakeFetch(xml("FIGO Best Practice Advice on pregnancy", "Practice Guideline", "FIGO Committee", "FIGO Committee guidance abstract", "10", false, false));
  const exact = await fetchFigoGuidance({
    from: new Date("2026-02-01"), to: new Date("2026-08-09"), fetchImpl,
    crossrefFetchImpl: async () => new Response(JSON.stringify({ message: { items: [{ title: ["FIGO Best Practice Advice on pregnancy"], ISSN: ["1879-3479"], DOI: "10.1000/figo", "published-online": { "date-parts": [[2026, 7, 20]] } }] } })),
  });
  assert.equal(exact[0].url, "https://doi.org/10.1000/figo");
  assert.equal(exact[0].publishedAt?.toISOString(), "2026-07-20T00:00:00.000Z");

  const mismatch = await fetchFigoGuidance({
    from: new Date("2026-02-01"), to: new Date("2026-08-09"), fetchImpl,
    crossrefFetchImpl: async () => new Response(JSON.stringify({ message: { items: [{ title: ["Different title"], ISSN: ["1879-3479"], DOI: "10.1000/wrong" }] } })),
  });
  assert.equal(mismatch[0].url, "https://pubmed.ncbi.nlm.nih.gov/10/");

  const failed = await fetchFigoGuidance({
    from: new Date("2026-02-01"), to: new Date("2026-08-09"), fetchImpl,
    crossrefFetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.equal(failed.length, 1);
});

test("never dispatches the disabled FIGO main-site scraper", async () => {
  const items = await fetchSource({
    id: "figo-news",
    name: "FIGO News",
    type: "scrape",
    url: "https://www.figo.org/news",
    category: "politics",
    sourceClass: "professional_vertical",
  });
  assert.deepEqual(items, []);
});

test("tolerates PubMed E-utilities failure as an empty source", async () => {
  const items = await fetchFigoGuidance({
    from: new Date("2026-02-01"), to: new Date("2026-08-09"),
    fetchImpl: async () => new Response("", { status: 503 }),
  });
  assert.deepEqual(items, []);
});
