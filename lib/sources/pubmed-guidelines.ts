import { fetchPubMedQueryPapers } from "../research/sources/pubmed";
import type { RawArticle, SourceDef } from "./types";

export async function fetchPubMedGuidelines(
  source: SourceDef,
  now = new Date(),
): Promise<RawArticle[]> {
  if (!source.query?.trim()) throw new Error(`${source.id}: missing PubMed query`);
  const from = new Date(now.getTime() - (source.lookbackHours ?? 168) * 60 * 60 * 1000);
  const result = await fetchPubMedQueryPapers({
    query: source.query,
    from,
    to: now,
    apiKey: process.env.NCBI_API_KEY,
    email: process.env.NCBI_EMAIL,
  });
  return result.papers.map((paper) => ({
    sourceId: source.id,
    title: paper.title,
    url: paper.url,
    excerpt: [
      paper.abstract,
      paper.journal,
      paper.publicationTypes.join(", "),
      paper.doi ? `DOI: ${paper.doi}` : "",
    ].filter(Boolean).join(" · ").slice(0, 1_500),
    publishedAt: new Date(paper.activityAt),
    category: source.category,
  }));
}
