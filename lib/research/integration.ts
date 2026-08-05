import { runResearchIntelligence } from "./runner";
import type { ResearchSection } from "./types";

export async function runResearchSafely(
  run: () => Promise<ResearchSection | undefined> = runResearchIntelligence,
  warn: (message: string) => void = console.warn,
): Promise<ResearchSection | undefined> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`[daily] research section failed: ${message}`);
    return undefined;
  }
}
