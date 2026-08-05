import type { DocumentType, RawArticle, SourceDef } from "./types";

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

/** Whether the fetch supplied text or a supported structured-content marker. */
export function hasSubstantiveContent(article: RawArticle): boolean {
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
