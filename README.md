# 🧬 DailyBrief Research · AI 医学科研晨报系统

**中文**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 20+](https://img.shields.io/badge/node-20%2B-brightgreen.svg)](https://nodejs.org/)
[![Deploy: GitHub Actions](https://img.shields.io/badge/deploy-GitHub%20Actions-2088ff.svg)](#github-actions自动部署)

> 一个面向医学科研人员的 AI 晨报系统。
>
> 自动聚合医学领域新闻、科研论文和前沿进展，通过大语言模型生成结构化中文摘要，帮助研究人员每天快速掌握领域动态。

---

# ✨ 项目特点

## 🔬 医学科研前沿追踪

针对医学研究场景优化：

- PubMed 最新论文自动检索
- 研究兴趣方向自定义
- 关键词智能筛选
- 文献重要性评分
- AI 中文结构化摘要

支持追踪：

- 妇产科
- 母胎医学
- 妇科肿瘤
- 生殖医学
- 妇科内分泌
- 其他医学研究方向


---

## 🤖 AI 智能摘要

支持多种大语言模型：

- DeepSeek
- OpenAI
- Anthropic Claude
- MiniMax
- 智谱等

自动完成：

- 新闻摘要
- 论文摘要
- 研究意义分析
- 临床价值解读


---

## 🌐 自动化每日生成

基于 GitHub Actions：

无需服务器，无需保持电脑运行。

每天自动：


数据获取
↓
论文筛选
↓
AI总结
↓
生成HTML晨报
↓
GitHub Pages发布


每天打开网页即可查看最新科研动态。


---

# 📚 信息来源

目前支持：

## 🧬 医学科研

- PubMed
- 生物医学数据库
- 医学期刊信息

## 🌎 综合信息

- 国际新闻
- 科技动态
- AI领域进展


---

# 🚀 快速部署

## 1. Fork 本项目

点击 GitHub 页面右上角：


Fork


创建自己的仓库。


---

## 2. 配置 Actions 权限

进入：


Settings
→ Actions
→ General
→ Workflow permissions


选择：


Read and write permissions



---

## 3. 配置 LLM

进入：


Settings
→ Secrets and variables
→ Actions



例如 DeepSeek：

### Secret

添加：


DEEPSEEK_API_KEY


填写你的 API Key。


### Variable

添加：


LLM_BACKEND


值：


deepseek



---

## 4. 设置北京时间

Variables 添加：

|变量|值|
|-|-|
|REPORT_TZ|Asia/Shanghai|
|REPORT_HOUR|8|
|REPORT_DAYS|*|


表示每天北京时间：


08:00
自动生成晨报



---

## 5. 手动运行第一次

进入：


Actions
→ Daily Brief Workflow
→ Run workflow


等待生成。


---

# ⚙️ 自定义研究方向

编辑：


config/research-interests.json



例如：

```json
{
"id":"maternal-fetal-medicine",
"name":"母胎医学与高危妊娠",
"include_keywords":[
"preeclampsia",
"gestational diabetes",
"preterm birth"
],
"enabled":true
}

可以根据自己的研究方向添加：

肿瘤
免疫
心血管
神经科学
药理学等。
📁 项目结构
DailyBrief Research

├── config/
│   └── research-interests.json

├── .github/
│   └── workflows/
│       └── daily.yml

├── daily_reports/
│   └── YYYY-MM-DD.html

├── scripts/
│
├── src/
│
└── README.md
🧪 本地运行

安装：

npm ci

配置：

.env.local

测试：

npm run research:dry-run

生成晨报：

npm run daily
🌱 项目定位

DailyBrief Research 旨在成为一个：

面向医学科研人员的个人 AI 科研信息助手。

帮助研究人员减少信息筛选时间，将更多精力投入：

科学问题探索
实验设计
文献阅读
学术创新
🙏 致谢

本项目基于开源项目 DailyBrief 进行二次开发：

https://github.com/leiting-eric/DailyBrief

感谢 Eric 开源了优秀的 AI 每日简报项目，为本项目提供了基础架构和实现基础。

在原项目基础上，本项目主要针对医学科研场景进行了扩展：

增加医学领域研究前沿追踪；
增加 PubMed 文献检索与筛选；
增加研究兴趣方向配置；
增加医学论文中文结构化摘要；
优化科研信息获取流程。

原项目采用 MIT License。

本项目遵循 MIT License，并保留原项目版权声明。

📄 License

MIT License

本项目基于 DailyBrief 修改。

详见：

原项目：
https://github.com/leiting-eric/DailyBrief
LICENSE 文件
