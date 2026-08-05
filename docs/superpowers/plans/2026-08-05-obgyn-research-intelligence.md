# OB-GYN Research Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DailyBrief 中新增可配置、可解释、可缓存的妇产科论文追踪管线，并把“研究前沿追踪”作为晨报最后一个栏目，稳定输出最多 5 篇中文结构化论文解读。

**Architecture:** Research Intelligence 是与新闻抓取平行的原生 TypeScript 子模块。PubMed 与经验证的期刊 RSS 先归一化、去重并做确定性评分，只有通过阈值的前 5 篇调用现有 `runLlm()` 生成中文摘要；运行状态存入独立 JSON 缓存。主晨报把结果作为 `DailyReport.research` 可选字段挂载，任何研究源、缓存或摘要错误都不得阻塞新闻报告。

**Tech Stack:** Node.js 20、TypeScript 5、`tsx`、Node 内置 `node:test`、`rss-parser`、PubMed E-utilities、项目现有 `runLlm()` / `extractJson()` / `jsonrepair`、GitHub Actions cache。

## Global Constraints

- 论文栏目永远位于 HTML 和 Markdown 主内容的最后、footer 之前；不占新闻 10–15 条额度。
- 论文来源与兴趣方向只在 `config/research-interests.json` 配置；`sources.config.json` 继续只管理新闻源。
- 所有 LLM 请求必须经过 `lib/ai/llm.ts` 的 `runLlm()`，不得直接调用某个厂商 SDK。
- 日期边界由 `todayKey()` / `REPORT_TZ` 决定；不得硬编码时区。
- PMID、规范化 DOI、规范化题名按此优先级去重；PubMed 元数据优先于 RSS。
- 评分、排序、主题归属由确定性代码完成，LLM 不得改分、改序或改主题。
- 只有具有有效摘要、活动日期不早于检索窗口且分数不低于 45 的论文可以进入当日候选。
- 每个主题最多 2 篇、全局最多 5 篇；不足 3 篇时宁缺毋滥。
- 缓存写入采用临时文件加原子替换；所有研究源失败时沿用旧缓存且不推进 `lastSuccessfulRun`。
- 每个外部源独立捕获错误；研究模块整体失败时新闻流程仍生成报告。
- 中文摘要严格依据题名、摘要和元数据；摘要没给出的信息写“摘要未报告”。
- 不复制 `Futuresxy/paper-daily` 源代码；只重做已确认的机制。

---

## Task 1: 建立测试入口、核心类型与配置加载器

**Files:**

- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `config/research-interests.json`
- Create: `lib/research/types.ts`
- Create: `lib/research/config.ts`
- Create: `tests/research/config.test.ts`

- [ ] **Step 1: 为配置校验写失败测试**

在 `tests/research/config.test.ts` 覆盖：默认配置包含 5 个唯一且启用的主题；分值和数量环境变量被正确解析；重复 `id`、空关键词、非法来源类型、负数窗口、`maxPapers > 20` 会抛出带字段路径的错误。

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { parseResearchConfig } from "../../lib/research/config";

test("rejects duplicate topic ids", () => {
  const input = validConfig();
  input.topics[1].id = input.topics[0].id;
  assert.throws(() => parseResearchConfig(input, {}), /topics\[1\]\.id.*duplicate/);
});

test("environment overrides bounded runtime values", () => {
  const config = parseResearchConfig(validConfig(), {
    RESEARCH_LOOKBACK_DAYS: "5",
    MAX_RESEARCH_PAPERS: "4",
    RESEARCH_CACHE_DAYS: "21",
  });
  assert.equal(config.runtime.lookbackDays, 5);
  assert.equal(config.runtime.maxPapers, 4);
  assert.equal(config.runtime.cacheDays, 21);
});
```

- [ ] **Step 2: 添加测试脚本并验证测试确实失败**

`package.json`：

```json
"test": "tsx --test tests/**/*.test.ts",
"test:research": "tsx --test tests/research/**/*.test.ts"
```

`tsconfig.json` 的 `include` 加入 `"tests/**/*.ts"`。

Run: `npm run test:research`

Expected: FAIL，提示找不到 `lib/research/config`。

- [ ] **Step 3: 定义稳定的数据契约**

在 `lib/research/types.ts` 导出：

```ts
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

export interface ResearchSection {
  generatedAt: string;
  dataAsOf: string;
  isCachedFallback: boolean;
  dailySignal: string;
  papers: ResearchPaper[];
}
```

另定义 `ResearchSourceConfig`、`ResearchRuntimeConfig`、`ResearchConfig`、`ResearchCache`、`ResearchFetchResult`；缓存 schema 固定为 `schemaVersion: 1`。

- [ ] **Step 4: 实现配置加载与默认配置**

`config/research-interests.json` 明确写入 5 个主题及来源：PubMed 默认启用；七个 RSS 均以 `enabled: false` 起步，待 Task 5 dry-run 验证后逐一开启。主题的公开 JSON 字段严格使用设计约定的 `id`、`name`、`description`、`include_keywords`、`exclude_keywords`、`publication_types`、`enabled`；加载器将 snake_case 边界对象映射为 TypeScript 内部的 camelCase 类型。来源对象使用 `id`、`name`、`kind`、`url`、`enabled`，PubMed 的 URL 为 E-utilities 基址。默认值：7 天回看、45 分阈值、每主题 2 篇、总计 5 篇、缓存 30 天、重叠 48 小时。

`loadResearchConfig()` 从仓库根目录读取 JSON，`parseResearchConfig(input, env)` 做纯函数校验与 env 覆盖。布尔值只接受 `true` / `false`，数字必须为十进制有限整数并受合理边界约束。

- [ ] **Step 5: 跑测试与类型检查**

Run: `npm run test:research && npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add package.json tsconfig.json config/research-interests.json lib/research/types.ts lib/research/config.ts tests/research/config.test.ts
git commit -m "feat(research): add typed interest configuration"
```

## Task 2: 实现归一化、身份键与跨来源去重

**Files:**

- Create: `lib/research/normalize.ts`
- Create: `tests/research/normalize.test.ts`

- [ ] **Step 1: 写 DOI、题名和去重失败测试**

测试用例必须覆盖：`https://doi.org/10.x/ABC.` 归一为小写且去尾标点；HTML 实体、Unicode 破折号、连续空白不影响题名键；PMID 优先；同 DOI 的 PubMed 记录覆盖 RSS 字段但保留 RSS URL/来源；无 PMID/DOI 时回退题名；多主题匹配被合并。

```ts
test("prefers PubMed metadata while merging RSS provenance", () => {
  const merged = dedupeResearchPapers([rssPaper(), pubmedPaper()]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].abstract, pubmedPaper().abstract);
  assert.deepEqual(new Set(merged[0].sourceKinds), new Set(["pubmed", "journal-rss"]));
});
```

- [ ] **Step 2: 验证失败**

Run: `npm run test:research`

Expected: FAIL，找不到 `normalize.ts` 导出。

- [ ] **Step 3: 实现纯函数**

导出 `normalizeDoi()`、`normalizeTitle()`、`paperIdentityKeys()`、`dedupeResearchPapers()`。去重不能只用单一 Map 键：按每篇论文的 PMID、DOI、题名三个候选键查询已有索引，合并后再回填全部可用键，避免 A 以 DOI 命中 B、B 又以题名命中 C 时出现链式重复。

合并规则：PubMed 的题名、摘要、期刊、作者、publication types 优先；RSS 可补缺失 URL/日期；`sourceKinds`、`matchedTopicIds` 取稳定去重并排序。

- [ ] **Step 4: 跑测试并提交**

Run: `npm run test:research && npx tsc --noEmit`

Expected: PASS。

```bash
git add lib/research/normalize.ts tests/research/normalize.test.ts
git commit -m "feat(research): normalize and deduplicate papers"
```

## Task 3: 实现主题匹配、证据分层与确定性排序

**Files:**

- Create: `lib/research/scoring.ts`
- Create: `tests/research/scoring.test.ts`

- [ ] **Step 1: 用表驱动测试锁定评分公式**

覆盖全部证据权重、临床可操作性分类、四档新近性、排除词、一稿多主题、45 分阈值、每主题 2 篇、全局 5 篇及 tie-break。时间测试统一注入 `now = new Date("2026-08-05T00:00:00Z")`。

```ts
test("scores an RCT deterministically", () => {
  const result = scorePaper(rctPaper(), topic(), NOW);
  assert.deepEqual(result, {
    topicMatch: 50,
    evidence: 23.75,
    clinicalActionability: 15,
    recency: 10,
    total: 98.75,
    evidenceRank: 0.95,
  });
});
```

- [ ] **Step 2: 验证失败**

Run: `npm run test:research`

Expected: FAIL，找不到评分导出。

- [ ] **Step 3: 实现主题匹配与评分**

`matchTopics(paper, topics)` 在规范化后的 `title + abstract + publicationTypes` 上做大小写不敏感短语匹配；任意 exclude 命中即剔除。主题分按题名命中、摘要命中、publication type 命中组合封顶为 50，并在代码中使用命名常量，禁止魔法数字。

评分公式：

```ts
total = round2(topicMatch + 25 * evidenceWeight + 15 * actionabilityWeight + 10 * recencyWeight);
```

证据和临床分类按设计文档 8.3、8.4 的完整表实现。无法分类分别使用 0.40。指南、共识、撤稿、更正、新闻、无摘要直接返回不可入选原因。

- [ ] **Step 4: 实现主题配额选择器**

`selectResearchPapers(papers, config)` 先为每篇保留最高主题分对应主题，再按 `total desc → evidenceRank desc → activityAt desc → id asc` 排序，依次执行主题与总量配额。不能为凑 3 篇绕过 45 分阈值。

- [ ] **Step 5: 跑测试并提交**

Run: `npm run test:research && npx tsc --noEmit`

Expected: PASS。

```bash
git add lib/research/scoring.ts tests/research/scoring.test.ts
git commit -m "feat(research): add deterministic clinical ranking"
```

## Task 4: 实现 PubMed E-utilities 适配器

**Files:**

- Create: `lib/research/sources/pubmed.ts`
- Create: `tests/fixtures/research/pubmed-esearch.json`
- Create: `tests/fixtures/research/pubmed-efetch.xml`
- Create: `tests/research/pubmed.test.ts`

- [ ] **Step 1: 保存最小、匿名化的 ESearch/EFetch 固定 fixture 并写解析测试**

测试：检索词含日期窗口与主题 OR 组；ESearch 分批 ID 传给 EFetch；XML 可解析结构化摘要、PMID、DOI、作者、期刊、publication types、epub/pubmed 日期；缺失摘要的论文仍可被解析但会在评分前过滤；HTTP 429/500 抛出带 source id 的可诊断错误。

- [ ] **Step 2: 验证失败**

Run: `npm run test:research`

Expected: FAIL，找不到 PubMed 适配器。

- [ ] **Step 3: 实现可注入 fetch 的适配器**

```ts
export async function fetchPubMedPapers(args: {
  topics: ResearchTopic[];
  from: Date;
  to: Date;
  fetchImpl?: typeof fetch;
  apiKey?: string;
}): Promise<ResearchFetchResult>;
```

ESearch 使用 `datetype=edat`、`retmode=json`、`retmax=200`；EFetch 使用 `db=pubmed&retmode=xml` 并每批最多 100 个 PMID。请求设置明确的 `tool=dailybrief-research` 和可选 `email`/`api_key`。查询只负责召回，排除规则仍由评分层统一执行。

不用新装 XML 依赖：实现针对此 EFetch 子集的受测解析器；先解码 XML 实体，再抽取重复节点。若实现过程中发现实际 fixture 含嵌套格式导致自写解析器不可靠，应先写复现测试，再以单独提交引入轻量 XML parser。

- [ ] **Step 4: 跑离线测试并提交**

Run: `npm run test:research && npx tsc --noEmit`

Expected: PASS，测试不得访问网络。

```bash
git add lib/research/sources/pubmed.ts tests/fixtures/research/pubmed-esearch.json tests/fixtures/research/pubmed-efetch.xml tests/research/pubmed.test.ts
git commit -m "feat(research): fetch and parse PubMed records"
```

## Task 5: 实现期刊 RSS 适配器并验证可用源

**Files:**

- Create: `lib/research/sources/journal-rss.ts`
- Create: `tests/fixtures/research/journal-rss.xml`
- Create: `tests/research/journal-rss.test.ts`
- Modify: `config/research-interests.json`

- [ ] **Step 1: 写 RSS 映射失败测试**

覆盖 RSS 2.0 与 Atom 常见字段：title、link/guid、pubDate/updated、description/content:encoded、dc:creator、dc:identifier DOI；摘要中的 HTML 被转为纯文本；无法提供题名、链接、日期或有效摘要的记录返回 reject reason，不进入候选。

- [ ] **Step 2: 验证失败并实现适配器**

Run: `npm run test:research`

Expected: FAIL。

```ts
export async function fetchJournalRssPapers(args: {
  source: ResearchSourceConfig;
  from: Date;
  to: Date;
  parser?: Pick<RSSParser, "parseURL">;
}): Promise<ResearchFetchResult>;
```

使用现有 `rss-parser`，每个 feed 单独调用和报错。来源只从配置传入，不在 TS 中硬编码。

- [ ] **Step 3: 跑真实 dry-run 形成启用清单**

Task 8 的脚本落地前，可先增加一个只调用适配器的临时测试入口，但不能提交临时代码。逐一验证 AJOG、Obstetrics & Gynecology、BJOG、Fertility and Sterility、Human Reproduction、Gynecologic Oncology、JMIG。记录每个源 `fetched / validAbstract / newestActivityAt / error`；只有当天实际返回题名、链接、日期和摘要的 feed 才将 `enabled` 改为 `true`。

Run: `npm run test:research`

Expected: 离线测试 PASS；网络验证失败不影响测试，但配置中对应 RSS 保持禁用并在设计实现记录说明原因。

- [ ] **Step 4: 提交**

```bash
git add lib/research/sources/journal-rss.ts tests/fixtures/research/journal-rss.xml tests/research/journal-rss.test.ts config/research-interests.json
git commit -m "feat(research): add validated journal RSS discovery"
```

## Task 6: 实现增量窗口、30 天缓存与故障回退

**Files:**

- Create: `lib/research/cache.ts`
- Create: `tests/research/cache.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: 写时间窗口和缓存失败测试**

覆盖：首次运行回看 7 天；后续从上次成功时间向前重叠 48 小时；只要一个源成功就可推进成功时间；全部源失败时不推进；新记录覆盖同身份旧记录；只保留 30 天；坏 JSON 被隔离为 `.corrupt-<timestamp>` 并从空缓存恢复；`CLEAR_RESEARCH_CACHE=true` 忽略旧缓存。

- [ ] **Step 2: 验证失败并实现纯函数与 I/O 壳**

```ts
export function computeResearchWindow(
  cache: ResearchCache,
  now: Date,
  runtime: ResearchRuntimeConfig,
): { from: Date; to: Date };

export function mergeResearchCache(args: {
  previous: ResearchCache;
  fetched: ResearchPaper[];
  successfulSourceCount: number;
  now: Date;
  retentionDays: number;
}): ResearchCache;
```

`loadResearchCache()` 与 `saveResearchCacheAtomic()` 默认路径 `data/research/research-cache.json`，并允许测试传入临时路径。原子写入使用同目录临时文件和 `renameSync`。

- [ ] **Step 3: 更新忽略规则**

`.gitignore` 加入：

```gitignore
/data/research/research-cache.json
/data/research/*.tmp
/data/research/*.corrupt-*
```

保留目录说明文件不是必须的，运行器会递归创建目录。

- [ ] **Step 4: 跑测试并提交**

Run: `npm run test:research && npx tsc --noEmit`

Expected: PASS。

```bash
git add lib/research/cache.ts tests/research/cache.test.ts .gitignore
git commit -m "feat(research): add incremental atomic cache"
```

## Task 7: 生成严格、忠实的中文结构化摘要

**Files:**

- Create: `lib/research/summarize.ts`
- Create: `lib/ai/research-prompts.ts`
- Create: `tests/research/summarize.test.ts`

- [ ] **Step 1: 写 LLM 边界失败测试**

通过注入 fake `runLlm` 验证：请求只含题名、摘要、作者/期刊/日期/研究类型等元数据；严格 JSON 正常解析；代码围栏经 `extractJson()` 清理；轻微 JSON 错误经 `jsonrepair` 修复；缺字段补“摘要未报告”；无法修复时返回 `summaryStatus: "failed"`，不编造备用摘要；原始分数、顺序和主题不变。

- [ ] **Step 2: 验证失败并添加中英提示词**

`lib/ai/research-prompts.ts` 导出 ZH/EN 两套 system prompt，并按 `REPORT_LOCALE` 选择。中文模式明确禁止：补写全文信息、因果夸大、指南化表述、改写数值。英文 locale 可生成英文同结构字段，但接口名保持不变以避免双 schema。

- [ ] **Step 3: 实现摘要服务**

```ts
type RunLlm = typeof import("../ai/llm").runLlm;

export async function summarizeResearchPapers(
  papers: ResearchPaper[],
  deps?: { runLlm?: RunLlm },
): Promise<ResearchPaper[]>;
```

单次批量发送最多 5 篇，响应为 `{ papers: [{ id, ...ResearchSummaryZh }] }`。按 `id` 回填，缺失或多余 id 视为该项失败；每个字符串字段去首尾空白且不能为空。论文原始英文题名、URL 和精确数值仍保留在 `ResearchPaper`。

- [ ] **Step 4: 跑测试并提交**

Run: `npm run test:research && npx tsc --noEmit`

Expected: PASS。

```bash
git add lib/research/summarize.ts lib/ai/research-prompts.ts tests/research/summarize.test.ts
git commit -m "feat(research): generate grounded structured summaries"
```

## Task 8: 编排完整研究管线与无 LLM dry-run

**Files:**

- Create: `lib/research/runner.ts`
- Create: `scripts/research-dry-run.ts`
- Create: `tests/research/runner.test.ts`
- Modify: `package.json`

- [ ] **Step 1: 写管线故障矩阵测试**

注入 fake source adapters、时钟、缓存和摘要器，覆盖：研究关闭直接返回 `undefined`；PubMed 成功 RSS 失败仍产生结果并推进缓存；全部源失败从缓存选出仍在 7 天窗口内的候选并标记 `isCachedFallback`; 无可用缓存返回空 `papers` 而不抛错；摘要失败保留元数据；低于阈值不调用摘要器；`dailySignal` 只基于最终论文元数据与摘要生成。

- [ ] **Step 2: 验证失败并实现 runner**

```ts
export async function runResearchIntelligence(deps?: ResearchDeps): Promise<ResearchSection | undefined>;
```

固定顺序：加载配置 → 加载缓存 → 计算窗口 → 并行抓取启用来源且逐源捕获 → 归一化/去重 → 合并缓存 → 过滤/评分/配额选择 → 摘要 → 生成 `ResearchSection` → 原子保存缓存。缓存中保存已成功的摘要，身份与输入摘要未变时不得重复调用 LLM。

`dataAsOf` 取最新成功源数据时间；缓存回退取缓存最后成功时间。`dailySignal` 由最终条目的题名/临床解释组合成一段 80–150 字概览；若没有论文则使用本地化固定文案，不额外调用 LLM。

- [ ] **Step 3: 实现 dry-run**

`scripts/research-dry-run.ts` 必须先 `import "./_env"`，不调用 LLM、不写正式缓存，输出每源抓取数、有效摘要数、去重数、淘汰原因分布、入选分数/主题/PMID。网络错误最终仅在所有源均失败时把进程退出码设为 1。

`package.json` 增加：

```json
"research:dry-run": "tsx scripts/research-dry-run.ts"
```

- [ ] **Step 4: 跑离线测试与受控网络 smoke test**

Run: `npm run test:research && npx tsc --noEmit`

Expected: PASS。

Run: `npm run research:dry-run`

Expected: 至少 PubMed 显示成功，输出 0–5 个候选且没有 LLM 调用记录。若网络环境受限，保存日志并在具备网络的 GitHub Actions 中重复此 smoke test，不把网络失败解释为单元测试失败。

- [ ] **Step 5: 提交**

```bash
git add lib/research/runner.ts scripts/research-dry-run.ts tests/research/runner.test.ts package.json
git commit -m "feat(research): orchestrate resilient paper tracking"
```

## Task 9: 接入 DailyReport，并在报告最后渲染研究栏目

**Files:**

- Modify: `lib/ai/pipeline.ts`
- Modify: `scripts/daily.ts`
- Modify: `lib/output/render.ts`
- Modify: `scripts/render.ts`
- Create: `tests/research/render.test.ts`
- Create: `tests/research/daily-integration.test.ts`

- [ ] **Step 1: 写报告顺序与转义失败测试**

构造包含恶意 HTML、特殊字符、缓存回退和 2 篇论文的 `DailyReport`。断言：研究标题出现在主内容最后且在 `<footer>` 前；论文题名、摘要、期刊、主题、分数、PMID/DOI、原文链接均正确；用户内容全部转义；Markdown 研究块在关键词/编辑短评之后；无 `research` 时旧报告输出不变；空论文列表仍可显示“今日无符合阈值的新论文”。

- [ ] **Step 2: 验证失败并扩展报告类型**

`DailyReport` 增加：

```ts
/** Optional research-frontier section; always rendered last when present. */
research?: ResearchSection;
```

只需 type-only import，`callOnce()` 的新闻 JSON schema 不包含 `research`，避免新闻 LLM 伪造研究结果。

- [ ] **Step 3: 非阻塞接入日流水线**

在新闻抓取和摘要生成可正常继续的前提下调用研究 runner：

```ts
let research: ResearchSection | undefined;
try {
  research = await runResearchIntelligence();
} catch (error) {
  console.warn(`[daily] research section failed: ${errorMessage(error)}`);
}
// generateDailyReport 完成后
if (research) report.research = research;
```

研究调用可与 trading 并行，但两者各自必须有独立错误边界。不得因研究返回 0 篇而删除已经形成的缓存回退说明。

- [ ] **Step 4: 实现 HTML/Markdown renderer**

在 `TEXTS_ZH` / `TEXTS_EN` 增加研究栏目全部 UI 字符串。创建 `renderResearchSection()` 和 `renderResearchMarkdown()`；HTML 位置固定在所有 `.panel` 之后、`footer` 之前，不做成可被 tab 隐藏的 panel。卡片显示中文题名、英文原题、期刊日期、证据/主题标签、总分、八字段解读和原文链接；摘要失败显示“中文摘要生成失败”，不填推断内容。

- [ ] **Step 5: 验证旧报告重渲染兼容性**

`scripts/render.ts` 直接从 `<date>.json` 读取可选 `research`，无需另读当前缓存。这样每日 JSON 自身就是研究入选条目的归档 sidecar，历史报告不会随缓存变化。

Run: `npm run test:research && npx tsc --noEmit`

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
git add lib/ai/pipeline.ts scripts/daily.ts lib/output/render.ts scripts/render.ts tests/research/render.test.ts tests/research/daily-integration.test.ts
git commit -m "feat(report): append research frontier section"
```

## Task 10: GitHub Actions 缓存、配置文档与全链路验收

**Files:**

- Modify: `.github/workflows/daily.yml`
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Create: `docs/research-intelligence.md`
- Create: `tests/research/config-contract.test.ts`

- [ ] **Step 1: 用契约测试锁定公开配置**

测试读取 `.env.example`、workflow 与配置文件，断言 5 个环境变量均有文档且在 Actions 被转发；workflow 含 `actions/cache@v4` 且路径为 `data/research/research-cache.json`；research 配置有 5 个唯一主题和至少一个启用源。

- [ ] **Step 2: 验证失败并更新 Actions**

在生成报告前加入：

```yaml
- name: Restore research cache
  uses: actions/cache@v4
  with:
    path: data/research/research-cache.json
    key: research-${{ runner.os }}-${{ github.ref_name }}-${{ github.run_id }}
    restore-keys: |
      research-${{ runner.os }}-${{ github.ref_name }}-
```

生成步骤转发：

```yaml
RESEARCH_ENABLED: ${{ vars.RESEARCH_ENABLED || 'true' }}
RESEARCH_LOOKBACK_DAYS: ${{ vars.RESEARCH_LOOKBACK_DAYS || '7' }}
MAX_RESEARCH_PAPERS: ${{ vars.MAX_RESEARCH_PAPERS || '5' }}
RESEARCH_CACHE_DAYS: ${{ vars.RESEARCH_CACHE_DAYS || '30' }}
CLEAR_RESEARCH_CACHE: ${{ vars.CLEAR_RESEARCH_CACHE || 'false' }}
```

cache action 的 post step 自动保存新 key；使用唯一 `run_id` 避免 immutable cache 无法覆盖。

- [ ] **Step 3: 更新用户和维护文档**

`.env.example` 解释全部变量、默认值与成本。`docs/research-intelligence.md` 说明兴趣关键词编辑、排除词、主题停用、dry-run、评分公式、缓存恢复、GitHub variables、常见故障和医学免责声明。README 加入口链接。

`AGENTS.md` 将 source invariant 明确为：`sources.config.json` 是新闻源唯一注册表；研究文献源是独立子系统，只能在 `config/research-interests.json` 配置。同步项目布局、命令、错误边界和禁止事项。

- [ ] **Step 4: 运行完整离线验证**

Run: `npm test`

Expected: 所有测试 PASS，且无网络请求。

Run: `npx tsc --noEmit`

Expected: PASS。

Run: `npm run sources:check`

Expected: 现有新闻源配置仍 PASS。

- [ ] **Step 5: 运行研究 smoke test 与一次完整晨报**

先设置有效 LLM 凭证，再运行：

```bash
npm run research:dry-run
npm run daily
npm run render
```

Expected:

- dry-run 显示 PubMed 成功、来源统计和可解释分数，不调用 LLM。
- daily 即使某个 RSS 失败仍生成 `.json` 与 `.html`。
- `<date>.json` 的 `research.papers.length` 为 0–5，每主题最多 2。
- HTML 中“研究前沿追踪”位于所有新闻内容之后、footer 之前。
- 第二次运行命中缓存，已摘要且内容未变的论文不重复调用 LLM。

- [ ] **Step 6: 故障演练**

用测试注入或临时网络阻断模拟全部研究源失败，确认新闻产物仍生成；存在缓存时标记 `isCachedFallback: true` 和数据日期，无缓存时显示空态。恢复环境后不得提交临时密钥、缓存或日志。

- [ ] **Step 7: 最终自审与提交**

Run: `git diff --check && git status --short`

Expected: 无 whitespace error；只出现计划内文件。

```bash
git add .github/workflows/daily.yml .env.example README.md AGENTS.md docs/research-intelligence.md tests/research/config-contract.test.ts
git commit -m "docs(research): document operations and CI cache"
```

## Completion Gate

- [ ] `npm test`、`npx tsc --noEmit`、`npm run sources:check` 全部通过。
- [ ] `npm run research:dry-run` 至少有一个真实来源成功，且不调用 LLM。
- [ ] 完整晨报在研究源部分或全部失败时均可生成。
- [ ] 入选规则精确满足：`score >= 45`、每主题最多 2、总计最多 5。
- [ ] 同一 PMID/DOI/规范化题名只展示一次，PubMed 元数据优先。
- [ ] 论文摘要不改变分数、排序、主题或论文原始数值。
- [ ] HTML 与 Markdown 的研究栏目均位于最后。
- [ ] `.env`、缓存、日志、真实 API 响应中可能含敏感信息的文件均未入 Git。
- [ ] 所有提交只在本地分支；推送 `origin` 前再次向用户确认。
