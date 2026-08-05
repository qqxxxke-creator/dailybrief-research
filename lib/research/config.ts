import fs from "node:fs";
import path from "node:path";

import type {
  ResearchConfig,
  ResearchSourceConfig,
  ResearchSourceKind,
  ResearchTopic,
} from "./types";

interface ResearchTopicInput {
  id: string;
  name: string;
  description: string;
  include_keywords: string[];
  exclude_keywords: string[];
  publication_types: string[];
  enabled: boolean;
}

interface ResearchSourceInput {
  id: string;
  name: string;
  kind: ResearchSourceKind;
  url: string;
  enabled: boolean;
}

export interface ResearchConfigInput {
  schema_version: number;
  runtime: {
    lookback_days: number;
    max_papers: number;
    cache_days: number;
    overlap_hours: number;
    min_score: number;
    max_per_topic: number;
  };
  sources: ResearchSourceInput[];
  topics: ResearchTopicInput[];
}

type Env = Record<string, string | undefined>;

function fail(field: string, message: string): never {
  throw new Error(`[research-config] ${field}: ${message}`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(field, "must be a non-empty string");
  }
  return value.trim();
}

function requireStringList(value: unknown, field: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    fail(field, allowEmpty ? "must be a string array" : "must be a non-empty string array");
  }
  return value.map((entry, index) => requireString(entry, `${field}[${index}]`));
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") fail(field, "must be boolean");
  return value;
}

function boundedInteger(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    fail(field, `must be an integer between ${min} and ${max}`);
  }
  return value as number;
}

function envInteger(
  env: Env,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) fail(name, `must be an integer between ${min} and ${max}`);
  return boundedInteger(Number(raw), name, min, max);
}

function envBoolean(env: Env, name: string, fallback: boolean): boolean {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  if (raw !== "true" && raw !== "false") fail(name, "must be true or false");
  return raw === "true";
}

function assertUnique(items: Array<{ id: string }>, field: string): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) fail(`${field}[${index}].id`, `duplicate id '${item.id}'`);
    seen.add(item.id);
  });
}

export function parseResearchConfig(input: ResearchConfigInput, env: Env): ResearchConfig {
  if (!input || typeof input !== "object") fail("root", "must be an object");
  if (input.schema_version !== 1) fail("schema_version", "must equal 1");
  if (!input.runtime || typeof input.runtime !== "object") fail("runtime", "must be an object");
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    fail("sources", "must be a non-empty array");
  }
  if (!Array.isArray(input.topics) || input.topics.length === 0) {
    fail("topics", "must be a non-empty array");
  }

  const sources: ResearchSourceConfig[] = input.sources.map((source, index) => {
    const field = `sources[${index}]`;
    if (source.kind !== "pubmed" && source.kind !== "journal-rss") {
      fail(`${field}.kind`, "must be pubmed or journal-rss");
    }
    return {
      id: requireString(source.id, `${field}.id`),
      name: requireString(source.name, `${field}.name`),
      kind: source.kind,
      url: requireString(source.url, `${field}.url`),
      enabled: requireBoolean(source.enabled, `${field}.enabled`),
    };
  });

  const topics: ResearchTopic[] = input.topics.map((topic, index) => {
    const field = `topics[${index}]`;
    return {
      id: requireString(topic.id, `${field}.id`),
      name: requireString(topic.name, `${field}.name`),
      description: requireString(topic.description, `${field}.description`),
      includeKeywords: requireStringList(topic.include_keywords, `${field}.include_keywords`, false),
      excludeKeywords: requireStringList(topic.exclude_keywords, `${field}.exclude_keywords`, true),
      publicationTypes: requireStringList(topic.publication_types, `${field}.publication_types`, true),
      enabled: requireBoolean(topic.enabled, `${field}.enabled`),
    };
  });

  assertUnique(sources, "sources");
  assertUnique(topics, "topics");

  const runtime = input.runtime;
  const lookbackDays = boundedInteger(runtime.lookback_days, "runtime.lookback_days", 1, 30);
  const maxPapers = boundedInteger(runtime.max_papers, "runtime.max_papers", 1, 20);
  const cacheDays = boundedInteger(runtime.cache_days, "runtime.cache_days", 1, 365);

  return {
    schemaVersion: 1,
    sources,
    topics,
    runtime: {
      enabled: envBoolean(env, "RESEARCH_ENABLED", true),
      clearCache: envBoolean(env, "CLEAR_RESEARCH_CACHE", false),
      lookbackDays: envInteger(env, "RESEARCH_LOOKBACK_DAYS", lookbackDays, 1, 30),
      maxPapers: envInteger(env, "MAX_RESEARCH_PAPERS", maxPapers, 1, 20),
      cacheDays: envInteger(env, "RESEARCH_CACHE_DAYS", cacheDays, 1, 365),
      overlapHours: boundedInteger(runtime.overlap_hours, "runtime.overlap_hours", 0, 168),
      minScore: boundedInteger(runtime.min_score, "runtime.min_score", 0, 100),
      maxPerTopic: boundedInteger(runtime.max_per_topic, "runtime.max_per_topic", 1, 10),
    },
  };
}

export function loadResearchConfig(
  file = path.resolve("config/research-interests.json"),
  env: Env = process.env,
): ResearchConfig {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as ResearchConfigInput;
  return parseResearchConfig(raw, env);
}
