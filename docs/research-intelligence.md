# Research Intelligence 运维指南

Research Intelligence 是妇产科晨报的论文追踪子模块。它与新闻抓取并行运行，先用确定性规则完成检索、去重、评分和排序，再仅对最终入选论文调用现有 LLM 后端生成结构化解读。“研究前沿追踪”固定显示在晨报最后。

## 快速开始

```bash
npm run research:dry-run
npm run daily
```

`research:dry-run` 不调用 LLM、不写 `data/research/research-cache.json`，适合调整关键词和检查来源。`daily` 会写入缓存，并把最终论文完整保存在当日 `<date>.json` 中，因此以后执行 `npm run render [date]` 不会重新检索或总结论文。

## 兴趣方向配置

唯一配置入口是 `config/research-interests.json`。新闻源仍只由根目录 `sources.config.json` 管理；不要把两个注册表混用。

每个主题包含：

| 字段 | 说明 |
|---|---|
| `id` | 稳定且唯一的英文标识 |
| `name` | 晨报显示名称 |
| `description` | 方向说明 |
| `include_keywords` | PubMed 召回和本地相关性匹配关键词；至少一个 |
| `exclude_keywords` | 命中即从该主题排除 |
| `publication_types` | 该方向偏好的 PubMed 研究类型 |
| `enabled` | 是否启用该方向 |

根级 `domain_keywords` 是妇产科领域锚点。论文必须同时命中某个兴趣词和至少一个领域锚点，避免“排除标准中偶然出现妊娠术语”或一般外科研究造成误匹配。该列表也会加入 PubMed 查询以减少无关召回。

默认 5 个方向为母胎医学与高危妊娠、妇科肿瘤、生殖医学与生育保存、子宫内膜异位症及良性妇科疾病、微创/机器人与妇产科手术。

关键词建议使用 PubMed 题名和摘要中常见的英文短语。新增宽泛词后务必运行 dry-run，观察候选数量、主题归属和淘汰情况；如果噪声上升，优先增加排除词，不要降低 45 分阈值来凑数量。

## 检索与去重

- 首次运行回看最近 7 天。
- 后续运行从上次成功时间向前重叠 48 小时，避免索引延迟或定时任务错过论文。
- PubMed 是默认启用的主来源；期刊 RSS 只有确认可稳定返回题名、链接、日期和有效摘要后才应开启。
- 日常候选必须有有效摘要；指南、共识、撤稿、更正和普通新闻由本地规则过滤。
- 去重键依次为 PMID、规范化 DOI、规范化题名。PubMed 元数据优先，RSS 只补充缺失信息和来源痕迹。

2026-08-05 实测启用的 RSS 为 AJOG、BJOG、Fertility and Sterility 和 JMIG。Obstetrics & Gynecology 返回 403，Human Reproduction 配置地址返回 404，Gynecologic Oncology 在 30 天探测窗口内无有效新条目，因此继续关闭。外部 feed 状态可能变化，启用前应重新 dry-run 验证。

## 评分与入选

总分为 0–100：

```text
总分 = 主题相关性（0–50）
     + 证据等级权重 × 25
     + 临床可操作性权重 × 15
     + 新近性权重 × 10
```

主要证据权重：系统综述/Meta 1.00、RCT 0.95、其他临床试验 0.85、前瞻性队列 0.75、诊断/验证 0.70、一般观察研究 0.65、回顾性研究 0.55、可行性/病例系列 0.35、病例报告 0.20、社论/评论/方案 0.10、无法分类 0.40。

新近性按活动日期分为：2 天内 1.00、3–4 天 0.75、5–7 天 0.50，超过 7 天不进入当日新论文。最终只保留 `score >= 45`，每个主题最多 2 篇、全局最多 5 篇。少于 3 篇时直接少展示，不以低质量论文补位。

研究方案、社论和评论虽然有明确定义的证据权重，但不会进入每日最终栏目；它们不应占用有限的 5 篇名额。

LLM 不能修改分数、排序或主题归属。

## 中文结构化解读

LLM 只接收论文 id、题名、摘要、作者、期刊、日期和 publication types。输出字段包括中文题名、研究问题、研究设计、研究对象与样本、方法、关键结果、局限性和临床解读。

提示词要求保留精确数值，不补写全文信息，不把观察性关联改成因果结论，也不把单篇论文写成指南。摘要没有报告的信息显示“摘要未报告”。JSON 无法解析或 id 对不上时，晨报保留论文元数据并显示“中文摘要生成失败”。

## 缓存

本地缓存位于 `data/research/research-cache.json`，默认保留 30 天并被 Git 忽略。写入采用同目录临时文件和原子替换。损坏缓存会被重命名为 `.corrupt-<timestamp>` 后从空缓存恢复。

只要至少一个研究源成功，`lastSuccessfulRun` 才会推进。全部研究源失败时：

1. 新闻晨报继续生成；
2. 仍在有效窗口内的缓存论文继续显示；
3. 栏目标记“缓存数据”和数据截至时间；
4. 无可用缓存时显示明确空态。

已成功摘要的论文保存输入指纹；题名、摘要或关键元数据不变时不会重复调用 LLM。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---:|---|
| `RESEARCH_ENABLED` | `true` | 总开关 |
| `RESEARCH_LOOKBACK_DAYS` | `7` | 首次回看天数，范围 1–30 |
| `MAX_RESEARCH_PAPERS` | `5` | 最终篇数，范围 1–20 |
| `RESEARCH_CACHE_DAYS` | `30` | 缓存保留天数，范围 1–365 |
| `CLEAR_RESEARCH_CACHE` | `false` | 本次运行忽略已有缓存 |
| `NCBI_API_KEY` | 空 | 可选，提高 PubMed 请求额度 |
| `NCBI_EMAIL` | 空 | 可选，向 NCBI 标识调用者 |

## GitHub Actions

workflow 使用 `actions/cache@v4` 保存研究缓存。可在仓库 Settings → Secrets and variables → Actions 中配置上述变量；`NCBI_API_KEY` 放 Secrets，其余非敏感值放 Variables。缓存 key 含 `run_id`，每次运行创建新 immutable cache，并通过 branch 前缀恢复最近一次成功缓存。

## 故障排查

- PubMed 全部失败：运行 `npm run research:dry-run` 查看 HTTP 状态；检查网络、代理和 NCBI 服务状态。
- 候选为 0：查看 dry-run 的 fetched/deduped/selected；检查日期窗口、关键词、排除词和摘要是否存在。
- RSS 为 0：许多期刊 feed 只有目录或短描述，未达到有效摘要要求时应保持禁用。
- 重复论文：记录 PMID、DOI 和题名，补充 fixture 与 `normalize.test.ts` 回归测试后再修改归一化规则。
- 中文摘要失败：检查 LLM 凭证和 `logs/llm-calls.jsonl`；原始论文链接仍会保留。
- 需要强制重建：临时设置 `CLEAR_RESEARCH_CACHE=true` 运行一次，确认后恢复 `false`。

## 医学使用边界

本栏目用于研究发现和专业信息整理，不构成诊疗建议、指南推荐或患者个体化决策依据。论文可能存在偏倚、统计不确定性、尚未复现的结论或与本地人群不一致的适用范围；临床应用前应阅读原文、核对正式指南并结合患者具体情况。
