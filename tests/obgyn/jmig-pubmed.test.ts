import assert from "node:assert/strict";
import test from "node:test";
import { fetchJmigProfessionalContent } from "../../lib/sources/jmig-pubmed";

const xml = (types: string, title: string, pmid: string, doi = "") => `<PubmedArticle><MedlineCitation><PMID>${pmid}</PMID><Article><ArticleTitle>${title}</ArticleTitle><Abstract><AbstractText>Substantive abstract.</AbstractText></Abstract><Journal><Title>J Minim Invasive Gynecol</Title><JournalIssue><PubDate><Year>2026</Year><Month>8</Month><Day>1</Day></PubDate></JournalIssue></Journal>${types.split("|").map((t) => `<PublicationType>${t}</PublicationType>`).join("")}</Article></MedlineCitation><PubmedData>${doi ? `<ArticleIdList><ArticleId IdType="doi">${doi}</ArticleId></ArticleIdList>` : ""}</PubmedData></PubmedArticle>`;

test("JMIG routes only explicit professional publication types", async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input); calls.push(url);
    if (new URL(url).pathname.endsWith("/esearch.fcgi")) return new Response(JSON.stringify({ esearchresult: { idlist: ["1", "2", "3", "4", "5"] } }), { status: 200 });
    return new Response(`<PubmedArticleSet>${xml("Editorial", "Editorial on endometriosis", "1")} ${xml("Video Article", "Video article hysteroscopy", "2")} ${xml("Narrative Review", "Narrative review fertility", "3")} ${xml("Original Article", "Original research", "4")} ${xml("Systematic Review", "Systematic review", "5")}</PubmedArticleSet>`);
  };
  const result = await fetchJmigProfessionalContent({ from: new Date("2026-07-01"), to: new Date("2026-08-09"), fetchImpl });
  assert.deepEqual(result.map((x) => [x.title, x.category, x.contentType]), [
    ["Editorial on endometriosis", "politics", "expert_commentary"],
    ["Video article hysteroscopy", "finance", "video_article"],
    ["Narrative review fertility", "politics", "professional_review"],
  ]);
  assert.ok(calls.some((u) => u.includes("1553-4669") && u.includes("EDAT")));
});

test("JMIG supplements a missing PubMed DOI only with an exact Crossref title and ISSN match", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (new URL(url).pathname.endsWith("/esearch.fcgi")) return new Response(JSON.stringify({ esearchresult: { idlist: ["9"] } }));
    return new Response(`<PubmedArticleSet>${xml("Narrative Review", "Exact review title", "9")}</PubmedArticleSet>`);
  };
  const crossrefFetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    message: { items: [{ title: ["Exact review title"], ISSN: ["1553-4669"], DOI: "10.1000/exact" }] },
  }));
  const result = await fetchJmigProfessionalContent({ from: new Date("2026-07-01"), to: new Date("2026-08-09"), fetchImpl, crossrefFetchImpl });
  assert.match(result[0]?.meta ?? "", /10\.1000\/exact/);
});

test("JMIG does not supplement DOI when Crossref title or ISSN does not match", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (new URL(url).pathname.endsWith("/esearch.fcgi")) return new Response(JSON.stringify({ esearchresult: { idlist: ["10"] } }));
    return new Response(`<PubmedArticleSet>${xml("Original Article", "Research title", "10")}</PubmedArticleSet>`);
  };
  const crossrefFetchImpl: typeof fetch = async () => new Response(JSON.stringify({
    message: { items: [{ title: ["Different title"], ISSN: ["0000-0000"], DOI: "10.1000/wrong" }] },
  }));
  const result = await fetchJmigProfessionalContent({ from: new Date("2026-07-01"), to: new Date("2026-08-09"), fetchImpl, crossrefFetchImpl });
  assert.deepEqual(result, []);
});

test("JMIG rejects any record with a hard-excluded type even when an allowed type is also present", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (new URL(url).pathname.endsWith("/esearch.fcgi")) return new Response(JSON.stringify({ esearchresult: { idlist: ["11", "12", "13", "14", "15", "16", "17", "18", "19"] } }));
    const types = ["Editorial|Systematic Review", "Editorial|Randomised Controlled Trial", "Editorial|Clinical Trial", "Editorial|Cohort Study", "Editorial|Case-Control Study", "Editorial|Cross-Sectional Study", "Editorial|Case Report", "Editorial|Protocol", "Unmapped Type"];
    return new Response(`<PubmedArticleSet>${types.map((type, index) => xml(type, `Type ${index}`, String(index + 11))).join("")}</PubmedArticleSet>`);
  };
  const result = await fetchJmigProfessionalContent({ from: new Date("2026-07-01"), to: new Date("2026-08-09"), fetchImpl });
  assert.deepEqual(result, []);
});

test("JMIG supplements missing PubMed date from a strict Crossref match", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (new URL(url).pathname.endsWith("/esearch.fcgi")) return new Response(JSON.stringify({ esearchresult: { idlist: ["20"] } }));
    return new Response(`<PubmedArticleSet>${xml("Narrative Review", "Dated review", "20").replace(/<PubDate>[\s\S]*?<\/PubDate>/, "")}</PubmedArticleSet>`);
  };
  const crossrefFetchImpl: typeof fetch = async () => new Response(JSON.stringify({ message: { items: [{ title: ["Dated review"], ISSN: ["1553-4669"], DOI: "10.1000/dated", "published-online": { "date-parts": [[2026, 7, 20]] } }] } }));
  const result = await fetchJmigProfessionalContent({ from: new Date("2026-07-01"), to: new Date("2026-08-09"), fetchImpl, crossrefFetchImpl });
  assert.equal(result[0]?.publishedAt?.toISOString(), "2026-07-20T00:00:00.000Z");
});

test("JMIG leaves missing date untouched when Crossref title or ISSN mismatches", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (new URL(url).pathname.endsWith("/esearch.fcgi")) return new Response(JSON.stringify({ esearchresult: { idlist: ["21"] } }));
    return new Response(`<PubmedArticleSet>${xml("Narrative Review", "Undated review", "21").replace(/<PubDate>[\s\S]*?<\/PubDate>/, "")}</PubmedArticleSet>`);
  };
  const crossrefFetchImpl: typeof fetch = async () => new Response(JSON.stringify({ message: { items: [{ title: ["Other review"], ISSN: ["0000-0000"], DOI: "10.1000/wrong", published: { "date-parts": [[2026, 7, 20]] } }] } }));
  const result = await fetchJmigProfessionalContent({ from: new Date("2026-07-01"), to: new Date("2026-08-09"), fetchImpl, crossrefFetchImpl });
  assert.equal(result[0]?.publishedAt, undefined);
  assert.doesNotMatch(result[0]?.meta ?? "", /10\.1000\/wrong/);
});

test("JMIG tolerates Crossref failure without blocking eligible content", async () => {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    if (new URL(url).pathname.endsWith("/esearch.fcgi")) return new Response(JSON.stringify({ esearchresult: { idlist: ["22"] } }));
    return new Response(`<PubmedArticleSet>${xml("Editorial", "Crossref unavailable", "22")}</PubmedArticleSet>`);
  };
  const result = await fetchJmigProfessionalContent({ from: new Date("2026-07-01"), to: new Date("2026-08-09"), fetchImpl, crossrefFetchImpl: async () => new Response("", { status: 503 }) });
  assert.equal(result.length, 1);
});

test("JMIG tolerates PubMed failure as an empty source", async () => {
  const result = await fetchJmigProfessionalContent({ from: new Date("2026-07-01"), to: new Date("2026-08-09"), fetchImpl: async () => new Response("", { status: 403 }) });
  assert.deepEqual(result, []);
});
