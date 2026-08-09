import { fetchPubMedQueryPapers } from "../research/sources/pubmed";
import { normalizeDoi } from "../research/normalize";
import type { RawArticle } from "./types";

const ISSN = "1879-3479";
const JOURNAL = "Int J Gynaecol Obstet";
const FORMAL = /guideline|guidance|recommendation|consensus|position|statement|best\s+practice/i;
const HARD = /original|randomi[sz]ed|clinical\s+trial|cohort|case[- ]control|systematic|meta[- ]analysis|case\s+report|protocol|letter|comment|response|controversy|editorial|narrative\s+review|research\s+article|original\s+article/i;
const SOCIETY = /expert\s+opinion|call\s+to\s+action|committee|perspective|clinical\s+implementation|safety|quality|policy/i;
const AFFILIATION = /(?:FIGO|International Federation of Gynecology and Obstetrics)\b.*(?:committee|working\s+group|federation|organization|society|task\s+force|division|department)/i;

export interface FigoSocietyFetchArgs { from: Date; to: Date; fetchImpl?: typeof fetch; crossrefFetchImpl?: typeof fetch }

export function classifySociety(paper: { title: string; journal: string; publicationTypes: string[]; authors: string[]; abstract: string }): boolean {
  if (paper.journal.normalize("NFKC").toLowerCase() !== JOURNAL.toLowerCase()) return false;
  if (FORMAL.test(paper.title) || paper.publicationTypes.some((x) => FORMAL.test(x))) return false;
  if (HARD.test(paper.title) || paper.publicationTypes.some((x) => HARD.test(x))) return false;
  if (!SOCIETY.test(`${paper.title} ${paper.abstract}`)) return false;
  const affiliation = paper.authors.some((a) => AFFILIATION.test(a)) || /FIGO[\s\S]{0,120}(?:committee|working\s+group|division|department|task\s+force)/i.test(paper.abstract);
  return affiliation;
}

async function crossref(papers: Awaited<ReturnType<typeof fetchPubMedQueryPapers>>["papers"], fetchImpl: typeof fetch) {
  const out = new Map<string, { doi?: string; publishedAt?: string }>();
  const missing = papers.filter((p) => p.pmid && classifySociety(p) && (!p.doi || !p.publishedAt));
  if (!missing.length) return out;
  try {
    const response = await fetchImpl(new URL(`https://api.crossref.org/journals/${ISSN}/works?rows=100`));
    if (!response.ok) return out;
    const items = ((await response.json()) as any).message?.items ?? [];
    for (const p of missing) {
      const hit = items.find((i: any) => i.title?.some((t: string) => t.trim().toLowerCase() === p.title.trim().toLowerCase())
        && Array.isArray(i.ISSN) && i.ISSN.some((issn: string) => issn.replace(/[^0-9X]/gi, "").toUpperCase() === ISSN.replace(/[^0-9X]/gi, "").toUpperCase()));
      if (!hit) continue;
      const parts = hit["published-online"]?.["date-parts"]?.[0] ?? hit.issued?.["date-parts"]?.[0];
      out.set(p.pmid!, { doi: normalizeDoi(hit.DOI), publishedAt: parts?.[0] ? new Date(Date.UTC(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1)).toISOString() : undefined });
    }
  } catch { /* non-blocking */ }
  return out;
}

export async function fetchFigoSocietyPubmed(args: FigoSocietyFetchArgs): Promise<RawArticle[]> {
  try {
    const query = `("${ISSN}"[ISSN] OR "${JOURNAL}"[Journal]) AND (FIGO[Title/Abstract] OR "International Federation of Gynecology and Obstetrics"[Title/Abstract])`;
    const result = await fetchPubMedQueryPapers({ query, from: args.from, to: args.to, fetchImpl: args.fetchImpl });
    const supplements = await crossref(result.papers, args.crossrefFetchImpl ?? fetch);
    return result.papers.filter(classifySociety).map((p) => {
      const s = p.pmid ? supplements.get(p.pmid) : undefined; const doi = p.doi ?? s?.doi;
      return { sourceId: "figo-society-pubmed", title: p.title, url: doi ? `https://doi.org/${doi}` : p.url, excerpt: p.abstract, publishedAt: p.publishedAt ? new Date(p.publishedAt) : s?.publishedAt ? new Date(s.publishedAt) : undefined, category: "politics", documentType: "policy", contentType: "policy", contentTypeEvidence: "metadata", meta: [p.journal, p.pmid, doi].filter(Boolean).join(" 路 ") } satisfies RawArticle;
    });
  } catch { return []; }
}
