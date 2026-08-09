import { fetchAttentionVc } from "./attentionvc";
import { fetchGithubTrending } from "./github-trending";
import { fetchHackerNews } from "./hackernews";
import { fetchHuggingfacePapers } from "./huggingface-papers";
import { fetchLinuxDo } from "./linuxdo";
import { fetchRss } from "./rss";
import { fetchV2ex } from "./v2ex";
import { fetchObgynPage } from "./obgyn-pages";
import { fetchCjournalCurrent } from "./cjournal-current";
import { fetchPubMedGuidelines } from "./pubmed-guidelines";
import { fetchGocmRss } from "./gocm";
import { fetchJmigProfessionalContent } from "./jmig-pubmed";
import { fetchFigoGuidance } from "./figo-pubmed";
import { fetchFigoSocietyPubmed } from "./figo-society-pubmed";
import type { RawArticle, SourceDef } from "./types";

/**
 * Single dispatcher used by daily.ts, dry-run.ts, and the cron route.
 * Add a new branch here when introducing a non-RSS fetcher.
 */
export async function fetchSource(source: SourceDef): Promise<RawArticle[]> {
  if (source.id === "hackernews") return fetchHackerNews(source.id);
  if (source.id === "github-trending") return fetchGithubTrending(source.id);
  if (source.id === "v2ex-hot") return fetchV2ex(source.id);
  if (source.id === "linuxdo") return fetchLinuxDo(source.id);
  if (source.id === "attentionvc-ai") return fetchAttentionVc(source.id);
  if (source.id === "huggingface-papers") return fetchHuggingfacePapers(source.id, source.keywords);
  if (source.id === "pubmed-asrm-guidance") return fetchPubMedGuidelines(source);
  if (source.id === "china-clinical-obgyn-current") return fetchCjournalCurrent(source);
  if (source.id === "gocm-guidelines" || source.id === "gocm-surgery") return fetchGocmRss(source);
  if (source.id === "jmig-articles-in-press") return fetchJmigProfessionalContent({ from: new Date(Date.now() - 30 * 86400000), to: new Date() });
  if (source.id === "figo-guidance") return fetchFigoGuidance({ from: new Date(Date.now() - 180 * 86400000), to: new Date() });
  if (source.id === "figo-society-pubmed") return fetchFigoSocietyPubmed({ from: new Date(Date.now() - 30 * 86400000), to: new Date() });
  // The FIGO main site is intentionally disabled; never route it through the generic scraper.
  if (source.id === "figo-news") return [];
  if (source.type === "scrape") return fetchObgynPage(source);
  return fetchRss(source.id, source.url, source.category, {
    useCurl: source.useCurl,
    limit: ["medical-xpress-obgyn", "medpage-today-headlines", "figo-podcast", "figo-society-pubmed"].includes(source.id) ? 8 : undefined,
  });
}
