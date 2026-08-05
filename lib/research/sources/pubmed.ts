import { normalizeDoi } from "../normalize";
import type { ResearchFetchResult, ResearchPaper, ResearchTopic } from "../types";

const DEFAULT_BASE_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const BATCH_SIZE = 100;

function formatPubMedDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}/${month}/${day}`;
}

export function buildPubMedQuery(
  topics: ResearchTopic[],
  domainKeywords: string[],
  from: Date,
  to: Date,
): string {
  const keywords = [...new Set(
    topics
      .filter((topic) => topic.enabled)
      .flatMap((topic) => topic.includeKeywords.map((keyword) => keyword.trim()))
      .filter(Boolean),
  )];
  if (keywords.length === 0) throw new Error("[research:pubmed] no enabled interest keywords");
  if (domainKeywords.length === 0) throw new Error("[research:pubmed] no OB-GYN domain keywords");
  const interests = keywords.map((keyword) => `${keyword}[Title/Abstract]`).join(" OR ");
  const domain = [...new Set(domainKeywords.map((keyword) => keyword.trim()).filter(Boolean))]
    .map((keyword) => `${keyword}[Title/Abstract]`)
    .join(" OR ");
  return `((${interests})) AND (${domain}) AND ${formatPubMedDate(from)}:${formatPubMedDate(to)}[EDAT]`;
}

function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string): string {
  return decodeXml(value.replace(/<[^>]+>/g, " "));
}

function blocks(value: string, tag: string): string[] {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...value.matchAll(expression)].map((match) => match[1]);
}

function tagged(value: string, tag: string): string | undefined {
  const block = blocks(value, tag)[0];
  return block === undefined ? undefined : stripTags(block);
}

function blockWithAttributes(value: string, tag: string): Array<{ attributes: string; body: string }> {
  const expression = new RegExp(`<${tag}([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...value.matchAll(expression)].map((match) => ({ attributes: match[1], body: match[2] }));
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDateBlock(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const year = Number(tagged(value, "Year"));
  const monthRaw = tagged(value, "Month") ?? "1";
  const month = /^\d+$/.test(monthRaw) ? Number(monthRaw) : MONTHS[monthRaw.slice(0, 3).toLowerCase()];
  const day = Number(tagged(value, "Day") ?? "1");
  if (!year || !month || !day) return undefined;
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function attributeValue(attributes: string, name: string): string | undefined {
  return attributes.match(new RegExp(`${name}=["']([^"']+)["']`, "i"))?.[1];
}

function parseArticle(articleXml: string): ResearchPaper | undefined {
  const citation = blocks(articleXml, "MedlineCitation")[0] ?? articleXml;
  const article = blocks(citation, "Article")[0] ?? citation;
  const pubmedData = blocks(articleXml, "PubmedData")[0] ?? "";
  const pmid = tagged(citation, "PMID")?.trim();
  const title = tagged(article, "ArticleTitle")?.trim();
  if (!pmid || !title) return undefined;

  const abstract = blockWithAttributes(article, "AbstractText")
    .map(({ attributes, body }) => {
      const text = stripTags(body);
      const label = attributeValue(attributes, "Label");
      return label && text ? `${label}: ${text}` : text;
    })
    .filter(Boolean)
    .join("\n");

  const authors = blocks(article, "Author")
    .map((author) => {
      const collective = tagged(author, "CollectiveName");
      if (collective) return collective;
      return [tagged(author, "ForeName"), tagged(author, "LastName")].filter(Boolean).join(" ");
    })
    .filter(Boolean);

  const publicationTypes = blocks(article, "PublicationType").map(stripTags).filter(Boolean);
  const articleDate = blocks(article, "ArticleDate")[0];
  const journalIssue = blocks(article, "JournalIssue")[0];
  const publishedAt = parseDateBlock(articleDate) ?? parseDateBlock(blocks(journalIssue ?? "", "PubDate")[0]);
  const history = blockWithAttributes(pubmedData, "PubMedPubDate");
  const pubmedDate = history.find((item) => attributeValue(item.attributes, "PubStatus") === "pubmed")?.body;
  const activityAt = parseDateBlock(pubmedDate) ?? publishedAt ?? new Date().toISOString();

  const identifiers = blockWithAttributes(pubmedData, "ArticleId");
  const doiFromIds = identifiers.find((item) => attributeValue(item.attributes, "IdType") === "doi")?.body;
  const eLocations = blockWithAttributes(article, "ELocationID");
  const doiFromLocation = eLocations.find((item) => attributeValue(item.attributes, "EIdType") === "doi")?.body;
  const doi = normalizeDoi(stripTags(doiFromIds ?? doiFromLocation ?? ""));

  return {
    id: `pmid:${pmid}`,
    pmid,
    doi,
    title,
    abstract,
    journal: tagged(blocks(article, "Journal")[0] ?? "", "Title") ?? "PubMed",
    authors,
    publicationTypes,
    publishedAt,
    activityAt,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    sourceKinds: ["pubmed"],
    matchedTopicIds: [],
  };
}

export function parsePubMedXml(xml: string): ResearchPaper[] {
  return blocks(xml, "PubmedArticle")
    .map(parseArticle)
    .filter((paper): paper is ResearchPaper => paper !== undefined);
}

async function fetchOk(url: URL, fetchImpl: typeof fetch): Promise<Response> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`[research:pubmed] HTTP ${response.status} for ${url.pathname}`);
  }
  return response;
}

interface PubMedRequestArgs {
  from: Date;
  to: Date;
  fetchImpl?: typeof fetch;
  apiKey?: string;
  email?: string;
  baseUrl?: string;
}

async function fetchWithQuery(args: PubMedRequestArgs & { query: string }): Promise<ResearchFetchResult> {
  const fetchImpl = args.fetchImpl ?? fetch;
  const baseUrl = (args.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const common: Record<string, string> = { db: "pubmed", tool: "dailybrief-research" };
  if (args.apiKey) common.api_key = args.apiKey;
  if (args.email) common.email = args.email;

  const searchUrl = new URL(`${baseUrl}/esearch.fcgi`);
  Object.entries({
    ...common,
    term: args.query,
    datetype: "edat",
    retmode: "json",
    retmax: "200",
  }).forEach(([key, value]) => searchUrl.searchParams.set(key, value));
  const searchResponse = await fetchOk(searchUrl, fetchImpl);
  const searchJson = (await searchResponse.json()) as { esearchresult?: { idlist?: unknown } };
  const ids = searchJson.esearchresult?.idlist;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    throw new Error("[research:pubmed] malformed ESearch response");
  }

  const papers: ResearchPaper[] = [];
  for (let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    const fetchUrl = new URL(`${baseUrl}/efetch.fcgi`);
    Object.entries({ ...common, id: batch.join(","), retmode: "xml" }).forEach(([key, value]) =>
      fetchUrl.searchParams.set(key, value),
    );
    papers.push(...parsePubMedXml(await (await fetchOk(fetchUrl, fetchImpl)).text()));
  }

  return {
    sourceId: "pubmed",
    sourceKind: "pubmed",
    fetchedAt: new Date().toISOString(),
    papers,
    rejected: {
      missingAbstract: papers.filter((paper) => paper.abstract.trim() === "").length,
    },
  };
}

export async function fetchPubMedQueryPapers(
  args: PubMedRequestArgs & { query: string },
): Promise<ResearchFetchResult> {
  const boundedQuery = `${args.query} AND ${formatPubMedDate(args.from)}:${formatPubMedDate(args.to)}[EDAT]`;
  return fetchWithQuery({ ...args, query: boundedQuery });
}

export async function fetchPubMedPapers(args: PubMedRequestArgs & {
  topics: ResearchTopic[];
  domainKeywords: string[];
}): Promise<ResearchFetchResult> {
  return fetchWithQuery({
    ...args,
    query: buildPubMedQuery(args.topics, args.domainKeywords, args.from, args.to),
  });
}
