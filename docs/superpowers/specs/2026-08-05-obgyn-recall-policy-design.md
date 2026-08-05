# 妇产科晨报召回率与条目级质量策略设计

## 目标

在不降低来源可靠性、不放宽广告、医院宣传、商业内容和非妇产科内容排除规则的前提下，提高妇产科晨报召回率。此次只调整过滤配置、条目级分类、三级语义审核、历史去重、论文筛选参数与空状态文案，不重构现有页面和主数据管线。

## 设计原则

1. 可信度属于来源，展示资格属于具体条目；不得仅凭 `source_id` 将同一机构全部内容统一放行。
2. 广告、赞助、招聘、采购、报名、医院宣传、普通患者科普、无实质内容的会议宣传、非妇产科内容和不可靠来源始终优先拒绝。
3. 扩大检索窗口只增加“尚未展示过”的候选，不重复展示历史条目。
4. 标题-only兜底只适用于一级官方来源的正式文件，且不得生成推测性医学摘要。
5. 现有HTML结构、栏目顺序和主流水线保持不变。

## 配置驱动的来源类别

每个来源配置增加明确的来源类别，不使用来源名称模糊匹配：

- `official_authority`：官方权威机构。
- `academic_journal`：明确白名单中的权威学术期刊。
- `professional_vertical`：专业垂直组织、专业媒体或行业平台。
- `general_authority`：WHO、FDA、EMA等综合权威来源。

中华妇产科期刊必须通过精确的配置项或 `source_id` 进入 `academic_journal` 白名单。首批只包含项目中已经明确配置的期刊来源；妇产科网等专业平台不得因名称相似自动获得期刊级权限。

## 条目级内容分类

每条候选内容携带：

- `documentType`：如 `guideline`、`consensus`、`statement`、`practice_advisory`、`safety_alert`、`research_article`、`news`、`video`、`education`、`unknown`。
- `hasSubstantiveContent`：是否具有可解析摘要、正文片段或足够的结构化描述。
- `reviewStatus`：`accepted`、`uncertain` 或 `rejected`。

分类按以下优先级确定：

1. PubMed publication type、RSS `prism:section`、页面文档类型标签等结构化元数据。
2. 明确标题模式，例如 Guideline、Consensus、Practice Advisory、Committee Statement、Consult Series、Scientific Impact Paper、Good Practice Paper、Position Document、Joint Statement、Quality Indicator、Safety Alert及对应中文正式文件类型。
3. 无法确认时标记为 `unknown`；不得将普通新闻、视频、活动或培训误判为正式文件。

## 内容级权威分层

### 一级官方权威内容

包括：

- ACOG官方指南、临床共识、Practice Advisory、Committee Statement。
- RCOG官方指南、Scientific Impact Paper、Good Practice Paper、正式安全提醒。
- SMFM Consult Series、Clinical Guideline、正式Statement。
- ESGE官方指南、推荐意见、联合声明、Position Document。
- ESGO官方指南、专家共识、质量指标和正式声明。
- AAGL官方指南、正式声明和专业共识。
- FIGO官方指南或正式声明。
- ASRM官方Practice Guidance或Committee Opinion。
- NICE妇产科专题中的正式指南或政策文件。
- 国家卫健委妇幼健康司发布的正式政策或规范文件。

规则：

- 关键词命中或LLM明确判断相关即可进入相关性通道。
- LLM为 `accepted` 时正常展示；`uncertain` 时可低优先级展示；`rejected` 时拒绝。
- 标题-only兜底必须同时具备官方页面、明确发布日期、原始链接和可识别的正式文件类型。
- 标题-only条目使用固定摘要：“原始页面暂未提供可解析摘要，请查看原文了解详细更新。”
- 不得根据标题推测主要变化、临床建议、推荐差异或证据结论。

### 一级权威学术期刊

明确白名单包括项目中配置的AJOG、BJOG、Fertility and Sterility等ASRM专业期刊、GOCM、JMIG以及精确列入配置的中华妇产科期刊。

规则：

- 关键词命中或LLM明确判断相关即可进入相关性通道。
- LLM为 `accepted` 时正常展示；`uncertain` 时可低优先级展示；`rejected` 时拒绝。
- 不开放标题-only展示。条目至少需要摘要、有效excerpt、PubMed结构化元数据或明确文章类型。
- 只有标题时可保留为候选诊断记录，但不能进入主栏目，也不能生成推测性摘要。

### 同一机构的普通内容与专业垂直非一级内容

包括ACOG、RCOG、SMFM、ESGE、ESGO普通新闻，会议、活动、课程、Webinar、普通视频、会员动态，AAGL SurgeryU视频，以及中国妇幼保健协会、专业媒体和行业平台。

规则：

- 关键词命中或LLM明确判断相关，可保留进入审核。
- 必须具有摘要、正文片段或足够结构化描述。
- 只有LLM返回 `accepted` 才展示；`uncertain` 和 `rejected` 均拒绝。
- 禁止标题-only兜底。
- SurgeryU内容标注为教育或技术展示，不得等同于临床指南或高级别证据。

### 综合权威来源

WHO、FDA和EMA属于 `general_authority`。

规则：

- 必须同时命中妇产科关键词并由LLM返回 `accepted`。
- `uncertain`、`rejected` 和标题-only内容全部拒绝。

## 三级LLM审核

LLM返回：

```json
{
  "reviews": [
    {
      "url": "输入原始链接",
      "status": "accepted | uncertain | rejected",
      "summary": "只依据原始内容生成的事实摘要",
      "reason": "简短审核依据"
    }
  ]
}
```

处理规则：

- `accepted`：按来源类别和条目类型正常展示。
- `uncertain`：仅一级官方正式文件和一级权威期刊可低优先级展示。
- `rejected`：全部拒绝，关键词命中不能覆盖明确拒绝。
- 未返回、格式错误或无法解析的单条结果按 `rejected` 处理。
- 候选非空且所有审核批次失败时终止日报发布，防止把故障伪装成空栏目。
- 低优先级条目只降低传入现有排序流程的重要性，不增加新页面样式。

## 时间窗口

- 指南与共识：30天（720小时）。
- 妇产科手术前沿：7天（168小时）。
- 国际妇产科动态：72小时。
- 国内妇产科动态：72小时。
- 研究前沿论文：近7天数据库收录或更新时间。

未来时间戳、无效时间戳仍然拒绝。普通栏目没有发布日期时不得展示；一级官方正式文件标题-only兜底也必须有明确发布日期。

## 历史去重

### 新闻、指南、手术和动态

- 当次运行按canonical URL和normalized title去重。
- 跨日报扫描此前日期的 `*-articles.json`，按canonical URL排除已经展示的条目。
- canonical URL移除锚点和常见跟踪参数。
- 当前日期不计入历史，以允许当天重新生成并覆盖报告。
- 历史排除在LLM审核和栏目数量限制之前执行。

### 论文

- 当次运行和跨日报均按PMID优先、DOI其次、normalized title兜底构建身份键。
- 扫描此前日报JSON中已经展示的Research Intelligence论文，先排除历史身份，再评分和应用栏目配额。
- Actions研究缓存继续承担发现重叠与元数据缓存；公开日报历史是“是否展示过”的持久依据。

## 论文参数

- `lookback_days`: 7。
- `min_score`: 40。
- `max_per_topic`: 3。
- `max_papers`: 5。
- 继续排除更正、撤稿、新闻、研究方案、指南及极低证据等级条目。
- 无摘要或无法形成有效研究元数据的论文仍不进入论文栏目。

## 空状态文案

- 指南与共识：“近30天暂无未展示过的权威指南或共识更新。”
- 妇产科手术前沿：“近7天暂无通过专业筛选的新手术技术进展。”
- 国际、国内妇产科动态：“近72小时暂无通过领域与专业价值筛选的重要更新。”
- 研究前沿论文：“近7天暂无与兴趣方向匹配且达到评分阈值的未展示论文。”

## 错误处理

- 单个来源失败仍记录warning并允许其他来源继续。
- 所有启用新闻来源失败时终止发布。
- 候选非空但所有LLM审核批次失败时终止发布。
- 历史文件损坏只记录warning，不阻断日报；损坏文件不得被当作已展示证据。
- 标题-only兜底只使用固定摘要，不调用LLM补写医学事实。

## 验收与测试

自动化测试必须覆盖：

1. 同一机构正式指南与普通新闻采用不同策略。
2. 一级官方标题-only正式文件在完整元数据下展示固定摘要。
3. 普通新闻、视频和期刊标题-only不能展示。
4. 四类来源的OR/AND过滤关系。
5. `accepted`、`uncertain`、`rejected`三级处理及rejected绝对优先。
6. 30天、7天、72小时和论文7天的精确边界及未来时间拒绝。
7. 新闻canonical URL跨日报去重。
8. 论文PMID、DOI和normalized title跨日报去重。
9. 广告、宣传、报名等硬排除无法被来源等级、关键词或LLM覆盖。
10. 论文40分阈值、每方向3篇、每日最多5篇。
11. 四种新的空状态文案。
12. 页面结构、栏目顺序和研究栏目置底保持不变。

最终验收以召回率改善为目标，但不规定必须填满任何栏目；无符合条件的新条目时仍应显示对应空状态。
