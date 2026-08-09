import { fetchPubMedQueryPapers } from "../research/sources/pubmed";
import { normalizeDoi, normalizeTitle } from "../research/normalize";
import type { RawArticle } from "./types";

const ISSN = "1879-3479";
const JOURNAL = "Int J Gynaecol Obstet";
const TITLE = /\bFIGO(?:\s+(?:committee|working\s+group|task\s+force|panel))?\s+(?:guidelines?|guidance|recommendations?|consensus|statement|best\s+practice(?:\s+advice|\s+recommendations?)?)\b/i;
const ALLOWED = /guideline|consensus|statement|best\s+practice|recommendation/i;
const HARD_EXCLUDED = /original|research|randomi[sz]ed|clinical\s+trial|cohort|case[- ]control|cross[- ]sectional|systematic|meta[- ]analysis|case\s+report|protocol|letter|comment|response/i;
const INSTITUTIONAL_AUTHOR = /\bFIGO\b|International Federation of Gynecology and Obstetrics/i;
const ABSTRACT_EVIDENCE = /\b(?:FIGO|International Federation of Gynecology and Obstetrics)\b[\s\S]{0,120}\b(?:committee|working\s+group|task\s+force|panel|consortium|guideline\s+development|consensus\s+group)\b/i;

function normalizeJournal(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export interface FigoFetchArgs { sourceId?: string; from: Date; to: Date; fetchImpl?: typeof fetch; crossrefFetchImpl?: typeof fetch }

export function classify(paper: { title: string; journal: string; publicationTypes: string[]; authors: string[]; abstract: string }): boolean {
  if (normalizeJournal(paper.journal) !== normalizeJournal(JOURNAL)) return false;
  // Hard exclusions run before any allow-list or title inference.
  if (HARD_EXCLUDED.test(paper.title) || paper.publicationTypes.some((type) => HARD_EXCLUDED.test(type))) return false;
  if (!TITLE.test(paper.title)) return false;
  const formalType = paper.publicationTypes.some((type) => ALLOWED.test(type));
  const institutionalEvidence = paper.authors.some((author) => INSTITUTIONAL_AUTHOR.test(author)) || ABSTRACT_EVIDENCE.test(paper.abstract);
  return (formalType || TITLE.test(paper.title)) && institutionalEvidence;
}

async function supplementCrossref(
  papers: Awaited<ReturnType<typeof fetchPubMedQueryPapers>>["papers"],
  fetchImpl: typeof fetch,
): Promise<Map<string, { doi?: string; publishedAt?: string }>> {
  const eligible = papers.filter((paper) => paper.pmid && classify(paper) && (!paper.doi || !paper.publishedAt));
  if (!eligible.length) return new Map();
  try {
    const url = new URL(`https://api.crossref.org/journals/${ISSN}/works`);
    url.searchParams.set("rows", "100");
    const response = await fetchImpl(url);
    if (!response.ok) return new Map();
    const payload = await response.json() as { message?: { items?: Array<{ title?: string[]; ISSN?: string[]; DOI?: string; [key: string]: unknown }> } };
    const items = payload.message?.items ?? [];
    const matches = new Map<string, { doi?: string; publishedAt?: string }>();
    for (const paper of eligible) {
      const match = items.find((item) => item.ISSN?.some((issn) => issn === ISSN) && item.title?.some((title) => normalizeTitle(title) === normalizeTitle(paper.title)));
      if (!match) continue;
      const parts = (match["published-online"] as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0]
        ?? (match.published as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0]
        ?? (match.issued as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0];
      let publishedAt: string | undefined;
      if (parts?.[0] && parts?.[1]) publishedAt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] ?? 1)).toISOString();
      const doi = normalizeDoi(match.DOI);
      if (doi || publishedAt) matches.set(paper.pmid!, { doi, publishedAt });
    }
    return matches;
  } catch { return new Map(); }
}

export async function fetchFigoGuidance(args: FigoFetchArgs): Promise<RawArticle[]> {
  try {
    const query = `("${ISSN}"[ISSN] OR "${JOURNAL}"[Journal]) AND ("FIGO guideline"[Title] OR "FIGO guidelines"[Title] OR "FIGO guidance"[Title] OR "FIGO recommendation"[Title] OR "FIGO recommendations"[Title] OR "FIGO consensus"[Title] OR "FIGO statement"[Title] OR "FIGO committee statement"[Title] OR "FIGO committee consensus"[Title] OR "FIGO working group statement"[Title] OR "FIGO best practice advice"[Title] OR "FIGO best practice recommendations"[Title]) NOT (Letter[Publication Type] OR Comment[Publication Type] OR response[Title])`;
    const result = await fetchPubMedQueryPapers({ query, from: args.from, to: args.to, fetchImpl: args.fetchImpl });
    // Keep metadata enrichment failure isolated from the primary PubMed result.
    let supplements = new Map<string, { doi?: string; publishedAt?: string }>();
    try { supplements = await supplementCrossref(result.papers, args.crossrefFetchImpl ?? fetch); } catch { /* metadata fallback is non-blocking */ }
    return result.papers.filter((paper) => classify(paper)).map((paper) => {
      const supplement = paper.pmid ? supplements.get(paper.pmid) : undefined;
      const doi = paper.doi ?? supplement?.doi;
      return {
        sourceId: args.sourceId ?? "figo-guidance", title: paper.title, url: doi ? `https://doi.org/${doi}` : paper.url,
        excerpt: paper.abstract, publishedAt: paper.publishedAt ? new Date(paper.publishedAt) : supplement?.publishedAt ? new Date(supplement.publishedAt) : undefined,
        category: "politics", documentType: "guideline", contentType: "guideline", contentTypeEvidence: "metadata",
        meta: [paper.journal, paper.pmid, doi].filter(Boolean).join(" · "),
      } satisfies RawArticle;
    });
  } catch { return []; }
}
