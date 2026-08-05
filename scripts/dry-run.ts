import "./_env";

import { sources } from "../lib/sources/registry";
import { fetchSource } from "../lib/sources/dispatch";
import type { ArticleInput } from "../lib/ai/pipeline";
import { filterObgynCandidates } from "../lib/sources/obgyn-filter";
import type { SourceDef } from "../lib/sources/types";

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function matchesCategory(source: SourceDef, requested: string | undefined): boolean {
  if (!requested) return true;
  const mapping: Record<string, [SourceDef["category"], string]> = {
    guidelines: ["tech", "guidelines"],
    surgery: ["finance", "surgery"],
    international_obgyn: ["politics", "international-obgyn"],
    china_obgyn: ["politics", "china-obgyn"],
  };
  const target = mapping[requested];
  return Boolean(target && source.category === target[0] && source.subcategory === target[1]);
}

// Source-fetch sanity check only — does NOT call the LLM. For the full
// ingest → digest → write-to-disk pipeline use `npm run daily` instead.
async function main() {
  console.log("Fetching from sources…\n");
  const articles: ArticleInput[] = [];
  let successfulSources = 0;

  const requestedSource = argValue("source");
  const requestedCategory = argValue("category");
  const enabled = sources.filter(
    (source) =>
      (requestedSource ? source.id === requestedSource : source.enabled !== false) &&
      matchesCategory(source, requestedCategory),
  );
  if (enabled.length === 0) {
    throw new Error("No enabled source matched --source/--category selection");
  }
  for (const source of enabled) {
    try {
      const items = await fetchSource(source);
      successfulSources += 1;
      console.log(`  ${source.id.padEnd(20)} ${items.length}`);
      articles.push(...items.map((it) => ({ ...it, source: source.name })));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`  ${source.id.padEnd(20)} WARNING — ${msg}`);
    }
  }

  if (successfulSources === 0) {
    throw new Error("Every selected source failed; no freshness result can be reported");
  }

  const eligible = filterObgynCandidates(articles, enabled);
  console.log(`\nFetched articles: ${articles.length}`);
  console.log(`Rule-eligible articles: ${eligible.length}`);
  console.log("\nTop 10 eligible articles:");
  eligible.slice(0, 10).forEach((a, i) => {
    console.log(`  ${i + 1}. [${a.category}] ${a.title}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
