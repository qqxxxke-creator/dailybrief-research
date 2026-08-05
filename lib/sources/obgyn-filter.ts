import type { ArticleInput } from "../ai/pipeline";
import {
  classifyDocumentType,
  hasSubstantiveContent,
  isHardExcluded,
  isOfficialFormalDocument,
} from "./content-policy";
import type { SourceDef } from "./types";

const HOUR_MS = 60 * 60 * 1000;

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

function normalizeTitle(title: string): string {
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

export function filterObgynCandidates(
  articles: ArticleInput[],
  sources: SourceDef[],
  now = new Date(),
): ArticleInput[] {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const accepted: ArticleInput[] = [];

  for (const article of articles) {
    if (isHardExcluded(article)) continue;

    const itemText = [article.title, article.excerpt, article.meta, article.contentType]
      .filter((value): value is string => typeof value === "string")
      .join("\n");
    if (includesAny(itemText, OBGYN_EXCLUDE_KEYWORDS)) continue;

    const source = sourceById.get(article.sourceId);
    if (!source || !article.publishedAt || Number.isNaN(article.publishedAt.getTime())) continue;

    if (includesAny(itemText, source.excludeKeywords ?? [])) continue;

    const age = now.getTime() - article.publishedAt.getTime();
    const lookbackHours = source.lookbackHours ?? (source.subcategory === "guidelines" ? 168 : 24);
    if (age < 0 || age > lookbackHours * HOUR_MS) continue;

    const hasDomainAnchor = includesAny(itemText, OBGYN_INCLUDE_KEYWORDS);
    const sourceKeywords = source.keywords ?? [];
    const matchesSourceRule = sourceKeywords.length > 0
      && includesAny(itemText, sourceKeywords);
    const documentType = classifyDocumentType(article);
    const substantive = hasSubstantiveContent(article);
    const officialFormalTitleOnly = isOfficialFormalDocument(article, source);

    if (source.sourceClass === "general_authority") {
      if (!hasDomainAnchor || !matchesSourceRule || !substantive) continue;
    } else {
      const verticallyScoped = source.sourceClass === "professional_vertical";
      if (!substantive && !officialFormalTitleOnly) continue;
      if (!hasDomainAnchor && !matchesSourceRule && !verticallyScoped) continue;
      // Structured education content is never a title-only formal-document fallback.
      if (!substantive && documentType === "education") continue;
    }

    const urlKey = normalizeContentUrl(article.url);
    const titleKey = normalizeTitle(article.title);
    if (!urlKey || !titleKey || seenUrls.has(urlKey) || seenTitles.has(titleKey)) continue;
    seenUrls.add(urlKey);
    seenTitles.add(titleKey);
    accepted.push(article);
  }

  return accepted;
}
