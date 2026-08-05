import fs from "node:fs";
import path from "node:path";

import { paperIdentityKeys } from "./normalize";

type HistoricalPaper = { pmid?: string; doi?: string; title?: string };
type HistoricalReport = { research?: { papers?: HistoricalPaper[] } };

export function loadPreviouslyShownResearchKeys(
  reportsRoot: string,
  currentDate: string,
  warn: (message: string) => void = console.warn,
): Set<string> {
  const shown = new Set<string>();
  if (!fs.existsSync(reportsRoot)) return shown;

  for (const date of fs.readdirSync(reportsRoot)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= currentDate) continue;
    const reportPath = path.join(reportsRoot, date, `${date}.json`);
    if (!fs.existsSync(reportPath)) continue;
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, "utf8")) as HistoricalReport;
      for (const paper of report.research?.papers ?? []) {
        for (const key of paperIdentityKeys({
          pmid: paper.pmid,
          doi: paper.doi,
          title: paper.title,
        })) {
          shown.add(key);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`[research:history] ignored malformed report ${reportPath}: ${message}`);
    }
  }
  return shown;
}
