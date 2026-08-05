import type { ResearchPaper } from "./types";

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: '"',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function normalizeDoi(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value
    .trim()
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .replace(/[\s.,;:)}\]]+$/g, "")
    .toLowerCase();
  return normalized || undefined;
}

export function normalizeTitle(value: string): string {
  return decodeEntities(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‐‑‒–—―-]/g, " ")
    .replace(/[^\p{L}\p{N}&]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function paperIdentityKeys(paper: ResearchPaper): string[] {
  const keys: string[] = [];
  const pmid = paper.pmid?.trim();
  const doi = normalizeDoi(paper.doi);
  const title = normalizeTitle(paper.title);
  if (pmid) keys.push(`pmid:${pmid}`);
  if (doi) keys.push(`doi:${doi}`);
  if (title) keys.push(`title:${title}`);
  return keys;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function newerIso(a: string | undefined, b: string | undefined): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function mergeGroup(group: ResearchPaper[]): ResearchPaper {
  const preferred = group.find((paper) => paper.sourceKinds.includes("pubmed")) ?? group[0];
  const merged: ResearchPaper = { ...preferred };

  for (const paper of group) {
    merged.pmid ||= paper.pmid;
    merged.doi ||= paper.doi;
    merged.title ||= paper.title;
    merged.abstract ||= paper.abstract;
    merged.journal ||= paper.journal;
    merged.url ||= paper.url;
    merged.publishedAt = newerIso(merged.publishedAt, paper.publishedAt);
    merged.activityAt = newerIso(merged.activityAt, paper.activityAt) ?? merged.activityAt;
    if (!merged.summaryZh && paper.summaryZh) merged.summaryZh = paper.summaryZh;
    if (!merged.summaryStatus && paper.summaryStatus) merged.summaryStatus = paper.summaryStatus;
    if (!merged.summaryInputHash && paper.summaryInputHash) merged.summaryInputHash = paper.summaryInputHash;
  }

  merged.doi = normalizeDoi(merged.doi);
  merged.id = merged.pmid ? `pmid:${merged.pmid}` : merged.doi ? `doi:${merged.doi}` : preferred.id;
  merged.authors = uniqueSorted(group.flatMap((paper) => paper.authors));
  merged.publicationTypes = uniqueSorted(group.flatMap((paper) => paper.publicationTypes));
  merged.sourceKinds = uniqueSorted(group.flatMap((paper) => paper.sourceKinds)) as ResearchPaper["sourceKinds"];
  merged.matchedTopicIds = uniqueSorted(group.flatMap((paper) => paper.matchedTopicIds));
  return merged;
}

export function dedupeResearchPapers(papers: ResearchPaper[]): ResearchPaper[] {
  const parent = papers.map((_, index) => index);
  const keyOwner = new Map<string, number>();

  const find = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a: number, b: number): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  papers.forEach((paper, index) => {
    for (const key of paperIdentityKeys(paper)) {
      const owner = keyOwner.get(key);
      if (owner === undefined) keyOwner.set(key, index);
      else union(index, owner);
    }
  });

  const groups = new Map<number, ResearchPaper[]>();
  papers.forEach((paper, index) => {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(paper);
    groups.set(root, group);
  });

  return [...groups.values()].map(mergeGroup);
}
