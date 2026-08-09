import { jsonrepair } from "jsonrepair";
import { runLlm } from "./llm";
import { extractJson } from "./json-util";
import { SYSTEM_PROMPT_DIGEST_EN, SYSTEM_PROMPT_DIGEST_ZH } from "./prompts";
import { REPORT_LOCALE } from "../sources/registry";
import type { Category, RawArticle } from "../sources/types";
import type { ResearchSection } from "../research/types";

const SYSTEM_PROMPT_DIGEST =
  REPORT_LOCALE === "en" ? SYSTEM_PROMPT_DIGEST_EN : SYSTEM_PROMPT_DIGEST_ZH;

export interface BriefItem {
  title: string;
  url: string;
  source: string;
  summary: string;
  importance: number;
}

export interface DailyReport {
  hero_headline: string;
  daily_overview: string;
  tech_briefs: BriefItem[];
  finance_briefs: BriefItem[];
  politics_briefs: BriefItem[];
  editor_note: string;
  keywords: string[];
  /** Optional trading-signals section, present when scripts/daily.ts ran successfully. */
  trading?: TradingSection;
  /** Optional research-frontier section; renderers always place it last. */
  research?: ResearchSection;
}

import type { TickerAnalysis } from "../trading/signals";
import type { CryptoGlobalStats } from "../trading/coingecko";
import type { FearGreedSnapshot } from "../trading/fear-greed";
import type { TradingCommentary } from "./trading-commentary";

export interface TradingSection extends TradingCommentary {
  generated_at: string;
  tickers: TickerAnalysis[];
  crypto_fear_greed?: FearGreedSnapshot;
  crypto_global?: CryptoGlobalStats;
}

export interface ArticleInput extends RawArticle {
  source: string;
}

const PER_CATEGORY_LIMIT: Record<Category, number> = {
  tech: 25,
  finance: 20,
  politics: 15,
};

const EMPTY_SECTION_ZH = "过去24小时暂无符合质量要求的重要更新。";

export function createEmptyDailyReport(): DailyReport {
  const empty = REPORT_LOCALE === "en"
    ? "No important update met the quality threshold in the past 24 hours."
    : EMPTY_SECTION_ZH;
  return {
    hero_headline: empty,
    daily_overview: empty,
    tech_briefs: [],
    finance_briefs: [],
    politics_briefs: [],
    editor_note: empty,
    keywords: [],
  };
}

/**
 * Pick `limit` items from `items` so every source gets a fair shot.
 *
 * Why this exists: the previous `slice(0, limit)` honored insertion order,
 * which is the source-iteration order in daily.ts. That gave whichever
 * source came first 100% of the quota — e.g. all 25 tech slots filled by
 * Hacker News before GitHub Trending / Solidot / V2EX / 阮一峰 got a turn.
 *
 * Strategy: group items by sourceId,
 * sort each bucket newest-first, then round-robin one item per source
 * until we hit the limit. Sources with fewer items naturally drop out
 * and others absorb the slack.
 */
function selectRoundRobin(
  items: ArticleInput[],
  limit: number,
): ArticleInput[] {
  const fresh = items;

  const bySource = new Map<string, ArticleInput[]>();
  for (const it of fresh) {
    const arr = bySource.get(it.sourceId) ?? [];
    arr.push(it);
    bySource.set(it.sourceId, arr);
  }
  for (const arr of bySource.values()) {
    arr.sort(
      (a, b) =>
        (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    );
  }

  const buckets = Array.from(bySource.values());
  const out: ArticleInput[] = [];
  let madeProgress = true;
  while (out.length < limit && madeProgress) {
    madeProgress = false;
    for (const b of buckets) {
      if (b.length === 0) continue;
      out.push(b.shift()!);
      madeProgress = true;
      if (out.length >= limit) break;
    }
  }
  return out;
}

async function callOnce(userPayloadJson: string): Promise<unknown> {
  // Claude Code CLI's built-in system prompt biases the model toward
  // conversational markdown output. Anchor the format expectation in the
  // user message (instruction recency wins) *and* explicitly demand every
  // schema field be populated — without this Sonnet has been observed to
  // emit a JSON shell with empty arrays to "satisfy" a JSON-only ask.
  const userPrompt =
    REPORT_LOCALE === "en"
      ? [
          "**Output language: ENGLISH ONLY.** Every string value in the JSON — hero_headline, daily_overview, every brief's title/summary, editor_note, keywords — must be written entirely in English. No Chinese characters anywhere.",
          "",
          "Generate today's OB-GYN professional brief. The response MUST be a single valid JSON object — starts with `{`, ends with `}`, no markdown, no code fences, no explanations.",
          "",
          "The JSON must contain every field; brief arrays may be empty when no item qualifies:",
          "  - hero_headline: most important OB-GYN signal",
          "  - daily_overview: concise overview of clinical guidance, surgery, and professional updates",
          "  - tech_briefs: up to 4 guideline/consensus BriefItems",
          "  - finance_briefs: up to 4 gynecologic-surgery BriefItems",
          "  - politics_briefs: up to 10 international/China OB-GYN BriefItems",
          "  - editor_note: 30-60 word editor's note",
          "  - keywords: 5-8 keywords",
          "",
          "BriefItem fields: title, url (copied verbatim from candidate), source, summary, importance (1-10).",
          "**Quote rule (important!)**: For any quotation INSIDE a JSON string, use single quotes ' or curly quotes '\" — **never** raw double quotes \", which break JSON parsing.",
          "No trailing commas.",
          "",
          `Candidate news (JSON array, ${userPayloadJson.length} chars):`,
          userPayloadJson,
        ].join("\n")
      : [
          "你的任务：根据下方候选内容生成妇产科医学晨报，**响应必须是一个合法 JSON 对象**——以 `{` 开头，以 `}` 结尾，不要 markdown / 不要代码围栏 / 不要任何解释。",
          "",
          "JSON 必须包含全部字段；没有合格内容时 briefs 数组必须返回 []，不得使用无关内容补齐：",
          "  - hero_headline: 当天最重要的妇产科专业信号",
          "  - daily_overview: 凝练概括指南、手术及国内外妇产科动态",
          "  - tech_briefs: 最多4条指南与共识 BriefItem",
          "  - finance_briefs: 最多4条妇产科手术前沿 BriefItem",
          "  - politics_briefs: 最多10条国际与国内妇产科动态 BriefItem",
          "  - editor_note: 30-60 字的编辑短评",
          "  - keywords: 5-8 个关键词",
          "",
          "BriefItem 字段：title、url（必须从候选条目原样选取）、source、summary、importance(1-10)。",
          "**引号规则（重要！）**：JSON 字符串内的中文引用请使用**中文全角引号**「」或者 “”，**绝对不要**用英文双引号 \" —— 那会导致 JSON 解析失败。例：写 商务部回应「内卷」 而不是 商务部回应\"内卷\"。",
          "不要使用单引号、不要末尾多余逗号。",
          "",
          "候选新闻（JSON 数组，共 " + userPayloadJson.length + " 字符）：",
          userPayloadJson,
        ].join("\n");
  const { text } = await runLlm({
    systemPrompt: SYSTEM_PROMPT_DIGEST,
    userPrompt,
  });
  const cleaned = extractJson(text);
  let parsed: Partial<DailyReport>;
  try {
    parsed = JSON.parse(cleaned) as Partial<DailyReport>;
  } catch (strictErr) {
    // LLMs routinely emit JSON with unescaped quotes inside Chinese
    // strings (e.g. 商务部回应"内卷"). jsonrepair fixes most of these
    // mechanically before we ever surface a failure.
    try {
      const repaired = jsonrepair(cleaned);
      parsed = JSON.parse(repaired) as Partial<DailyReport>;
      console.warn("[pipeline] JSON.parse failed but jsonrepair recovered");
    } catch {
      try {
        const fs = await import("node:fs");
        fs.mkdirSync("logs", { recursive: true });
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        fs.writeFileSync(`logs/claude-raw-${ts}.txt`, text, "utf8");
        fs.writeFileSync(`logs/claude-cleaned-${ts}.txt`, cleaned, "utf8");
        console.warn(
          `[pipeline] both JSON.parse and jsonrepair failed; raw at logs/claude-raw-${ts}.txt`,
        );
      } catch {
        // best-effort logging
      }
      throw strictErr;
    }
  }
  return parsed;
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function sanitizeDigestReport(raw: unknown, articles: ArticleInput[]): DailyReport {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const candidates = new Map(articles.map((article) => [article.url, article]));
  const seen = new Set<string>();
  const sanitizeBriefs = (
    value: unknown,
    category: Category,
    limit: number,
  ): BriefItem[] => {
    if (!Array.isArray(value)) return [];
    const result: BriefItem[] = [];
    for (const rawItem of value) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as Record<string, unknown>;
      const url = stringField(item.url);
      const candidate = candidates.get(url);
      if (!candidate || candidate.category !== category || seen.has(url)) continue;
      const summary = stringField(item.summary) || candidate.summary || "";
      if (!summary) continue;
      const numericImportance = typeof item.importance === "number" && Number.isFinite(item.importance)
        ? item.importance
        : 5;
      const importance = Math.max(1, Math.min(10, Math.round(numericImportance)));
      result.push({
        title: candidate.title,
        url: candidate.url,
        source: candidate.source,
        summary,
        importance: candidate.lowPriority ? Math.min(5, importance) : importance,
      });
      seen.add(url);
      if (result.length >= limit) break;
    }
    return result;
  };

  const tech = sanitizeBriefs(record.tech_briefs, "tech", 4);
  const finance = sanitizeBriefs(record.finance_briefs, "finance", 4);
  const politics = sanitizeBriefs(record.politics_briefs, "politics", 10);
  const sections: Array<[BriefItem[], Category, number]> = [[tech, "tech", 4], [finance, "finance", 4], [politics, "politics", 10]];
  // Deterministically restore accepted candidates omitted by the LLM. Only use
  // existing reviewed summaries; never fabricate URLs, categories, or text.
  for (const [result, category] of sections) {
    for (const candidate of articles) {
      if (seen.has(candidate.url) || candidate.category !== category || candidate.reviewStatus !== "accepted") continue;
      const summary = candidate.summary?.trim() || "";
      if (!summary) continue;
      result.push({ title: candidate.title, url: candidate.url, source: candidate.source, summary, importance: candidate.lowPriority ? 5 : 5 });
      seen.add(candidate.url);
      if (tech.length + finance.length + politics.length >= 15) break;
    }
    if (tech.length + finance.length + politics.length >= 15) break;
  }
  return {
    hero_headline: stringField(record.hero_headline),
    daily_overview: stringField(record.daily_overview),
    tech_briefs: tech,
    finance_briefs: finance,
    politics_briefs: politics,
    editor_note: stringField(record.editor_note),
    keywords: Array.isArray(record.keywords)
      ? record.keywords.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean).slice(0, 8)
      : [],
  };
}

export async function generateDailyReport(
  articles: ArticleInput[],
): Promise<{ report: DailyReport; tokensUsed: number }> {
  if (articles.length === 0) return { report: createEmptyDailyReport(), tokensUsed: 0 };
  const grouped: Record<Category, ArticleInput[]> = {
    tech: [],
    finance: [],
    politics: [],
  };
  for (const a of articles) grouped[a.category].push(a);

  const compact = (Object.keys(grouped) as Category[]).flatMap((c) =>
    selectRoundRobin(grouped[c], PER_CATEGORY_LIMIT[c]),
  );

  const userPayload = compact.map((a, i) => ({
    n: i + 1,
    title: a.title,
    url: a.url,
    source: a.source,
    category: a.category,
    excerpt: (a.excerpt ?? "").slice(0, 200),
    published: a.publishedAt?.toISOString() ?? "",
  }));
  const userPayloadJson = JSON.stringify(userPayload);

  let rawReport: unknown;
  try {
    rawReport = await callOnce(userPayloadJson);
  } catch (firstErr) {
    // One retry — claude CLI occasionally wraps in narration on the first
    // pass but obeys when the same prompt is repeated.
    console.warn(
      `[pipeline] first claude CLI call failed, retrying: ${
        firstErr instanceof Error ? firstErr.message : String(firstErr)
      }`,
    );
    rawReport = await callOnce(userPayloadJson);
  }
  const report = sanitizeDigestReport(rawReport, compact);

  // Max subscription has no per-call token meter — we expose 0 for schema
  // compatibility; consumers should treat 0 as "metric not available".
  return { report, tokensUsed: 0 };
}
