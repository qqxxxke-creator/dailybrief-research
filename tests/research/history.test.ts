import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadPreviouslyShownResearchKeys } from "../../lib/research/history";

test("loads prior PMID, DOI and normalized-title identities but skips the current date", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-history-"));
  const prior = path.join(root, "2026-08-04");
  const current = path.join(root, "2026-08-05");
  fs.mkdirSync(prior, { recursive: true });
  fs.mkdirSync(current, { recursive: true });
  fs.writeFileSync(path.join(prior, "2026-08-04.json"), JSON.stringify({ research: { papers: [
    { pmid: "123", title: "First paper" },
    { doi: "https://doi.org/10.1000/EXAMPLE.", title: "Second paper" },
    { pmid: "pmid-only" },
    { doi: "10.1000/doi-only" },
    { title: "Placental—Outcomes" },
  ] } }));
  fs.writeFileSync(path.join(current, "2026-08-05.json"), JSON.stringify({ research: { papers: [
    { pmid: "current", title: "Current rerun paper" },
  ] } }));

  const keys = loadPreviouslyShownResearchKeys(root, "2026-08-05");
  assert.ok(keys.has("pmid:123"));
  assert.ok(keys.has("doi:10.1000/example"));
  assert.ok(keys.has("title:placental outcomes"));
  assert.ok(keys.has("pmid:pmid-only"));
  assert.ok(keys.has("doi:10.1000/doi-only"));
  assert.ok(!keys.has("pmid:current"));
});

test("warns and continues past malformed historical reports", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "research-history-bad-"));
  const prior = path.join(root, "2026-08-04");
  fs.mkdirSync(prior, { recursive: true });
  fs.writeFileSync(path.join(prior, "2026-08-04.json"), "{broken");
  const warnings: string[] = [];
  assert.deepEqual(loadPreviouslyShownResearchKeys(root, "2026-08-05", (message) => warnings.push(message)), new Set());
  assert.equal(warnings.length, 1);
});
