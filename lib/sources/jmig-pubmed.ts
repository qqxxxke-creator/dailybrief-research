import { fetchPubMedQueryPapers } from "../research/sources/pubmed";
import { normalizeDoi, normalizeTitle } from "../research/normalize";
import type { RawArticle } from "./types";

const ISSN = "1553-4669";
const JOURNAL = "J Minim Invasive Gynecol";
const ALLOWED: Record<string, { contentType: string; category: RawArticle["category"] }> = {
  editorial: { contentType: "expert_commentary", category: "politics" },
  commentary: { contentType: "expert_commentary", category: "politics" },
  perspective: { contentType: "expert_commentary", category: "politics" },
  viewpoint: { contentType: "expert_commentary", category: "politics" },
  "narrative review": { contentType: "professional_review", category: "politics" },
  "clinical review": { contentType: "professional_review", category: "politics" },
  "video article": { contentType: "video_article", category: "finance" },
  "surgical technique": { contentType: "surgical_technique", category: "finance" },
  "technical note": { contentType: "technical_note", category: "finance" },
};
const EXCLUDED = /original|research|randomi[sz]ed|clinical trial|cohort|case-control|cross-sectional|systematic|meta-analysis|case report|protocol/i;

export interface JmigFetchArgs {
  from: Date;
  to: Date;
  fetchImpl?: typeof fetch;
  crossrefFetchImpl?: typeof fetch;
}

function classify(types: string[]): { contentType: string; category: RawArticle["category"] } | undefined {
  if (types.some((type) => EXCLUDED.test(type.trim().toLowerCase()))) return undefined;
  for (const type of types) {
    const key = type.trim().toLowerCase();
    if (ALLOWED[key]) return ALLOWED[key];
  }
  return undefined;
}

async function supplementDois(
  papers: Awaited<ReturnType<typeof fetchPubMedQueryPapers>>["papers"],
  fetchImpl: typeof fetch,
): Promise<Map<string, { doi?: string; publishedAt?: string }>> {
  const eligible = papers.filter((paper) => (!paper.doi || !paper.publishedAt) && classify(paper.publicationTypes));
  if (eligible.length === 0) return new Map();
  try {
    const url = new URL("https://api.crossref.org/journals/1553-4669/works");
    url.searchParams.set("rows", "100");
    const response = await fetchImpl(url);
    if (!response.ok) return new Map();
    const payload = (await response.json()) as { message?: { items?: Array<{ title?: string[]; ISSN?: string[]; DOI?: string; "published-online"?: { "date-parts"?: number[][] }; published?: { "date-parts"?: number[][] }; issued?: { "date-parts"?: number[][] } }> } };
    const items = payload.message?.items ?? [];
    const matches = new Map<string, { doi?: string; publishedAt?: string }>();
    for (const paper of eligible) {
      const title = normalizeTitle(paper.title);
      const match = items.find((item) => item.ISSN?.includes(ISSN) && item.title?.some((candidate) => normalizeTitle(candidate) === title));
      if (!match || !paper.pmid) continue;
      const dateParts = match["published-online"]?.["date-parts"]?.[0] ?? match.published?.["date-parts"]?.[0] ?? match.issued?.["date-parts"]?.[0];
      let publishedAt: string | undefined;
      if (dateParts?.length && dateParts[0] && dateParts[1]) {
        const date = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2] ?? 1));
        if (!Number.isNaN(date.getTime())) publishedAt = date.toISOString();
      }
      const doi = normalizeDoi(match.DOI);
      if (doi || publishedAt) matches.set(paper.pmid, { doi, publishedAt });
    }
    return matches;
  } catch {
    return new Map();
  }
}

export async function fetchJmigProfessionalContent(args: JmigFetchArgs): Promise<RawArticle[]> {
  try {
    const result = await fetchPubMedQueryPapers({
      query: `("${ISSN}"[ISSN] OR "${JOURNAL}"[Journal])`,
      from: args.from,
      to: args.to,
      fetchImpl: args.fetchImpl,
    });
    const supplementedDois = await supplementDois(result.papers, args.crossrefFetchImpl ?? fetch);
    return result.papers.flatMap((paper) => {
      const route = classify(paper.publicationTypes);
      if (!route) return [];
      const supplement = paper.pmid ? supplementedDois.get(paper.pmid) : undefined;
      const doi = paper.doi ?? supplement?.doi;
      const article: RawArticle = {
        sourceId: "jmig-pubmed",
        title: paper.title,
        url: paper.url,
        excerpt: paper.abstract,
        publishedAt: paper.publishedAt ? new Date(paper.publishedAt) : supplement?.publishedAt ? new Date(supplement.publishedAt) : undefined,
        category: route.category,
        documentType: route.contentType === "professional_review" ? "news" : route.contentType === "video_article" ? "video" : "news",
        contentType: route.contentType,
        contentTypeEvidence: "declared",
        meta: [paper.journal, paper.pmid, doi].filter(Boolean).join(" · "),
      };
      return [article];
    });
  } catch {
    return [];
  }
}
