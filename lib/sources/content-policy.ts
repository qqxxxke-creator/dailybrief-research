import type { ContentTypeEvidence, DocumentType, RawArticle, SourceDef } from "./types";

const DOCUMENT_TYPES = new Set<DocumentType>([
  "guideline", "consensus", "statement", "practice_advisory", "safety_alert", "quality_indicator",
  "research_article", "news", "video", "education", "policy", "unknown",
]);

const FORMAL_DOCUMENT_TYPES = new Set<DocumentType>([
  "guideline", "consensus", "statement", "practice_advisory", "safety_alert", "quality_indicator", "policy",
]);

const HARD_NON_FORMAL_CONTENT_PATTERNS = [
  /\b(?:advertisement|advertising|advert|commercial promotion|sponsor(?:ed|ship)?)\b/i,
  /\b(?:career|careers|job opening|hiring|recruit(?:ment|ing)?)\b/i,
  /\b(?:procurement|purchasing|tender|bid)\b/i,
  /\b(?:registration|register|sign[- ]?up)\b/i,
  /\bpatient (?:education|information)\b/i,
  /\b(?:hospital|clinic|department)\s+(?:promotion|publicity)\b|(?:广告|赞助|招聘|招募|采购|报名|患者科普|患者教育|病人科普|病人教育|医院宣传|科室宣传|无实质(?:内容|活动))|\bno substantive (?:content|activity)\b/i,
];
const HARD_EDUCATION_CONTENT_PATTERN = /\b(?:registration|register|sign[- ]?up|patient (?:education|information)|course|training|workshop)\b|(?:报名|患者科普|患者教育|病人科普|病人教育)/i;
const HARD_VIDEO_CONTENT_PATTERN = /\b(?:webinar|video|podcast|recording)\b/i;

const FORMAL_TITLE_PATTERNS: Array<[DocumentType, RegExp]> = [
  ["practice_advisory", /\bpractice advisory\b/i],
  ["safety_alert", /\b(?:patient )?safety alert(?:s)?\b/i],
  ["consensus", /\b(?:clinical |obstetric care )?consensus(?: statement)?\b/i],
  ["guideline", /\b(?:clinical |practice |green-top )?guideline(?:s)?\b/i],
  ["guideline", /\b(?:consult series|scientific impact paper|good practice paper)\b/i],
  ["statement", /\b(?:committee|joint|position|special)?\s*statement\b/i],
  ["statement", /\b(?:committee opinion|position document)\b/i],
  ["quality_indicator", /\bquality indicators?\b/i],
  ["policy", /\bpolicy(?: document)?\b/i],
  ["practice_advisory", /(?:临床)?实践公告/u],
  ["safety_alert", /(?:安全提醒|安全警示)/u],
  ["consensus", /(?:专家|临床)?共识/u],
  ["guideline", /(?:临床|诊疗|实践|技术)?指南|推荐(?:意见|建议)/u],
  ["statement", /(?:正式|联合|立场)?声明|立场文件/u],
  ["quality_indicator", /(?:质量指标|质量评价指标)/u],
  ["policy", /(?:政策文件|管理规范|技术规范|临床规范|诊疗规范|工作规范|规范性文件)/u],
];

const EDUCATION_TITLE_PATTERN = /\b(?:registration|course|training|workshop|education|learning)\b/i;
const VIDEO_TITLE_PATTERN = /\b(?:video|webinar|podcast|recording)\b/i;
const NEWS_TITLE_PATTERN = /\b(?:news|news release|press release|announcement|update)\b/i;

export type ObgynContentType =
  | "guideline_summary"
  | "guideline_update"
  | "guideline_interpretation"
  | "clinical_practice_recommendation"
  | "expert_commentary_on_guideline"
  | "practice_bulletin_summary"
  | "surgical_technique"
  | "video_article"
  | "technical_note"
  | "operative_tips"
  | "step_by_step_procedure"
  | "surgical_review"
  | "complication_prevention"
  | "surgical_approach"
  | "anatomy_for_surgery"
  | "society_update"
  | "clinical_update"
  | "practice_change"
  | "quality_improvement"
  | "safety_alert"
  | "clinical_service_update"
  | "policy_update"
  | "academic_update"
  | "expert_commentary"
  | "professional_review"
  | "guideline_implementation"
  | "substantive_conference_result";

const OBGYN_CONTENT_TYPES = new Set<ObgynContentType>([
  "guideline_summary", "guideline_update", "guideline_interpretation",
  "clinical_practice_recommendation", "expert_commentary_on_guideline", "practice_bulletin_summary",
  "surgical_technique", "video_article", "technical_note",
  "operative_tips", "step_by_step_procedure", "surgical_review", "complication_prevention",
  "surgical_approach", "anatomy_for_surgery",
  "society_update", "clinical_update", "practice_change", "quality_improvement", "safety_alert",
  "clinical_service_update", "policy_update", "academic_update", "expert_commentary",
  "professional_review", "guideline_implementation", "substantive_conference_result",
]);

const CONTENT_TYPE_PATTERNS: Array<[ObgynContentType, RegExp]> = [
  ["expert_commentary_on_guideline", /\bexpert commentary on (?:a )?guideline\b|指南专家解读/iu],
  ["practice_bulletin_summary", /\bpractice bulletin summary\b|实践公告解读/iu],
  ["guideline_interpretation", /\bguideline interpretation\b|指南解读|共识解读/iu],
  ["guideline_summary", /\bguideline summary\b|指南摘要/iu],
  ["guideline_update", /\bguideline update\b|指南更新/iu],
  ["clinical_practice_recommendation", /\bclinical practice recommendation\b|诊疗规范|临床路径|临床实践建议/iu],
  ["video_article", /\b(?:video article|surgical video)\b/i],
  ["technical_note", /\btechnical note\b|技术札记|技术说明/iu],
  ["step_by_step_procedure", /\bstep[- ]by[- ]step (?:procedure|surgery|technique)\b|分步手术|手术步骤解析/iu],
  ["operative_tips", /\b(?:operative|surgical) tips\b|手术技巧/iu],
  ["complication_prevention", /\b(?:surgical )?complication prevention\b|并发症防治/iu],
  ["surgical_approach", /\bsurgical approach\b|手术入路/iu],
  ["anatomy_for_surgery", /\b(?:surgical anatomy|anatomy for surgery)\b|手术解剖/iu],
  ["surgical_review", /\bsurgical review\b|手术难点解析|专家手术点评/iu],
  ["surgical_technique", /\b(?:surgical|operative) technique\b|\binstruments? and techniques?\b|手术技术|术式|操作技术/iu],
  ["safety_alert", /\b(?:patient )?safety alert\b|安全提醒|安全警示/iu],
  ["guideline_implementation", /\bguideline implementation\b|指南实施/iu],
  ["practice_change", /\bpractice change\b|\bguidance implementation\b|实践变更|指南实施/iu],
  ["quality_improvement", /\bquality improvement\b|质量改进/iu],
  ["clinical_service_update", /\bclinical service update\b|临床服务更新/iu],
  ["clinical_update", /\bclinical (?:practice |service )?update\b|临床更新|临床实践更新/iu],
  ["society_update", /\b(?:society|association|professional organi[sz]ation) (?:news|update)\b|学会动态|协会动态/iu],
  ["policy_update", /\b(?:policy|regulatory) update\b|政策更新|监管更新/iu],
  ["academic_update", /\bacademic update\b|学术动态|学术活动总结/iu],
  ["substantive_conference_result", /\bconference (?:results?|findings?) (?:summary|report)\b|会议结果摘要|会议成果总结/iu],
  ["professional_review", /\b(?:narrative|clinical(?: practice)?|expert) review\b|\b(?:professional|clinical) review\b|\breview article\b|叙述性综述|临床综述|临床实践综述|专家综述|专业综述/iu],
  ["expert_commentary", /\b(?:invited )?editorial\b|\bexpert (?:commentary|forum)\b|\b(?:perspective|viewpoint)\b|\b(?:debate|controversy)\b|专家解读|专家述评|专家论坛|观点|争鸣文章/iu],
];

/** Global gate for content that must never enter OB-GYN candidate review. */
export function isHardExcluded(article: RawArticle): boolean {
  const itemMetadata = getItemMetadata(article);
  return HARD_NON_FORMAL_CONTENT_PATTERNS.some((pattern) => pattern.test(itemMetadata));
}

function getItemMetadata(article: RawArticle): string {
  return [article.title, article.excerpt, article.meta, article.contentType]
    .filter((value): value is string => typeof value === "string")
    .join("\n");
}

function classifyHardNonFormalContent(article: RawArticle): DocumentType {
  const itemMetadata = getItemMetadata(article);
  if (HARD_EDUCATION_CONTENT_PATTERN.test(itemMetadata)) return "education";
  if (HARD_VIDEO_CONTENT_PATTERN.test(itemMetadata)) return "video";
  return "unknown";
}

/** Determines an item's document type without relying on its source identity. */
export function classifyDocumentType(article: RawArticle): DocumentType {
  if (isHardExcluded(article)) return classifyHardNonFormalContent(article);
  if (article.documentType && DOCUMENT_TYPES.has(article.documentType)) {
    return article.documentType;
  }

  const title = article.title.trim();
  for (const [documentType, pattern] of FORMAL_TITLE_PATTERNS) {
    if (pattern.test(title)) return documentType;
  }
  if (EDUCATION_TITLE_PATTERN.test(title)) return "education";
  if (VIDEO_TITLE_PATTERN.test(title)) return "video";
  if (NEWS_TITLE_PATTERN.test(title)) return "news";
  return "unknown";
}

/** Normalizes explicit or clearly stated professional content types for column routing. */
export function classifyObgynContentType(article: RawArticle): ObgynContentType | undefined {
  return getObgynContentTypeEvidence(article).contentType;
}

export function getObgynContentTypeEvidence(article: RawArticle): {
  contentType?: ObgynContentType;
  evidence?: ContentTypeEvidence;
} {
  const declared = article.contentType
    ?.trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_") as ObgynContentType | undefined;
  if (declared && OBGYN_CONTENT_TYPES.has(declared)) {
    return { contentType: declared, evidence: article.contentTypeEvidence ?? "declared" };
  }

  const explicitTypeText = article.contentType?.trim() ?? "";
  for (const [contentType, pattern] of CONTENT_TYPE_PATTERNS) {
    if (pattern.test(explicitTypeText)) return { contentType, evidence: article.contentTypeEvidence ?? "metadata" };
  }

  const text = getItemMetadata(article);
  for (const [contentType, pattern] of CONTENT_TYPE_PATTERNS) {
    if (pattern.test(text)) return { contentType, evidence: "title_excerpt" };
  }
  return {};
}

/** Whether the fetch supplied text or a supported structured-content marker. */
export function hasSubstantiveContent(article: RawArticle): boolean {
  if (article.contentType?.trim().toLowerCase() === "metadata_only") return false;
  if (article.excerpt?.trim()) return true;
  return ["abstract", "excerpt", "full_text", "structured_description"].includes(
    article.contentType?.trim().toLowerCase() ?? "",
  );
}

/**
 * Title-only fallback is limited to dated formal documents from the exact
 * configured host of an official authority.
 */
export function isOfficialFormalDocument(article: RawArticle, source: SourceDef): boolean {
  if (
    isHardExcluded(article)
    || source.sourceClass !== "official_authority"
    || !FORMAL_DOCUMENT_TYPES.has(classifyDocumentType(article))
  ) {
    return false;
  }
  if (!article.title.trim() || !article.publishedAt || Number.isNaN(article.publishedAt.getTime())) {
    return false;
  }

  let articleUrl: URL;
  let sourceUrl: URL;
  try {
    articleUrl = new URL(article.url);
    sourceUrl = new URL(source.url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(articleUrl.protocol)) return false;

  const configuredHosts = new Set([
    sourceUrl.hostname.toLowerCase(),
    ...(source.allowedHosts ?? []).map((host) => host.toLowerCase()),
  ]);
  return configuredHosts.has(articleUrl.hostname.toLowerCase());
}
