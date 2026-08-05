import "./_env";

import { runResearchDryRun } from "../lib/research/runner";

async function main(): Promise<void> {
  const result = await runResearchDryRun();
  console.log(`[research:dry-run] window ${result.from} → ${result.to}`);
  for (const source of result.sourceResults) {
    console.log(
      `[research:dry-run] ${source.sourceId}: ${source.ok ? "ok" : "failed"}, fetched=${source.fetched}, rejected=${JSON.stringify(source.rejected)}` +
        (source.error ? `, error=${source.error}` : ""),
    );
  }
  console.log(
    `[research:dry-run] fetched=${result.fetchedCount}, deduped=${result.dedupedCount}, selected=${result.candidates.length}`,
  );
  for (const paper of result.candidates) {
    console.log(
      `  ${paper.score?.total.toFixed(2)} | ${paper.assignedTopicId} | ${paper.pmid ?? paper.doi ?? paper.id} | ${paper.title}`,
    );
  }
  if (result.successfulSources === 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error("[research:dry-run] FAILED:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
