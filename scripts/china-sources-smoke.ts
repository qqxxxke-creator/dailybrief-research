import "./_env";

import fs from "node:fs";

import { fetchCogonlineGuidance, fetchObgyncnProfessional } from "../lib/sources/china-professional";
import { enrichObgynDetailMetadata } from "../lib/sources/obgyn-detail-metadata";
import { filterObgynCandidatesWithStats } from "../lib/sources/obgyn-filter";
import type { SourceDef } from "../lib/sources/types";

const ids = ["cogonline-clinical-guidance", "obgyncn-professional-content"] as const;
const config = JSON.parse(fs.readFileSync("sources.config.json", "utf8")) as SourceDef[];

async function main(): Promise<void> {
for (const sourceId of ids) {
  const source = config.find((item) => item.id === sourceId);
  if (!source) throw new Error(`missing source config: ${sourceId}`);
  try {
    const fetched = sourceId === "cogonline-clinical-guidance"
      ? await fetchCogonlineGuidance(source)
      : await fetchObgyncnProfessional(source);
    const detailed = await enrichObgynDetailMetadata(
      fetched.map((item) => ({ ...item, source: source.name })),
      { cache: new Map(), log: (line) => console.log(line) },
    );
    const filtered = filterObgynCandidatesWithStats(detailed.articles, [source]);
    const withDate = detailed.articles.filter((item) => item.publishedAt).length;
    const withExcerpt = detailed.articles.filter((item) => (item.excerpt?.trim().length ?? 0) >= 30).length;
    const withType = detailed.articles.filter((item) => item.contentType).length;
    const detail = detailed.stats.perSource[sourceId] ?? { requested: 0, cacheHits: 0, succeeded: 0, failed: 0 };
    const failureReason = fetched.length === 0 ? "zero_items" : detail.failed ? `detail_failed_${detail.failed}` : "none";
    console.log(`[smoke] ${sourceId}: source_fetch_count=${fetched.length}, source_parse_count=${fetched.length}, date_resolved=${withDate}, excerpt_resolved=${withExcerpt}, type_resolved=${withType}, deterministic_eligible=${filtered.articles.length}, deterministic_rejected=${filtered.rejections.length}, detail_fetch_requested=${detail.requested}, detail_fetch_success=${detail.succeeded}, per_source_failure_reason=${failureReason}`);
    for (const item of detailed.articles.slice(0, 3)) {
      console.log(`[smoke] sample ${sourceId}: date=${item.publishedAt?.toISOString() ?? "missing"}, type=${item.contentType ?? "missing"}, excerpt_chars=${item.excerpt?.length ?? 0}, title=${item.title.slice(0, 100)}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.log(`[smoke] ${sourceId}: source_fetch_count=0, source_parse_count=0, date_resolved=0, excerpt_resolved=0, type_resolved=0, deterministic_eligible=0, deterministic_rejected=0, detail_fetch_requested=0, detail_fetch_success=0, per_source_failure_reason=${reason}`);
  }
}
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
