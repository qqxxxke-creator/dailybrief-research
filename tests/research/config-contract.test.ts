import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const ENV_VARS = [
  "RESEARCH_ENABLED",
  "RESEARCH_LOOKBACK_DAYS",
  "MAX_RESEARCH_PAPERS",
  "RESEARCH_CACHE_DAYS",
  "CLEAR_RESEARCH_CACHE",
];

test("documents every public research environment variable", () => {
  const example = fs.readFileSync(".env.example", "utf8");
  for (const variable of ENV_VARS) assert.match(example, new RegExp(`^# ${variable}=`, "m"));
});

test("restores the research cache and forwards runtime variables in Actions", () => {
  const workflow = fs.readFileSync(".github/workflows/daily.yml", "utf8");
  assert.match(workflow, /uses: actions\/cache@v4/);
  assert.match(workflow, /path: data\/research\/research-cache\.json/);
  for (const variable of ENV_VARS) assert.match(workflow, new RegExp(`${variable}:`));
});

test("ships five unique interests and at least one enabled discovery source", () => {
  const config = JSON.parse(fs.readFileSync("config/research-interests.json", "utf8")) as {
    topics: Array<{ id: string }>;
    sources: Array<{ enabled: boolean }>;
  };
  assert.equal(config.topics.length, 5);
  assert.equal(new Set(config.topics.map((topic) => topic.id)).size, 5);
  assert.ok(config.sources.some((source) => source.enabled));
});
