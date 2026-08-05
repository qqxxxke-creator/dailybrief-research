import Parser from "rss-parser";

import { classifyGocmItem } from "./gocm-classification";
import type { RawArticle, SourceDef } from "./types";

interface GocmItem {
  title?: string;
  link?: string;
  isoDate?: string;
  pubDate?: string;
  dcDate?: string;
  prismSection?: string;
  contentSnippet?: string;
  content?: string;
}

const parser = new Parser<Record<string, unknown>, GocmItem>({
  customFields: {
    item: [
      ["dc:date", "dcDate"],
      ["prism:section", "prismSection"],
    ],
  },
});

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function belongsTo(source: SourceDef, item: GocmItem): boolean {
  const classification = classifyGocmItem(item.prismSection, item.title);
  if (source.id === "gocm-guidelines") return classification === "guideline";
  if (source.id === "gocm-surgery") return classification === "surgery";
  return classification === "research";
}

async function mapFeed(source: SourceDef, feed: { items?: GocmItem[] }): Promise<RawArticle[]> {
  return (feed.items ?? [])
    .filter((item) => belongsTo(source, item))
    .map((item) => {
      const dateRaw = item.isoDate ?? item.pubDate ?? item.dcDate;
      const publishedAt = dateRaw ? new Date(dateRaw) : undefined;
      return {
        sourceId: source.id,
        title: item.title?.trim() ?? "",
        url: item.link?.trim() ?? "",
        excerpt: stripHtml(item.contentSnippet ?? item.content ?? "").slice(0, 1_000),
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
        category: source.category,
      };
    })
    .filter((item) => item.title && item.url);
}

export async function parseGocmRssXml(source: SourceDef, xml: string): Promise<RawArticle[]> {
  return mapFeed(source, await parser.parseString(xml));
}

export async function fetchGocmRss(source: SourceDef): Promise<RawArticle[]> {
  return mapFeed(source, await parser.parseURL(source.url));
}
