import type { ArticleInput } from "../ai/pipeline";
import {
  classifyObgynContentType,
  classifyDocumentType,
  getObgynContentTypeEvidence,
  hasSubstantiveContent,
  isHardExcluded,
  isOfficialFormalDocument,
} from "./content-policy";
import type { Category, SourceDef } from "./types";

const HOUR_MS = 60 * 60 * 1000;

const WINDOWS_BY_CATEGORY: Record<Category, { priority: number; supplemental: number }> = {
  tech: { priority: 30 * 24, supplemental: 180 * 24 },
  finance: { priority: 14 * 24, supplemental: 90 * 24 },
  politics: { priority: 7 * 24, supplemental: 30 * 24 },
};

const GUIDANCE_TYPES = new Set([
  "guideline",
  "consensus",
  "statement",
  "practice_advisory",
  "quality_indicator",
]);

const SURGERY_CONTENT_TYPES = new Set([
  "surgical_technique",
  "video_article",
  "technical_note",
  "operative_tips",
  "step_by_step_procedure",
  "surgical_review",
  "complication_prevention",
  "surgical_approach",
  "anatomy_for_surgery",
]);

const GUIDANCE_CONTENT_TYPES = new Set([
  "guideline_summary",
  "guideline_update",
  "guideline_interpretation",
  "clinical_practice_recommendation",
  "expert_commentary_on_guideline",
  "practice_bulletin_summary",
]);

const DYNAMICS_CONTENT_TYPES = new Set([
  "society_update",
  "clinical_update",
  "practice_change",
  "quality_improvement",
  "safety_alert",
  "clinical_service_update",
  "policy_update",
  "academic_update",
  "expert_commentary",
  "professional_review",
  "guideline_implementation",
  "substantive_conference_result",
]);

const RECENT_SELECTION_CONTENT_TYPES = new Set([
  ...GUIDANCE_CONTENT_TYPES,
  "video_article",
  "technical_note",
  "operative_tips",
  "step_by_step_procedure",
  "surgical_review",
  "complication_prevention",
  "surgical_approach",
  "anatomy_for_surgery",
  "society_update",
  "clinical_update",
  "practice_change",
  "quality_improvement",
  "clinical_service_update",
  "academic_update",
  "expert_commentary",
  "professional_review",
  "guideline_implementation",
  "substantive_conference_result",
]);

const FORMAL_GUIDANCE_RE = /\b(?:clinical|practice) guideline\b|\bconsensus\b|\bpractice advisory\b|\bcommittee (?:opinion|statement)\b|\bconsult series\b|\bposition statement\b|\bgood practice paper\b|\bscientific impact paper\b|(?:指南|共识|实践公告|委员会意见|委员会声明|立场声明|正式监管建议)/iu;
const SURGICAL_METHOD_RE = /\b(?:surgical technique|video article|technical note|operative technique|step[- ]by[- ]step|instrument(?:ation)?|navigation)\b|(?:手术技术|术式|操作步骤|技术方法|手术器械|手术导航)/iu;
const SURGICAL_TOPIC_RE = /\b(?:laparoscop|hysteroscop|robotic|vnotes|single[- ]port|fertility[- ]sparing|fetal surgery|cerclage|cesarean|caesarean|placenta accreta|gynecologic oncology surgery)\w*\b|(?:腹腔镜|宫腔镜|机器人手术|单孔手术|保留生育功能手术|胎儿手术|宫颈环扎|高危剖宫产|胎盘植入|妇科肿瘤手术)/iu;
const DYNAMICS_RE = /\b(?:society news|clinical service|regulatory update|guideline implementation|patient safety alert|training standard|quality improvement|clinical practice update|professional policy)\b|(?:学会新闻|临床服务|监管更新|指南实施|患者安全提醒|培训规范|质量改进|临床实践更新|妇幼政策|行业标准|母婴安全|助产服务规范|辅助生殖管理|学术活动总结)/iu;
const ORDINARY_RESEARCH_RE = /\b(?:original article|research article|randomi[sz]ed(?: controlled)? trial|clinical trial|cohort study|case-control study|cross-sectional study|retrospective study|prospective study|diagnostic study|validation study|basic research|animal study|cell study|in[- ]vitro|organoid study|case report|case series|study protocol|protocol|systematic review|scoping review|umbrella review|network meta[- ]analysis|meta[- ]analysis)\b|(?:原著|论著|随机对照|临床试验|队列研究|病例对照研究|横断面研究|回顾性研究|前瞻性研究|诊断研究|验证研究|基础研究|动物研究|细胞研究|体外研究|类器官|病例报告|病例系列|研究方案|系统综述|范围综述|伞状综述|荟萃分析|Meta分析)/iu;

export type ObgynRejectionReason =
  | "outside_time_window"
  | "duplicate"
  | "ordinary_research_article"
  | "missing_excerpt"
  | "not_obgyn"
  | "promotional"
  | "source_excluded"
  | "invalid_item"
  | "unsupported_content_type"
  | "llm_rejected";

export interface ObgynFilterRejection {
  title: string;
  sourceId: string;
  reason: ObgynRejectionReason;
}

export interface ObgynFilterStats {
  total: number;
  accepted: number;
  rejected: number;
  promotional: number;
  invalidItem: number;
  sourceExcluded: number;
  outsideTimeWindow: number;
  notObgyn: number;
  unsupportedContentType: number;
  missingContent: number;
  duplicate: number;
}

export interface ObgynFilterResult {
  articles: ArticleInput[];
  priorityArticles: ArticleInput[];
  supplementalArticles: ArticleInput[];
  stats: ObgynFilterStats;
  rejections: ObgynFilterRejection[];
}

type RouteDecision =
  | { kind: "column"; category: Category }
  | { kind: "reject"; reason: "ordinary_research_article" | "unsupported_content_type" };

export const OBGYN_INCLUDE_KEYWORDS = [
  "obstetrics", "obstetric", "gynecology", "gynaecology", "ob/gyn", "pregnancy",
  "maternal", "fetal", "foetal", "placenta", "preeclampsia", "pre-eclampsia",
  "postpartum", "cesarean", "caesarean", "childbirth", "infertility",
  "fertility", "reproductive medicine", "ivf", "embryo", "oocyte", "ovarian",
  "cervical", "endometrial", "uterine", "vulvar", "vaginal", "pelvic floor",
  "endometriosis", "adenomyosis", "fibroid", "gynecologic oncology",
  "gynaecological oncology", "hysteroscopy", "laparoscopy", "robotic surgery",
  "vnotes", "maternal-fetal medicine", "妇产科", "妇幼", "妇科", "产科", "妊娠",
  "孕产妇", "胎儿", "胎盘", "分娩", "生殖医学", "辅助生殖", "不孕",
  "宫颈", "卵巢", "子宫内膜", "妇科肿瘤", "腹腔镜", "宫腔镜",
  "机器人手术", "盆底", "子宫内膜异位症",
];

export const OBGYN_EXCLUDE_KEYWORDS = [
  "career", "job opening", "membership renewal", "fundraising", "sponsor",
  "advertisement", "commercial promotion", "patient testimonial", "医院宣传",
  "科室宣传", "医美", "商业广告", "招聘", "会员续费", "纯活动报名",
  "无专业内容的会议宣传",
];

function includesAny(text: string, keywords: string[]): boolean {
  const normalized = text.toLocaleLowerCase();
  return keywords.some((keyword) => normalized.includes(keyword.toLocaleLowerCase()));
}

export function normalizeContentTitle(title: string): string {
  return title.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function normalizeContentUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_|rss$)/i.test(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url.replace(/#.*$/, "").replace(/\/$/, "");
  }
}

function itemText(article: ArticleInput): string {
  return [article.title, article.excerpt, article.meta, article.contentType]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function hasValidHttpUrl(url: string): boolean {
  try {
    return /^https?:$/.test(new URL(url).protocol);
  } catch {
    return false;
  }
}

function isAllowedAcademicNonResearch(article: ArticleInput, source: SourceDef): boolean {
  if (source.sourceClass !== "academic_journal" || !hasSubstantiveContent(article)) return false;
  const type = getObgynContentTypeEvidence(article);
  if (!type.contentType || !["professional_review", "expert_commentary"].includes(type.contentType)) return false;
  return type.evidence === "declared" || type.evidence === "metadata";
}

function routeDecision(article: ArticleInput, source: SourceDef): RouteDecision {
  const text = itemText(article);
  const typeText = [article.title, article.meta, article.contentType]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  const documentType = classifyDocumentType(article);
  const contentType = classifyObgynContentType(article);

  if (article.documentType && GUIDANCE_TYPES.has(article.documentType)) {
    return { kind: "column", category: "tech" };
  }
  if (documentType === "policy" && isOfficialFormalDocument(article, source)) {
    return { kind: "column", category: "tech" };
  }

  const structuredResearch = article.documentType === "research_article"
    || ORDINARY_RESEARCH_RE.test(typeText);
  if (structuredResearch) {
    return { kind: "reject", reason: "ordinary_research_article" };
  }

  const explicitTechniqueArticle = (contentType && SURGERY_CONTENT_TYPES.has(contentType)) || /\b(?:video article|technical note|surgical technique)\b/i.test(
    article.contentType ?? "",
  ) || /^\s*(?:video article|technical note|surgical technique)\b/i.test(article.title);
  if (explicitTechniqueArticle) {
    return { kind: "column", category: "finance" };
  }

  if (contentType && GUIDANCE_CONTENT_TYPES.has(contentType)) {
    return { kind: "column", category: "tech" };
  }

  if (contentType && DYNAMICS_CONTENT_TYPES.has(contentType)) {
    if (
      source.sourceClass === "academic_journal"
      && ["professional_review", "expert_commentary"].includes(contentType)
      && !isAllowedAcademicNonResearch(article, source)
    ) {
      return { kind: "reject", reason: "unsupported_content_type" };
    }
    return { kind: "column", category: "politics" };
  }

  if (GUIDANCE_TYPES.has(documentType) || FORMAL_GUIDANCE_RE.test(typeText)) {
    return { kind: "column", category: "tech" };
  }

  const surgicalMethod = SURGICAL_METHOD_RE.test(text);
  const surgicalTopic = SURGICAL_TOPIC_RE.test(text);
  if (surgicalMethod || (documentType === "video" && surgicalTopic)) {
    return { kind: "column", category: "finance" };
  }

  if (
    source.id === "pubmed-asrm-guidance"
    && /\b(?:guideline|committee opinion|practice committee)\b/i.test(text)
  ) {
    return { kind: "column", category: "tech" };
  }

  if (
    documentType === "news"
    || documentType === "safety_alert"
    || documentType === "policy"
    || DYNAMICS_RE.test(text)
  ) {
    return { kind: "column", category: "politics" };
  }

  if (source.sourceClass === "academic_journal") {
    if (ORDINARY_RESEARCH_RE.test(text)) {
      return { kind: "reject", reason: "ordinary_research_article" };
    }
    return { kind: "reject", reason: "ordinary_research_article" };
  }

  if (["video", "education"].includes(documentType) && !surgicalTopic) {
    return { kind: "reject", reason: "unsupported_content_type" };
  }

  return { kind: "column", category: source.category };
}

function withCategory(article: ArticleInput, category: Category): ArticleInput {
  return article.category === category ? article : { ...article, category };
}

export function routeObgynArticles(
  articles: ArticleInput[],
  sources: SourceDef[],
): ArticleInput[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const routed: ArticleInput[] = [];
  for (const article of articles) {
    const source = sourceById.get(article.sourceId);
    if (!source) continue;
    const decision = routeDecision(article, source);
    if (decision.kind === "column") routed.push(withCategory(article, decision.category));
  }
  return routed;
}

function markSupplemental(article: ArticleInput): ArticleInput {
  const current = article.meta?.trim();
  if (current?.startsWith("近期精选")) return article;
  return { ...article, meta: current ? `近期精选 · ${current}` : "近期精选" };
}

function markSecondaryProfessionalContent(article: ArticleInput): ArticleInput {
  const contentType = classifyObgynContentType(article);
  return contentType && RECENT_SELECTION_CONTENT_TYPES.has(contentType)
    ? markSupplemental(article)
    : article;
}

function selectionColumn(article: ArticleInput, sourceById: Map<string, SourceDef>): string {
  if (article.category !== "politics") return article.category;
  const source = sourceById.get(article.sourceId);
  return source?.subcategory === "china-obgyn" || source?.lang === "zh"
    ? "china-obgyn"
    : "international-obgyn";
}

function professionalValueScore(article: ArticleInput, sourceById: Map<string, SourceDef>): number {
  const source = sourceById.get(article.sourceId);
  const contentType = classifyObgynContentType(article);
  const documentType = classifyDocumentType(article);
  let score = source?.sourceClass === "official_authority" ? 40
    : source?.sourceClass === "academic_journal" ? 30
      : source?.sourceClass === "professional_vertical" ? 20
        : 10;
  if (GUIDANCE_TYPES.has(documentType)) score += 60;
  else if (contentType && GUIDANCE_CONTENT_TYPES.has(contentType)) score += 50;
  else if (contentType === "safety_alert" || contentType === "practice_change") score += 45;
  else if (contentType && SURGERY_CONTENT_TYPES.has(contentType)) score += 40;
  else if (contentType && DYNAMICS_CONTENT_TYPES.has(contentType)) score += 30;
  return score;
}

function rankSupplemental(
  articles: ArticleInput[],
  sourceById: Map<string, SourceDef>,
): ArticleInput[] {
  return [...articles].sort((a, b) => {
    const scoreDiff = professionalValueScore(b, sourceById) - professionalValueScore(a, sourceById);
    if (scoreDiff !== 0) return scoreDiff;
    return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  });
}

export function selectSupplementalObgynArticles(
  priority: ArticleInput[],
  supplemental: ArticleInput[],
  minimum = 10,
  maximum = 15,
  sources: SourceDef[] = [],
): ArticleInput[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const rankedPriority = rankSupplemental(priority, sourceById)
    .slice(0, maximum)
    .map(markSecondaryProfessionalContent);
  if (rankedPriority.length >= minimum) return rankedPriority;

  const rankedSupplemental = rankSupplemental(supplemental, sourceById);
  const selectedSupplemental: ArticleInput[] = [];
  const selectedUrls = new Set<string>();
  const representedColumns = new Set(rankedPriority.map((article) => selectionColumn(article, sourceById)));

  for (const article of rankedSupplemental) {
    const column = selectionColumn(article, sourceById);
    if (representedColumns.has(column)) continue;
    selectedSupplemental.push(article);
    selectedUrls.add(normalizeContentUrl(article.url));
    representedColumns.add(column);
    if (rankedPriority.length + selectedSupplemental.length >= maximum) break;
  }

  for (const article of rankedSupplemental) {
    if (rankedPriority.length + selectedSupplemental.length >= maximum) break;
    const url = normalizeContentUrl(article.url);
    if (selectedUrls.has(url)) continue;
    selectedSupplemental.push(article);
    selectedUrls.add(url);
  }

  return [...rankedPriority, ...selectedSupplemental.map(markSupplemental)];
}

export function findLlmRejectedObgynArticles(
  reviewed: ArticleInput[],
  accepted: ArticleInput[],
): ObgynFilterRejection[] {
  const acceptedUrls = new Set(accepted.map((article) => normalizeContentUrl(article.url)));
  return reviewed
    .filter((article) => !acceptedUrls.has(normalizeContentUrl(article.url)))
    .map((article) => ({
      title: article.title,
      sourceId: article.sourceId,
      reason: "llm_rejected",
    }));
}

function emptyStats(total: number): ObgynFilterStats {
  return {
    total,
    accepted: 0,
    rejected: 0,
    promotional: 0,
    invalidItem: 0,
    sourceExcluded: 0,
    outsideTimeWindow: 0,
    notObgyn: 0,
    unsupportedContentType: 0,
    missingContent: 0,
    duplicate: 0,
  };
}

export function filterObgynCandidatesWithStats(
  articles: ArticleInput[],
  sources: SourceDef[],
  now = new Date(),
): ObgynFilterResult {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const priorityArticles: ArticleInput[] = [];
  const supplementalArticles: ArticleInput[] = [];
  const rejections: ObgynFilterRejection[] = [];
  const stats = emptyStats(articles.length);

  const reject = (
    article: ArticleInput,
    reason: ObgynRejectionReason,
    field: keyof Pick<ObgynFilterStats,
      "promotional" | "invalidItem" | "sourceExcluded" | "outsideTimeWindow"
      | "notObgyn" | "unsupportedContentType" | "missingContent" | "duplicate">,
  ) => {
    stats[field] += 1;
    rejections.push({ title: article.title, sourceId: article.sourceId, reason });
  };

  for (const article of articles) {
    if (!article.title.trim() || !hasValidHttpUrl(article.url)) {
      reject(article, "invalid_item", "invalidItem");
      continue;
    }
    if (isHardExcluded(article) || includesAny(itemText(article), OBGYN_EXCLUDE_KEYWORDS)) {
      reject(article, "promotional", "promotional");
      continue;
    }

    const source = sourceById.get(article.sourceId);
    if (!source || !article.publishedAt || Number.isNaN(article.publishedAt.getTime())) {
      reject(article, "invalid_item", "invalidItem");
      continue;
    }
    if (includesAny(itemText(article), source.excludeKeywords ?? [])) {
      reject(article, "source_excluded", "sourceExcluded");
      continue;
    }

    const route = routeDecision(article, source);
    if (route.kind === "reject") {
      reject(article, route.reason, "unsupportedContentType");
      continue;
    }

    const age = now.getTime() - article.publishedAt.getTime();
    const windows = WINDOWS_BY_CATEGORY[route.category];
    if (age < 0 || age > windows.supplemental * HOUR_MS) {
      reject(article, "outside_time_window", "outsideTimeWindow");
      continue;
    }

    const text = itemText(article);
    const substantive = hasSubstantiveContent(article);
    const officialFormal = isOfficialFormalDocument(article, source);
    if (!substantive && !officialFormal) {
      reject(article, "missing_excerpt", "missingContent");
      continue;
    }

    const hasDomainAnchor = includesAny(text, OBGYN_INCLUDE_KEYWORDS);
    const sourceKeywords = source.keywords ?? [];
    const matchesSourceRule = sourceKeywords.length > 0 && includesAny(text, sourceKeywords);
    if (source.sourceClass === "general_authority" && (!hasDomainAnchor || !matchesSourceRule)) {
      reject(article, "not_obgyn", "notObgyn");
      continue;
    }

    const urlKey = normalizeContentUrl(article.url);
    const titleKey = normalizeContentTitle(article.title);
    if (!urlKey || !titleKey || seenUrls.has(urlKey) || seenTitles.has(titleKey)) {
      reject(article, "duplicate", "duplicate");
      continue;
    }
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);

    const routed = withCategory(article, route.category);
    if (age <= windows.priority * HOUR_MS) priorityArticles.push(routed);
    else supplementalArticles.push(routed);
  }

  const accepted = [...priorityArticles, ...supplementalArticles];
  stats.accepted = accepted.length;
  stats.rejected = stats.total - stats.accepted;
  return {
    articles: accepted,
    priorityArticles,
    supplementalArticles,
    stats,
    rejections,
  };
}

export function filterObgynCandidates(
  articles: ArticleInput[],
  sources: SourceDef[],
  now = new Date(),
): ArticleInput[] {
  return filterObgynCandidatesWithStats(articles, sources, now).articles;
}
