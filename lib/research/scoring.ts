import { normalizeTitle } from "./normalize";
import type {
  ResearchConfig,
  ResearchPaper,
  ResearchScore,
  ResearchTopic,
} from "./types";

const DAY_MS = 86_400_000;

const EVIDENCE_RULES: Array<[RegExp, number]> = [
  [/systematic review|meta-analysis/i, 1],
  [/randomi[sz]ed controlled trial/i, 0.95],
  [/clinical trial/i, 0.85],
  [/prospective.*cohort|cohort.*prospective/i, 0.75],
  [/diagnostic|validation study/i, 0.7],
  [/cohort|case-control|cross-sectional/i, 0.65],
  [/retrospective/i, 0.55],
  [/feasibility|case series/i, 0.35],
  [/case report/i, 0.2],
  [/editorial|comment|protocol/i, 0.1],
];

const NON_RESEARCH_RE = /practice guideline|guideline|consensus|retracted publication|retraction|correction|erratum|news|protocol/i;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function normalizedHaystack(paper: ResearchPaper): string {
  return normalizeTitle(`${paper.title} ${paper.abstract} ${paper.publicationTypes.join(" ")}`);
}

function includesPhrase(haystack: string, keyword: string): boolean {
  const needle = normalizeTitle(keyword);
  return Boolean(needle) && haystack.includes(needle);
}

export function evidenceWeight(publicationTypes: string[]): number {
  let strongest = 0.4;
  let matched = false;
  for (const publicationType of publicationTypes) {
    for (const [pattern, weight] of EVIDENCE_RULES) {
      if (pattern.test(publicationType)) {
        strongest = matched ? Math.max(strongest, weight) : weight;
        matched = true;
        break;
      }
    }
  }
  return matched ? strongest : 0.4;
}

export function actionabilityWeight(paper: ResearchPaper): number {
  const text = `${paper.title} ${paper.abstract} ${paper.publicationTypes.join(" ")}`.toLowerCase();
  if (/animal model|mouse|mice|murine|rat\b|in vitro|cell line|organoid/.test(text)) return 0.25;
  if (/feasibility|robotic|laparoscop|hysteroscop|device|technical validation|surgical technique/.test(text)) {
    return 0.5;
  }
  if (/randomi[sz]ed|clinical trial|intervention|treatment|diagnos|screening|patient outcome|mortality|morbidity/.test(text)) {
    return 1;
  }
  if (/cohort|case-control|cross-sectional|observational|population-based|registry|human/.test(text)) {
    return 0.75;
  }
  return 0.4;
}

export function recencyWeight(activityAt: string, now: Date): number {
  const timestamp = Date.parse(activityAt);
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (now.getTime() - timestamp) / DAY_MS);
  if (ageDays <= 2) return 1;
  if (ageDays <= 4) return 0.75;
  if (ageDays <= 7) return 0.5;
  return 0;
}

function topicMatchScore(paper: ResearchPaper, topic: ResearchTopic): number {
  if (!topic.enabled) return 0;
  const allText = normalizedHaystack(paper);
  if (topic.excludeKeywords.some((keyword) => includesPhrase(allText, keyword))) return 0;

  const title = normalizeTitle(paper.title);
  const abstract = normalizeTitle(paper.abstract);
  const titleHit = topic.includeKeywords.some((keyword) => includesPhrase(title, keyword));
  const abstractHit = topic.includeKeywords.some((keyword) => includesPhrase(abstract, keyword));
  if (!titleHit && !abstractHit) return 0;

  if (titleHit) return 50;
  const publicationTypeHit = topic.publicationTypes.some((expected) =>
    paper.publicationTypes.some((actual) => normalizeTitle(actual) === normalizeTitle(expected)),
  );
  return Math.min(50, 40 + (publicationTypeHit ? 10 : 0));
}

export function matchTopics(paper: ResearchPaper, topics: ResearchTopic[]): string[] {
  return topics
    .filter((topic) => topicMatchScore(paper, topic) > 0)
    .map((topic) => topic.id);
}

export function scorePaper(
  paper: ResearchPaper,
  topic: ResearchTopic,
  now: Date,
): ResearchScore {
  const topicMatch = topicMatchScore(paper, topic);
  const evidenceRank = evidenceWeight(paper.publicationTypes);
  const actionabilityRank = actionabilityWeight(paper);
  const recencyRank = recencyWeight(paper.activityAt, now);
  const evidence = round2(25 * evidenceRank);
  const clinicalActionability = round2(15 * actionabilityRank);
  const recency = round2(10 * recencyRank);
  return {
    topicMatch,
    evidence,
    clinicalActionability,
    recency,
    total: round2(topicMatch + evidence + clinicalActionability + recency),
    evidenceRank,
  };
}

function isValidCandidate(paper: ResearchPaper, now: Date): boolean {
  if (paper.abstract.trim().length < 20) return false;
  if (recencyWeight(paper.activityAt, now) === 0) return false;
  if (evidenceWeight(paper.publicationTypes) <= 0.1) return false;
  return !NON_RESEARCH_RE.test(`${paper.title} ${paper.publicationTypes.join(" ")}`);
}

export function selectResearchPapers(
  papers: ResearchPaper[],
  config: ResearchConfig,
  now = new Date(),
): ResearchPaper[] {
  const enabledTopics = config.topics.filter((topic) => topic.enabled);
  const scored: ResearchPaper[] = [];

  for (const paper of papers) {
    if (!isValidCandidate(paper, now)) continue;
    const domainText = normalizedHaystack(paper);
    if (!config.domainKeywords.some((keyword) => includesPhrase(domainText, keyword))) continue;
    const candidates = enabledTopics
      .map((topic, topicIndex) => ({ topic, topicIndex, score: scorePaper(paper, topic, now) }))
      .filter((entry) => entry.score.topicMatch > 0)
      .sort(
        (a, b) =>
          b.score.total - a.score.total ||
          b.score.evidenceRank - a.score.evidenceRank ||
          a.topicIndex - b.topicIndex,
      );
    const best = candidates[0];
    if (!best || best.score.total < config.runtime.minScore) continue;
    scored.push({
      ...paper,
      matchedTopicIds: candidates.map((entry) => entry.topic.id),
      assignedTopicId: best.topic.id,
      score: best.score,
    });
  }

  scored.sort(
    (a, b) =>
      (b.score?.total ?? 0) - (a.score?.total ?? 0) ||
      (b.score?.evidenceRank ?? 0) - (a.score?.evidenceRank ?? 0) ||
      Date.parse(b.activityAt) - Date.parse(a.activityAt) ||
      a.id.localeCompare(b.id),
  );

  const topicCounts = new Map<string, number>();
  const selected: ResearchPaper[] = [];
  for (const paper of scored) {
    const topicId = paper.assignedTopicId!;
    if ((topicCounts.get(topicId) ?? 0) >= config.runtime.maxPerTopic) continue;
    selected.push(paper);
    topicCounts.set(topicId, (topicCounts.get(topicId) ?? 0) + 1);
    if (selected.length >= config.runtime.maxPapers) break;
  }
  return selected;
}
