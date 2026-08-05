import { load } from "cheerio";
import Parser from "rss-parser";

import { normalizeDoi, normalizeTitle } from "../normalize";
import { classifyGocmItem } from "../../sources/gocm-classification";
import type {
  ResearchFetchResult,
  ResearchPaper,
  ResearchSourceConfig,
} from "../types";

interface RssItem {
  title?: string;
  link?: string;
  guid?: string;
  isoDate?: string;
  pubDate?: string;
  updated?: string;
  creator?: string;
  dcCreator?: string;
  dcIdentifier?: string;
  prismSection?: string;
  description?: string;
  content?: string;
  contentEncoded?: string;
  contentSnippet?: string;
}

interface RssFeed {
  title?: string;
  items: RssItem[];
}

interface RssParser {
  parseURL(url: string): Promise<RssFeed>;
}

function defaultParser(): RssParser {
  return new Parser({
    customFields: {
      item: [
        ["content:encoded", "contentEncoded"],
        ["dc:creator", "dcCreator"],
        ["dc:identifier", "dcIdentifier"],
        ["prism:section", "prismSection"],
        ["atom:updated", "updated"],
      ],
    },
  }) as unknown as RssParser;
}

function plainText(html: string): string {
  const $ = load(`<body>${html}</body>`);
  return $("body").text().replace(/\s+/g, " ").trim();
}

function extractDoi(item: RssItem): string | undefined {
  const text = [item.dcIdentifier, item.guid, item.link, item.contentEncoded, item.content, item.description]
    .filter(Boolean)
    .join(" ");
  const match = text.match(/(?:doi:\s*|doi\.org\/)?(10\.\d{4,9}\/[^\s<>'"]+)/i);
  return normalizeDoi(match?.[1]);
}

function parseAuthors(item: RssItem): string[] {
  const raw = item.dcCreator ?? item.creator ?? "";
  return raw
    .split(/;|\band\b/gi)
    .map((author) => author.trim())
    .filter(Boolean);
}

function increment(rejected: Record<string, number>, reason: string): void {
  rejected[reason] = (rejected[reason] ?? 0) + 1;
}

function mapItem(
  item: RssItem,
  source: ResearchSourceConfig,
  from: Date,
  to: Date,
  rejected: Record<string, number>,
): ResearchPaper | undefined {
  const title = item.title?.trim();
  const url = item.link?.trim() ?? item.guid?.trim();
  if (!title || !url) {
    increment(rejected, "missingIdentity");
    return undefined;
  }
  if (source.id === "gocm-rss" && classifyGocmItem(item.prismSection, title) !== "research") {
    increment(rejected, "routedToGuidelineOrSurgery");
    return undefined;
  }

  const dateRaw = item.isoDate ?? item.pubDate ?? item.updated;
  const timestamp = dateRaw ? Date.parse(dateRaw) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    increment(rejected, "missingDate");
    return undefined;
  }
  if (timestamp < from.getTime() || timestamp > to.getTime()) {
    increment(rejected, "outOfWindow");
    return undefined;
  }

  const abstract = plainText(
    item.contentEncoded ?? item.content ?? item.description ?? item.contentSnippet ?? "",
  );
  if (abstract.length < 20) {
    increment(rejected, "missingAbstract");
    return undefined;
  }

  const doi = extractDoi(item);
  const activityAt = new Date(timestamp).toISOString();
  return {
    id: doi ? `doi:${doi}` : `rss:${source.id}:${normalizeTitle(title)}`,
    doi,
    title: plainText(title),
    abstract,
    journal: source.name,
    authors: parseAuthors(item),
    publicationTypes: [],
    publishedAt: activityAt,
    activityAt,
    url,
    sourceKinds: ["journal-rss"],
    matchedTopicIds: [],
  };
}

export async function fetchJournalRssPapers(args: {
  source: ResearchSourceConfig;
  from: Date;
  to: Date;
  parser?: RssParser;
}): Promise<ResearchFetchResult> {
  const parser = args.parser ?? defaultParser();
  let feed: RssFeed;
  try {
    feed = await parser.parseURL(args.source.url);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[research:${args.source.id}] ${message}`);
  }

  const rejected: Record<string, number> = {};
  const papers = (feed.items ?? [])
    .map((item) => mapItem(item, args.source, args.from, args.to, rejected))
    .filter((paper): paper is ResearchPaper => paper !== undefined);

  return {
    sourceId: args.source.id,
    sourceKind: "journal-rss",
    fetchedAt: new Date().toISOString(),
    papers,
    rejected,
  };
}
