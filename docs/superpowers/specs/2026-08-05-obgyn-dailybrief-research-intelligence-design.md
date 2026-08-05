# OB-GYN Daily Brief V1.1：Research Intelligence 设计

## 1. 背景

本设计在 `OBGYN_DailyBrief_Design.md` V1.0 的新闻晨报基础上，新增独立的 Research Intelligence 子模块。该模块参考 `Futuresxy/paper-daily` 的兴趣方向配置、自动发现、相关性评分、增量更新和缓存思想，但按 DailyBrief 的 TypeScript 技术栈重新实现，并针对医学论文的证据等级和临床解释要求进行调整。

Research Intelligence 是晨报最后一个栏目，用于提供当日新闻之后的专业延伸阅读。它不替代指南栏目，也不把单篇论文结论表述为临床建议。

## 2. 目标与范围

### 2.1 目标

- 自动发现与妇产科兴趣方向相关的新论文。
- 以可解释、可测试的确定性规则完成排序。
- 每天精选 3–5 篇具有研究或临床价值的论文。
- 生成忠于论文摘要的中文结构化解读。
- 使用增量检索和缓存控制请求量、重复条目与 LLM 成本。
- 论文模块失败时，新闻晨报仍可正常生成和发布。

### 2.2 V1.1 范围

- 使用 PubMed 和妇产科核心期刊 RSS 发现论文。
- 使用本地 JSON 文件配置兴趣方向。
- 使用 PMID、DOI 和规范化题名去重。
- 使用确定性评分选出候选论文。
- 仅对排名靠前且有有效摘要的论文调用 LLM。
- 在 GitHub Actions 和本地运行中保存最近 30 天缓存。
- 在 HTML 晨报末尾渲染“研究前沿追踪”栏目。

### 2.3 暂不实现

- GitHub Issue 动态配置。
- Google Scholar、OpenAlex、Crossref 和 Semantic Scholar 自动检索。
- arXiv、medRxiv 等预印本。
- 独立会议论文库。
- LLM 修改或重排确定性相关性分数。
- 自动抓取论文全文或绕过付费墙。
- 跨新闻栏目和论文栏目的 DOI 级去重。
- 永久数据库、用户账户和个性化反馈学习。

## 3. 晨报栏目顺序

最终晨报顺序为：

1. 今日一句话总结
2. 今日妇产科要闻
3. 指南与共识更新
4. 妇产科手术前沿
5. 国际妇产科动态
6. 国内妇产科动态
7. 研究前沿追踪

新闻栏目每天合计保持 10–15 条。研究前沿追踪每天另外展示 3–5 篇论文，不占用新闻条目额度。

## 4. 架构方案

采用与 DailyBrief 同仓库的原生 TypeScript 子模块，不引入 Python 运行时，也不拆分为独立服务。

建议目录：

```text
config/
  research-interests.json

lib/research/
  types.ts
  config.ts
  normalize.ts
  scoring.ts
  cache.ts
  summarize.ts
  runner.ts
  sources/
    pubmed.ts
    journal-rss.ts

scripts/
  research-dry-run.ts
```

模块职责：

- `types.ts`：定义兴趣方向、论文、评分、缓存和报告字段。
- `config.ts`：加载并校验兴趣方向与期刊源配置。
- `sources/pubmed.ts`：通过 PubMed E-utilities 检索和获取论文元数据。
- `sources/journal-rss.ts`：读取期刊 RSS，并转换为统一论文结构。
- `normalize.ts`：清洗日期、DOI、PMID、题名、作者和摘要。
- `scoring.ts`：执行过滤、评分、主题归属和排序。
- `cache.ts`：完成缓存加载、增量合并、过期清理和原子写入。
- `summarize.ts`：通过 DailyBrief 现有 `runLlm()` 生成中文结构化摘要。
- `runner.ts`：编排完整 Research Intelligence 流程，并输出 `ResearchSection`。
- `research-dry-run.ts`：只完成配置、发现、规范化、去重和评分，不调用 LLM。

## 5. 数据流

每日执行顺序：

1. 加载 `config/research-interests.json`。
2. 加载 `data/research/research-cache.json`。
3. 根据首次运行或上次成功时间计算检索窗口。
4. 分别请求 PubMed 和已启用的期刊 RSS。
5. 将所有结果转换为统一的 `ResearchPaper`。
6. 过滤无摘要、撤稿、勘误、普通新闻和排除词命中条目。
7. 按 PMID、DOI、规范化题名三级去重。
8. 为每篇论文计算所有主题的得分，并确定最高分主题。
9. 应用最低分数、每主题上限和总条目上限。
10. 对最终 3–5 篇论文生成中文结构化摘要。
11. 合并新旧缓存，清理超过 30 天的数据。
12. 将 `ResearchSection` 附加到 DailyBrief 报告对象。
13. 把研究栏目渲染在晨报最后。

Research Intelligence 由 `scripts/daily.ts` 通过 `runResearch()` 调用。该调用必须包裹在独立的错误边界中，不能使新闻管线失败。

## 6. 兴趣方向配置

V1.1 默认配置五个方向：

1. 母胎医学与高危妊娠
2. 妇科肿瘤
3. 生殖医学与生育保存
4. 子宫内膜异位症及良性妇科疾病
5. 微创、机器人与妇产科手术

每个方向包含：

```text
id
name
description
include_keywords
exclude_keywords
publication_types
enabled
```

约束：

- `id` 在配置中全局唯一，仅允许小写字母、数字和连字符。
- 每个启用方向至少包含一个英文检索关键词。
- `include_keywords` 同时用于构造 PubMed 查询和本地相关性评分。
- `exclude_keywords` 命中题名或摘要时直接过滤。
- `publication_types` 为空时接受全部研究类型，再由评分阶段降权。
- 配置无效时 Research Intelligence 停止运行，但新闻晨报继续生成。

## 7. 论文来源与发现

### 7.1 PubMed

PubMed 是 V1.1 的主要来源。每个启用主题生成一个布尔查询，按电子发表日期或 PubMed 最近更新日期获取候选论文。展示日期始终使用论文实际发表日期；检索活动日期只用于增量同步。

首次运行检索最近 7 天。后续运行从 `lastSuccessfulRun` 向前重叠 48 小时开始检索，以覆盖延迟收录和索引更新，重复结果由缓存去重。

### 7.2 核心期刊 RSS

初始目标期刊为：

- American Journal of Obstetrics & Gynecology
- Obstetrics & Gynecology
- BJOG
- Fertility and Sterility
- Human Reproduction
- Gynecologic Oncology
- Journal of Minimally Invasive Gynecology

实施时只启用能通过 `research-dry-run` 稳定返回题名、链接、日期和摘要或内容摘要的 feed。RSS 条目如果缺少有效摘要，不进入每日精选。

### 7.3 去重标识

按以下优先级生成唯一键：

1. PMID
2. 规范化 DOI
3. 规范化题名

同一论文来自多个来源时，优先保留 PubMed 元数据，并补充 RSS 中更完整的期刊链接或发布日期。单篇论文只展示一次，可携带多个相关主题标签，但归入得分最高的主题。

## 8. 相关性与价值评分

评分为 0–100 分，由四部分组成：

- 主题匹配：50 分
- 研究证据等级：25 分
- 临床可操作性：15 分
- 时效性：10 分

### 8.1 主题匹配

根据兴趣方向的关键词计算。题名中的完整短语命中权重高于摘要命中；多个不同关键词命中可以累积，但单个关键词重复出现不重复计分。命中排除词时直接过滤。

### 8.2 研究证据等级

依据 PubMed publication type 和可识别的研究设计赋值：

- 系统评价或 Meta 分析：1.00
- 随机对照试验：0.95
- 其他临床试验：0.85
- 前瞻性队列：0.75
- 诊断或验证研究：0.70
- 队列、病例对照或横断面研究：0.65
- 回顾性研究：0.55
- 可行性研究或病例系列：0.35
- 病例报告：0.20
- 社论、评论、方案文章：0.10
- 无法识别：0.40

撤稿和勘误直接过滤。指南与专家共识由前面的“指南与共识更新”栏目处理，不作为研究论文精选。

### 8.3 临床可操作性

根据研究设计、受试者类型和题名/摘要中的临床内容确定：

- 人体干预、诊断、筛查或患者结局研究：1.00
- 人体观察性结局研究：0.75
- 手术可行性、器械或技术验证：0.50
- 基础、动物或体外研究：0.25
- 无法识别：0.40

### 8.4 时效性

- 活动日期距运行时间不超过 2 天：1.00
- 3–4 天：0.75
- 5–7 天：0.50
- 超过 7 天：不作为当日新增候选，仅可存在于历史缓存。

### 8.5 筛选和排序

- 总分低于 45 分的论文不进入候选。
- 每个主题最多入选 2 篇。
- 每日总数最多 5 篇，少于 3 篇时按实际高质量结果展示，不用低分论文凑数。
- 排序键依次为总分、证据等级、活动日期。
- 页面展示“相关性分数”和“研究设计”，不得把分数命名为临床推荐等级或证据推荐强度。
- LLM 不得改变确定性分数、主题归属或排序。

## 9. 中文结构化摘要

仅对最终入选且具有有效摘要的论文调用 LLM。每篇输出：

```text
title_zh
research_question
study_design
population_and_sample
methods
key_results
limitations
clinical_interpretation
```

提示词约束：

- 只能使用题名、摘要、作者、期刊、publication type 和来源标识。
- 保留摘要中出现的样本量、效应值、置信区间、主要终点和不良事件数字。
- 摘要未报告的信息明确写“摘要未报告”。
- 不推断未公开的方法、亚组结果或因果关系。
- 不把观察性关联改写成因果结论。
- 不把单篇研究改写成临床指南或治疗建议。
- 原文结论存在不确定性时必须保留不确定性。
- 严格输出 JSON，不附带 Markdown 或解释文字。

JSON 解析失败时可使用 DailyBrief 已有 JSON 修复机制重试解析。仍然失败时保留论文元数据，在页面标记“中文摘要生成失败”，并提供 PubMed/DOI 链接，不生成推测性替代摘要。

## 10. 报告数据与页面展示

`ResearchSection` 至少包含：

```text
generatedAt
dataAsOf
isCachedFallback
dailySignal
papers[]
```

每个 `ResearchPaper` 至少包含：

```text
id
pmid
doi
titleOriginal
titleZh
authors
journal
publishedAt
activityAt
abstract
publicationTypes
topicId
topicName
matchedTopicIds
score
scoreBreakdown
studyDesign
researchQuestion
populationAndSample
methods
keyResults
limitations
clinicalInterpretation
paperUrl
firstSeenAt
lastSeenAt
```

“研究前沿追踪”位于晨报最后。栏目顶部显示一句“今日研究信号”，仅概括本栏目入选论文的共同研究趋势。每张论文卡片默认展示：

- 中文标题和英文原题
- 期刊、发布日期和研究设计
- 研究问题
- 主要结果
- 临床意义
- 局限性
- 相关性分数
- PubMed 和 DOI 链接

缓存回退时，栏目顶部必须显示“数据截至 YYYY-MM-DD”，不能把历史论文标记为今日新论文。

## 11. 缓存与增量更新

缓存路径：

```text
data/research/research-cache.json
```

缓存包含：

```text
schemaVersion
lastSuccessfulRun
papers[]
```

规则：

- 本地运行直接读写该文件。
- GitHub Actions 在运行前从专用 Actions cache 恢复文件，成功后保存新 cache。
- 缓存最多保留最近 30 天论文。
- 当前结果与缓存按唯一键合并，保留最早 `firstSeenAt` 并更新 `lastSeenAt`。
- 只有至少一个论文来源成功完成请求时，才能推进 `lastSuccessfulRun`。
- 所有来源失败时保留原缓存，不覆盖为空数据。
- `CLEAR_RESEARCH_CACHE=true` 时忽略旧缓存并按 7 天窗口重新初始化。
- Actions cache 不是永久数据库；历史晨报仍保存当日入选论文，因此清除 cache 不影响已发布的晨报归档。

## 12. 配置项

V1.1 支持以下环境变量：

```text
RESEARCH_ENABLED=true
RESEARCH_LOOKBACK_DAYS=7
MAX_RESEARCH_PAPERS=5
RESEARCH_CACHE_DAYS=30
CLEAR_RESEARCH_CACHE=false
```

`RESEARCH_ENABLED=false` 时完全跳过论文发现、评分和摘要，报告中不渲染研究栏目。

## 13. 错误处理与降级

- 单个来源失败：记录来源、HTTP 状态和错误信息，继续处理其他来源。
- PubMed 与全部 RSS 失败：使用最近缓存，设置 `isCachedFallback=true` 并显示数据日期。
- 全部来源失败且无缓存：研究栏目显示“今日暂无可用研究更新”。
- 单篇论文规范化失败：记录并跳过该条目。
- LLM 单篇失败：保留元数据并标记摘要失败，不影响其他论文。
- Research Intelligence 整体异常：`scripts/daily.ts` 捕获异常，新闻晨报继续生成。
- 缓存写入失败：保留已生成的当日报告，记录错误并以非零研究状态写入日志，但不使整份晨报失败。

日志至少记录：各来源候选数、过滤数、去重数、评分通过数、LLM 成功数、缓存新增/保留/过期数和缓存回退状态。

## 14. 测试策略

### 14.1 单元测试

- 兴趣配置 schema、唯一 ID 和必填字段校验。
- PubMed 查询转义和布尔表达式构造。
- PubMed 与 RSS 数据规范化。
- DOI 规范化。
- PMID、DOI、题名三级去重。
- 主题匹配、证据等级、临床可操作性和时效性分数。
- 排除词、撤稿、勘误和无摘要过滤。
- 每主题最多 2 篇和总数最多 5 篇。
- 缓存增量合并、时间重叠、30 天过期和 clear-cache。
- LLM JSON 解析、修复和缺失字段处理。

### 14.2 集成测试

- 使用固定 PubMed XML/JSON 与 RSS fixture 完成发现到排序流程。
- 使用固定 LLM 响应验证中文摘要映射。
- 模拟单源失败、全源失败、有缓存回退和无缓存回退。
- 验证研究异常不会阻断新闻报告输出。
- 验证 HTML 中研究栏目位于国内妇产科动态之后。

### 14.3 烟测命令

- `npm run research:dry-run`：不调用 LLM，验证配置、来源、去重和评分。
- `npm run daily`：运行完整晨报，验证研究栏目、缓存和 HTML。
- `npm run render [date]`：使用已保存 sidecar 数据重渲染页面，不重新请求论文或调用 LLM。

## 15. 验收标准

- 有足够合格候选时，每日报告展示 3–5 篇论文。
- 同一 PMID 或 DOI 不重复展示。
- 单一主题最多占 2 篇。
- 每篇展示研究设计、主要结果、局限性、临床意义和原文链接。
- 页面分数与 `scoring.ts` 的确定性计算一致。
- 无摘要论文不会产生 LLM 推测性内容。
- 全部论文来源失败时，新闻晨报仍成功生成。
- 使用缓存回退时明确显示数据截止日期。
- 连续两次运行不会重复调用 LLM 总结内容未变化的缓存论文。
- 研究栏目始终位于晨报最后。

## 16. 参考实现边界

参考项目：

- DailyBrief：<https://github.com/leiting-eric/DailyBrief>
- paper-daily：<https://github.com/Futuresxy/paper-daily>

本模块复用的是 paper-daily 的产品和架构思想，包括兴趣配置、自动发现、规则评分、增量更新和缓存。由于参考仓库当前未见明确许可证文件，实施时应在 TypeScript 中独立重写所需行为，不直接复制其 Python 源码。
