# OB-GYN Recall Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve OB-GYN item recall with content-level trust policies, wider category windows, three-state semantic review, and durable cross-report deduplication without weakening hard exclusions.

**Architecture:** Keep the existing fetch → deterministic filter → semantic review → digest → render pipeline. Add declarative source classes and item document types at the filtering boundary, replace guideline-only history filtering with all-content history filtering, and add research identity history before scoring and quotas.

**Tech Stack:** TypeScript, Node.js, node:test, JSON source configuration, GitHub Actions and static HTML rendering.

## Global Constraints

- Do not redesign the HTML or restructure the main pipeline.
- Guidelines use 720 hours, surgery 168 hours, international and China updates 72 hours, and research 7 days.
- Hard exclusions for advertising, sponsorship, recruitment, procurement, registration, hospital promotion, patient education, non-substantive events and non-OB-GYN content always win.
- Only official formal documents may use title-only fallback, with the exact fixed summary from the design.
- Historical news identity is canonical URL; historical research identity is PMID, DOI, then normalized title.
- Research uses `min_score=40`, `max_per_topic=3`, `max_papers=5`.

---

### Task 1: Declarative source classes and item-level document classification

**Files:**
- Modify: `lib/sources/types.ts`
- Modify: `lib/sources/registry.ts`
- Modify: `sources.config.json`
- Create: `lib/sources/content-policy.ts`
- Create: `tests/obgyn/content-policy.test.ts`

**Interfaces:**
- Produces `SourceClass`, `DocumentType`, `classifyDocumentType(article)`, `hasSubstantiveContent(article)`, `isOfficialFormalDocument(article, source)`.
- `SourceDef.sourceClass` is mandatory in validated configuration.
- `RawArticle.documentType`, `RawArticle.contentType`, `RawArticle.reviewStatus`, and `RawArticle.lowPriority` remain optional transport metadata.

- [ ] **Step 1: Write failing policy tests**

```ts
test("classifies official formal documents by item type, not institution id", () => {
  assert.equal(classifyDocumentType(article("ACOG Practice Advisory")), "practice_advisory");
  assert.equal(classifyDocumentType(article("ACOG webinar registration")), "education");
});

test("allows title-only fallback only for official formal documents", () => {
  assert.equal(isOfficialFormalDocument(formalArticle, officialSource), true);
  assert.equal(isOfficialFormalDocument(videoArticle, officialSource), false);
  assert.equal(isOfficialFormalDocument(formalArticle, journalSource), false);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx --test tests/obgyn/content-policy.test.ts`

Expected: FAIL because `content-policy.ts` and the new types do not exist.

- [ ] **Step 3: Implement the minimal types and classifier**

```ts
export type SourceClass =
  | "official_authority"
  | "academic_journal"
  | "professional_vertical"
  | "general_authority";

export type DocumentType =
  | "guideline" | "consensus" | "statement" | "practice_advisory"
  | "safety_alert" | "research_article" | "news" | "video"
  | "education" | "policy" | "unknown";
```

Implement deterministic precedence: structured `documentType` first, then exact formal-document regexes, then news/video/education regexes, else `unknown`. `isOfficialFormalDocument` requires `official_authority`, a formal type, title, valid date, original URL, and configured official host.

- [ ] **Step 4: Add exact source classes to configuration and validation**

Assign official guidance sources to `official_authority`; GOCM/JMIG/explicit Chinese journal sources to `academic_journal`; organization news, SurgeryU, CMCHA and professional platforms to `professional_vertical`; WHO/FDA/EMA sources to `general_authority`. Do not infer a class from the display name.

- [ ] **Step 5: Run focused tests and commit**

Run: `npx tsx --test tests/obgyn/content-policy.test.ts tests/obgyn/domain-cutover.test.ts`

Expected: PASS.

Commit: `git commit -am "feat: add item-level OB-GYN source policy"`

---

### Task 2: Category windows and cross-report article history

**Files:**
- Modify: `lib/sources/obgyn-filter.ts`
- Replace responsibility in: `lib/sources/guideline-history.ts`
- Modify: `scripts/daily.ts`
- Modify: `sources.config.json`
- Modify: `tests/obgyn/filter.test.ts`
- Modify: `tests/obgyn/replacement-sources.test.ts`

**Interfaces:**
- Produces `filterPreviouslyPublishedArticles(articles, reportsRoot, currentDate)`.
- Consumes Task 1 policy helpers.

- [ ] **Step 1: Write failing decision-matrix and window tests**

```ts
test("uses 30d, 7d and 72h category windows", () => {
  assert.equal(filterOne(guidelineAt29Days), true);
  assert.equal(filterOne(surgeryAt6Days), true);
  assert.equal(filterOne(internationalAt71Hours), true);
  assert.equal(filterOne(chinaAt73Hours), false);
});

test("general authority requires keyword match before semantic review", () => {
  assert.deepEqual(filterObgynCandidates([unrelatedWhoItem], [whoSource], now), []);
});

test("vertical substantive content can reach semantic review without keyword hit", () => {
  assert.equal(filterObgynCandidates([substantiveAaglItem], [aaglSource], now).length, 1);
});
```

Add hard-exclusion tests proving an advertisement is rejected for every source class.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx tsx --test tests/obgyn/filter.test.ts`

Expected: FAIL on old uniform AND filtering and old windows.

- [ ] **Step 3: Implement source-class-aware deterministic admission**

Apply hard exclusions first. For `general_authority`, require a global domain anchor and a source keyword match plus substantive content. For the other classes, retain substantive candidates for LLM review when either keyword family matches or when the source is vertically scoped; allow missing substantive content only when Task 1 identifies a valid official formal title-only document.

- [ ] **Step 4: Replace guideline-only history with canonical URL history**

```ts
export function filterPreviouslyPublishedArticles(
  articles: ArticleInput[], reportsRoot: string, currentDate: string,
): ArticleInput[];
```

Scan every prior `YYYY-MM-DD/YYYY-MM-DD-articles.json`, ignore the current date, canonicalize URLs with `normalizeContentUrl`, tolerate malformed files with a warning, and filter history before semantic review.

- [ ] **Step 5: Configure exact windows and update daily wiring**

Set guideline sources to 720, surgery sources to 168, and international/China sources to 72 hours. Replace the call to `filterPreviouslyPublishedGuidelines` in `scripts/daily.ts` with the all-content history filter.

- [ ] **Step 6: Run focused tests and commit**

Run: `npx tsx --test tests/obgyn/filter.test.ts tests/obgyn/replacement-sources.test.ts`

Expected: PASS.

Commit: `git commit -am "feat: widen OB-GYN windows with durable URL history"`

---

### Task 3: Three-state semantic review and official title-only fallback

**Files:**
- Modify: `lib/ai/enrich.ts`
- Modify: `lib/ai/pipeline.ts`
- Modify: `lib/sources/types.ts`
- Modify: `tests/obgyn/filter.test.ts`
- Modify: `tests/obgyn/pipeline.test.ts`

**Interfaces:**
- `parseObgynReviewResponse(candidates, responseText)` returns policy-approved `ArticleInput[]` with `reviewStatus` and `lowPriority`.
- `sanitizeDigestReport` caps uncertain-item importance at 5.

- [ ] **Step 1: Write failing three-state tests**

```ts
test("keeps uncertain only for official formal documents and journals", () => {
  const result = parseObgynReviewResponse(candidates, JSON.stringify({ reviews: [
    { url: official.url, status: "uncertain", summary: "" },
    { url: journal.url, status: "uncertain", summary: "available abstract" },
    { url: media.url, status: "uncertain", summary: "available excerpt" },
  ]}));
  assert.deepEqual(result.map(x => x.url), [official.url, journal.url]);
});

test("rejected overrides keyword and authority", () => {
  assert.deepEqual(parseRejected(authoritativeCandidate), []);
});
```

Add tests that official formal title-only items receive exactly `原始页面暂未提供可解析摘要，请查看原文了解详细更新。`, while journal, news and video title-only candidates are rejected.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx tsx --test tests/obgyn/filter.test.ts tests/obgyn/pipeline.test.ts`

Expected: FAIL because the parser still expects boolean `accepted`.

- [ ] **Step 3: Update prompt and parser**

Require `status: accepted | uncertain | rejected`. Preserve the existing fail-closed behavior for missing results and malformed chunks. Apply source/content policy after parsing; never allow `rejected`. For valid official title-only formal documents, use the fixed summary and mark low priority without asking the model to invent details.

- [ ] **Step 4: Enforce low priority in digest sanitization**

When rebuilding model output from accepted inputs, cap `importance` to 5 for `lowPriority=true`; canonical title, source, URL and category still come from the input candidate map.

- [ ] **Step 5: Run focused tests and commit**

Run: `npx tsx --test tests/obgyn/filter.test.ts tests/obgyn/pipeline.test.ts`

Expected: PASS.

Commit: `git commit -am "feat: add three-state medical review"`

---

### Task 4: Seven-day research window and previously-shown paper identities

**Files:**
- Modify: `config/research-interests.json`
- Modify: `.env.example`
- Modify: `.github/workflows/daily.yml`
- Modify: `lib/research/scoring.ts`
- Create: `lib/research/history.ts`
- Modify: `lib/research/runner.ts`
- Modify: `tests/research/scoring.test.ts`
- Modify: `tests/research/runner.test.ts`
- Create: `tests/research/history.test.ts`

**Interfaces:**
- Produces `loadPreviouslyShownResearchKeys(reportsRoot, currentDate): Set<string>`.
- `ResearchDeps.loadShownKeys?: () => Set<string>` permits deterministic runner tests.
- Consumes existing `paperIdentityKeys(paper)`.

- [ ] **Step 1: Write failing research parameter and history tests**

```ts
test("accepts papers indexed within seven days but not older", () => {
  assert.deepEqual(ids(select([sixDaysOld, eightDaysOld])), [sixDaysOld.id]);
});

test("history matches PMID, DOI, then normalized title", () => {
  const keys = loadPreviouslyShownResearchKeys(root, "2026-08-05");
  assert.ok(keys.has("pmid:123"));
  assert.ok(keys.has("doi:10.1000/example"));
  assert.ok(keys.has("title:placental-outcomes"));
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx tsx --test tests/research/scoring.test.ts tests/research/history.test.ts tests/research/runner.test.ts`

Expected: FAIL at the old 24-hour cutoff and missing history loader.

- [ ] **Step 3: Implement seven-day settings and history**

Set lookback to 7, score threshold to 40, max per topic to 3, total to 5. Reject future timestamps and ages greater than seven days. Scan prior daily report JSON, extract displayed research papers, and add every `paperIdentityKeys` value to the history set.

- [ ] **Step 4: Filter history before scoring and quotas**

In `runResearchIntelligence`, remove cached/merged papers whose identity keys intersect history before calling `selectResearchPapers`. Apply the same behavior to cached fallback. Keep cache retention and 48-hour fetch overlap unchanged.

- [ ] **Step 5: Run focused tests and commit**

Run: `npx tsx --test tests/research/*.test.ts`

Expected: PASS.

Commit: `git commit -am "feat: expand research discovery with display history"`

---

### Task 5: Category-specific empty copy and full regression

**Files:**
- Modify: `lib/output/render.ts`
- Modify: `tests/obgyn/domain-cutover.test.ts`
- Modify: `tests/research/render.test.ts`

**Interfaces:**
- Rendering stays compatible with existing `renderHtml` and `renderMarkdown` signatures.

- [ ] **Step 1: Write failing copy tests**

Assert the exact four Chinese strings from the design in empty HTML and Markdown sections, and assert research remains the final content section.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx tsx --test tests/obgyn/domain-cutover.test.ts tests/research/render.test.ts`

Expected: FAIL on the old global 24-hour empty message.

- [ ] **Step 3: Add category-specific copy without layout changes**

Map empty text by subcategory/category and use it in existing empty render branches. Do not add panels, tabs, CSS or schema fields.

- [ ] **Step 4: Run complete verification**

Run:

```powershell
npx tsx --test tests/**/*.test.ts
npx tsc --noEmit
npx tsx scripts/sources.ts check
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 5: Perform focused dry-run diagnostics**

Run configured source dry-runs for at least one source in each class and report fetched, deterministic-admission and semantic-review counts. Do not weaken rules to force a non-empty result.

- [ ] **Step 6: Commit**

Commit: `git commit -am "feat: tune OB-GYN recall and empty states"`
