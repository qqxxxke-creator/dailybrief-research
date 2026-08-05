import { jsonrepair } from "jsonrepair";

import { extractJson } from "../ai/json-util";
import { runLlm as defaultRunLlm } from "../ai/llm";
import { SYSTEM_PROMPT_RESEARCH } from "../ai/research-prompts";
import { REPORT_LOCALE } from "../sources/registry";
import type { ResearchPaper, ResearchSummaryZh } from "./types";

type RunLlm = typeof defaultRunLlm;

const RESPONSE_FIELDS = [
  ["title_zh", "titleZh"],
  ["research_question", "researchQuestion"],
  ["study_design", "studyDesign"],
  ["population_and_sample", "populationAndSample"],
  ["methods", "methods"],
  ["key_results", "keyResults"],
  ["limitations", "limitations"],
  ["clinical_interpretation", "clinicalInterpretation"],
] as const;

function failed(papers: ResearchPaper[]): ResearchPaper[] {
  return papers.map((paper) => ({
    ...paper,
    summaryZh: undefined,
    summaryStatus: "failed" as const,
  }));
}

function parseResponse(text: string): unknown {
  const cleaned = extractJson(text);
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    return JSON.parse(jsonrepair(cleaned)) as unknown;
  }
}

function summaryFrom(value: unknown): ResearchSummaryZh | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const absent = REPORT_LOCALE === "en" ? "Not reported in the abstract" : "摘要未报告";
  const output: Record<string, string> = {};
  for (const [wireName, propertyName] of RESPONSE_FIELDS) {
    const field = raw[wireName];
    output[propertyName] = typeof field === "string" && field.trim() ? field.trim() : absent;
  }
  return output as unknown as ResearchSummaryZh;
}

function userPrompt(papers: ResearchPaper[]): string {
  const payload = papers.map((paper) => ({
    id: paper.id,
    pmid: paper.pmid,
    doi: paper.doi,
    title: paper.title,
    abstract: paper.abstract,
    journal: paper.journal,
    authors: paper.authors,
    publication_types: paper.publicationTypes,
    published_at: paper.publishedAt,
    activity_at: paper.activityAt,
  }));
  const schema = {
    papers: [
      {
        id: "copy input id exactly",
        title_zh: "string",
        research_question: "string",
        study_design: "string",
        population_and_sample: "string",
        methods: "string",
        key_results: "string",
        limitations: "string",
        clinical_interpretation: "string",
      },
    ],
  };
  return [
    REPORT_LOCALE === "en"
      ? "Summarize every input paper once. Return exactly this JSON shape:"
      : "逐篇解读全部输入论文，每篇只出现一次。严格返回以下 JSON 结构：",
    JSON.stringify(schema),
    REPORT_LOCALE === "en" ? "Input papers:" : "输入论文：",
    JSON.stringify(payload),
  ].join("\n\n");
}

export async function summarizeResearchPapers(
  papers: ResearchPaper[],
  deps: { runLlm?: RunLlm } = {},
): Promise<ResearchPaper[]> {
  if (papers.length === 0) return [];
  const runLlm = deps.runLlm ?? defaultRunLlm;
  let parsed: unknown;
  try {
    const result = await runLlm({
      systemPrompt: SYSTEM_PROMPT_RESEARCH,
      userPrompt: userPrompt(papers),
    });
    parsed = parseResponse(result.text);
  } catch {
    return failed(papers);
  }

  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { papers?: unknown }).papers)) {
    return failed(papers);
  }
  const responseItems = (parsed as { papers: unknown[] }).papers;
  const byId = new Map<string, ResearchSummaryZh>();
  for (const item of responseItems) {
    if (!item || typeof item !== "object") continue;
    const id = (item as { id?: unknown }).id;
    if (typeof id !== "string" || byId.has(id)) continue;
    const summary = summaryFrom(item);
    if (summary) byId.set(id, summary);
  }

  return papers.map((paper) => {
    const summaryZh = byId.get(paper.id);
    return summaryZh
      ? { ...paper, summaryZh, summaryStatus: "success" }
      : { ...paper, summaryZh: undefined, summaryStatus: "failed" };
  });
}
