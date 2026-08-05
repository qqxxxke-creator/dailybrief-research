export type ResearchSourceKind = "pubmed" | "journal-rss";

export interface ResearchTopic {
  id: string;
  name: string;
  description: string;
  includeKeywords: string[];
  excludeKeywords: string[];
  publicationTypes: string[];
  enabled: boolean;
}

export interface ResearchSourceConfig {
  id: string;
  name: string;
  kind: ResearchSourceKind;
  url: string;
  enabled: boolean;
}

export interface ResearchRuntimeConfig {
  enabled: boolean;
  clearCache: boolean;
  lookbackDays: number;
  maxPapers: number;
  cacheDays: number;
  overlapHours: number;
  minScore: number;
  maxPerTopic: number;
}

export interface ResearchConfig {
  schemaVersion: 1;
  domainKeywords: string[];
  runtime: ResearchRuntimeConfig;
  sources: ResearchSourceConfig[];
  topics: ResearchTopic[];
}

export interface ResearchScore {
  topicMatch: number;
  evidence: number;
  clinicalActionability: number;
  recency: number;
  total: number;
  evidenceRank: number;
}

export interface ResearchSummaryZh {
  titleZh: string;
  researchQuestion: string;
  studyDesign: string;
  populationAndSample: string;
  methods: string;
  keyResults: string;
  limitations: string;
  clinicalInterpretation: string;
}

export interface ResearchPaper {
  id: string;
  pmid?: string;
  doi?: string;
  title: string;
  abstract: string;
  journal: string;
  authors: string[];
  publicationTypes: string[];
  publishedAt?: string;
  activityAt: string;
  url: string;
  sourceKinds: ResearchSourceKind[];
  matchedTopicIds: string[];
  assignedTopicId?: string;
  score?: ResearchScore;
  summaryZh?: ResearchSummaryZh;
  summaryStatus?: "success" | "failed" | "not-requested";
  summaryInputHash?: string;
}

export interface ResearchFetchResult {
  sourceId: string;
  sourceKind: ResearchSourceKind;
  fetchedAt: string;
  papers: ResearchPaper[];
  rejected: Record<string, number>;
}

export interface ResearchCache {
  schemaVersion: 1;
  lastSuccessfulRun?: string;
  papers: ResearchPaper[];
}

export interface ResearchSection {
  generatedAt: string;
  dataAsOf: string;
  isCachedFallback: boolean;
  dailySignal: string;
  papers: ResearchPaper[];
}
