import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("removes pre-cutover general-news reports from the publish tree", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "obgyn-site-"));
  const legacy = path.join(root, "2026-08-03");
  const medical = path.join(root, "2026-08-04");
  fs.mkdirSync(legacy, { recursive: true });
  fs.mkdirSync(medical, { recursive: true });
  fs.writeFileSync(path.join(legacy, "2026-08-03.html"), "<title>每日简报</title><p>stock market</p>");
  fs.writeFileSync(path.join(legacy, "2026-08-03.json"), '{"finance":"stock market"}');
  fs.writeFileSync(path.join(medical, "2026-08-04.html"), "<title>妇产科医学晨报 · 2026-08-04</title>");

  const result = spawnSync(process.execPath, ["scripts/build-site.mjs"], {
    cwd: path.resolve("."),
    env: { ...process.env, DAILY_REPORTS_DIR: root },
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.existsSync(medical), true);
  const archive = fs.readFileSync(path.join(root, "archive.html"), "utf8");
  assert.doesNotMatch(archive, /2026-08-03|stock market/);
  assert.match(archive, /妇产科医学晨报/);
});
