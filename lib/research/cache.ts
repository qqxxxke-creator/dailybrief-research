import fs from "node:fs";
import path from "node:path";

import { dedupeResearchPapers } from "./normalize";
import type {
  ResearchCache,
  ResearchPaper,
  ResearchRuntimeConfig,
} from "./types";

export const DEFAULT_RESEARCH_CACHE_PATH = path.resolve("data/research/research-cache.json");

function emptyCache(): ResearchCache {
  return { schemaVersion: 1, papers: [] };
}

export function computeResearchWindow(
  cache: ResearchCache,
  now: Date,
  runtime: ResearchRuntimeConfig,
): { from: Date; to: Date } {
  const from = cache.lastSuccessfulRun
    ? new Date(Date.parse(cache.lastSuccessfulRun) - runtime.overlapHours * 3_600_000)
    : new Date(now.getTime() - runtime.lookbackDays * 86_400_000);
  return { from, to: new Date(now) };
}

export function mergeResearchCache(args: {
  previous: ResearchCache;
  fetched: ResearchPaper[];
  successfulSourceCount: number;
  now: Date;
  retentionDays: number;
}): ResearchCache {
  const cutoff = args.now.getTime() - args.retentionDays * 86_400_000;
  const papers = dedupeResearchPapers([...args.fetched, ...args.previous.papers]).filter(
    (paper) => Date.parse(paper.activityAt) >= cutoff,
  );
  return {
    schemaVersion: 1,
    lastSuccessfulRun:
      args.successfulSourceCount > 0
        ? args.now.toISOString()
        : args.previous.lastSuccessfulRun,
    papers,
  };
}

function isResearchPaper(value: unknown): value is ResearchPaper {
  if (!value || typeof value !== "object") return false;
  const paper = value as Partial<ResearchPaper>;
  return (
    typeof paper.id === "string" &&
    typeof paper.title === "string" &&
    typeof paper.abstract === "string" &&
    typeof paper.activityAt === "string" &&
    typeof paper.url === "string" &&
    Array.isArray(paper.authors) &&
    Array.isArray(paper.publicationTypes) &&
    Array.isArray(paper.sourceKinds) &&
    Array.isArray(paper.matchedTopicIds)
  );
}

function parseCache(raw: string): ResearchCache {
  const value = JSON.parse(raw) as Partial<ResearchCache>;
  if (value.schemaVersion !== 1 || !Array.isArray(value.papers) || !value.papers.every(isResearchPaper)) {
    throw new Error("unsupported or malformed research cache schema");
  }
  if (value.lastSuccessfulRun !== undefined && typeof value.lastSuccessfulRun !== "string") {
    throw new Error("malformed lastSuccessfulRun");
  }
  return value as ResearchCache;
}

export function loadResearchCache(
  file = DEFAULT_RESEARCH_CACHE_PATH,
  clearCache = false,
  now = new Date(),
  warn: (message: string) => void = console.warn,
): ResearchCache {
  if (clearCache || !fs.existsSync(file)) return emptyCache();
  try {
    return parseCache(fs.readFileSync(file, "utf8"));
  } catch (error) {
    const suffix = now.toISOString().replace(/[:.]/g, "-");
    const quarantine = `${file}.corrupt-${suffix}`;
    try {
      fs.renameSync(file, quarantine);
    } catch {
      // Best effort: a malformed cache must never block the daily report.
    }
    const message = error instanceof Error ? error.message : String(error);
    warn(`[research:cache] ignored malformed cache: ${message}`);
    return emptyCache();
  }
}

export function saveResearchCacheAtomic(
  cache: ResearchCache,
  file = DEFAULT_RESEARCH_CACHE_PATH,
): void {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `${path.basename(file)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
}
