import assert from "node:assert/strict";
import test from "node:test";

import { summarizeResearchPapers } from "../../lib/research/summarize";
import type { ResearchPaper } from "../../lib/research/types";

function paper(id: string): ResearchPaper {
  return {
    id,
    pmid: id.replace("pmid:", ""),
    title: `English title ${id}`,
    abstract: "A randomized trial enrolled 240 participants and reported a 12.5% primary outcome rate.",
    journal: "Example Journal",
    authors: ["Alice Smith"],
    publicationTypes: ["Randomized Controlled Trial"],
    publishedAt: "2026-08-03T00:00:00.000Z",
    activityAt: "2026-08-04T00:00:00.000Z",
    url: `https://pubmed.ncbi.nlm.nih.gov/${id.replace("pmid:", "")}/`,
    sourceKinds: ["pubmed"],
    matchedTopicIds: ["mfm"],
    assignedTopicId: "mfm",
    score: {
      topicMatch: 50,
      evidence: 23.75,
      clinicalActionability: 15,
      recency: 10,
      total: 98.75,
      evidenceRank: 0.95,
    },
  };
}

function responseFor(id: string) {
  return {
    id,
    title_zh: "中文题名",
    research_question: "研究治疗是否改善结局。",
    study_design: "随机对照试验。",
    population_and_sample: "共240名参与者。",
    methods: "比较干预与对照。",
    key_results: "主要结局发生率为12.5%。",
    limitations: "摘要未报告。",
    clinical_interpretation: "结果可为后续研究提供依据，不能替代指南。",
  };
}

test("sends only source metadata and preserves deterministic fields", async () => {
  let capturedPrompt = "";
  const input = [paper("pmid:1"), paper("pmid:2")];
  const output = await summarizeResearchPapers(input, {
    runLlm: async (options) => {
      capturedPrompt = options.userPrompt;
      return {
        text: `\`\`\`json\n${JSON.stringify({ papers: input.map((item) => responseFor(item.id)) })}\n\`\`\``,
        durationMs: 1,
      };
    },
  });
  assert.deepEqual(output.map((item) => item.id), ["pmid:1", "pmid:2"]);
  assert.equal(output[0].score?.total, 98.75);
  assert.equal(output[0].assignedTopicId, "mfm");
  assert.equal(output[0].summaryStatus, "success");
  assert.equal(output[0].summaryZh?.keyResults, "主要结局发生率为12.5%。");
  assert.match(capturedPrompt, /12\.5%/);
  assert.doesNotMatch(capturedPrompt, /98\.75|topicMatch|assignedTopicId/);
});

test("repairs minor JSON syntax errors", async () => {
  const output = await summarizeResearchPapers([paper("pmid:1")], {
    runLlm: async () => ({
      text: `{papers:[${JSON.stringify(responseFor("pmid:1"))},],}`,
      durationMs: 1,
    }),
  });
  assert.equal(output[0].summaryStatus, "success");
});

test("fills absent summary fields with 摘要未报告", async () => {
  const partial = responseFor("pmid:1") as Record<string, string>;
  delete partial.limitations;
  const output = await summarizeResearchPapers([paper("pmid:1")], {
    runLlm: async () => ({ text: JSON.stringify({ papers: [partial] }), durationMs: 1 }),
  });
  assert.equal(output[0].summaryZh?.limitations, "摘要未报告");
});

test("marks missing ids and unrecoverable responses as failed without fallback prose", async () => {
  const missing = await summarizeResearchPapers([paper("pmid:1")], {
    runLlm: async () => ({ text: JSON.stringify({ papers: [responseFor("pmid:999")] }), durationMs: 1 }),
  });
  assert.equal(missing[0].summaryStatus, "failed");
  assert.equal(missing[0].summaryZh, undefined);

  const malformed = await summarizeResearchPapers([paper("pmid:1")], {
    runLlm: async () => ({ text: "not json at all", durationMs: 1 }),
  });
  assert.equal(malformed[0].summaryStatus, "failed");
  assert.equal(malformed[0].summaryZh, undefined);
});
