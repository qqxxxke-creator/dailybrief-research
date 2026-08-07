export type Category = "tech" | "finance" | "politics";
export type SourceType = "rss" | "api" | "scrape";
export type SourceClass =
  | "official_authority"
  | "academic_journal"
  | "professional_vertical"
  | "general_authority";

export type DocumentType =
  | "guideline"
  | "consensus"
  | "statement"
  | "practice_advisory"
  | "safety_alert"
  | "quality_indicator"
  | "research_article"
  | "news"
  | "video"
  | "education"
  | "policy"
  | "unknown";

export type ReviewStatus = "accepted" | "uncertain" | "rejected";
export type ContentTypeEvidence = "declared" | "metadata" | "title_excerpt";

export interface SourceDef {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  category: Category;
  /** Explicit policy class; never inferred from the source display name. */
  sourceClass: SourceClass;
  /**
   * Group key within a category. Render order/labels are defined per
   * category in lib/output/render.ts. Categories without a registered
   * order render flat (no L2 tabs).
   */
  subcategory?: string;
  /**
   * When true, the rss fetcher shells out to curl instead of using
   * Node's undici. Required for hosts that TLS-fingerprint Node
   * (Cloudflare's "Just a moment…" challenge — LinuxDo, Reddit, etc.)
   */
  useCurl?: boolean;
  enabled?: boolean;
  /**
   * Source content language. Default treated as "en". When this equals
   * the active REPORT_LOCALE, the summary-enrichment step skips this
   * source — its content is already in the target language, so an LLM
   * "summary" would just be a slightly-shorter rewrite.
   */
  lang?: "zh" | "en";
  /**
   * Report locales this source participates in. Defaults to ["zh", "en"]
   * (both) when omitted. Set to ["zh"] for Chinese-only sources whose
   * content is meaningless to English-mode readers (V2EX/LinuxDo/etc.),
   * or ["en"] for English-community sources used to replace Chinese ones
   * when REPORT_LOCALE=en. The registry filters by REPORT_LOCALE at load.
   */
  locales?: ("zh" | "en")[];
  /**
   * Optional human-readable note explaining why a source is disabled or
   * any context useful for fork users. Ignored at runtime.
   */
  notes?: string;
  /**
   * Optional keyword filter list. When present, only items whose title or
   * body matches at least one keyword (case-insensitive) are kept.
   * Omit or leave empty to return all items unfiltered.
   */
  keywords?: string[];
  /** Optional source-specific exclusions from the OB-GYN manifest. */
  excludeKeywords?: string[];
  /** Per-source freshness window; the OB-GYN manifest defines each column's policy. */
  lookbackHours?: number;
  /** Additional hostnames allowed for links emitted by an HTML source. */
  allowedHosts?: string[];
  /** Optional explicit query for API-backed sources such as PubMed. */
  query?: string;
}

export interface RawArticle {
  sourceId: string;
  title: string;
  url: string;
  excerpt?: string;
  publishedAt?: Date;
  category: Category;
  /**
   * LLM-generated summary in the active REPORT_LOCALE language. For zh
   * reports this is the Chinese translation/summary of an English source;
   * for en reports it'd be the English summary of a non-English source.
   */
  summary?: string;
  /**
   * Structured one-line metadata to display above the excerpt — currently
   * used by GitHub Trending for "Language · ★stars · forks · stars today".
   */
  meta?: string;
  /** Transported source metadata used to classify the individual item. */
  documentType?: DocumentType;
  /** Transported indication that an abstract, excerpt, or structured body is available. */
  contentType?: string;
  /** Provenance for an inferred nonresearch content type; never rendered. */
  contentTypeEvidence?: ContentTypeEvidence;
  /** Optional semantic-review outcome, assigned downstream. */
  reviewStatus?: ReviewStatus;
  /** Optional ranking hint, assigned downstream. */
  lowPriority?: boolean;
}
