import assert from "node:assert/strict";
import test from "node:test";

import { runResearchSafely } from "../../lib/research/integration";

test("turns a research pipeline exception into a non-fatal warning", async () => {
  const warnings: string[] = [];
  const section = await runResearchSafely(
    async () => { throw new Error("PubMed unavailable"); },
    (message) => warnings.push(message),
  );
  assert.equal(section, undefined);
  assert.deepEqual(warnings, ["[daily] research section failed: PubMed unavailable"]);
});
