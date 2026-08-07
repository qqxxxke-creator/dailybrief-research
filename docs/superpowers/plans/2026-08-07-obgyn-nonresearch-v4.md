# OB-GYN Non-research V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover qualified non-research OB-GYN content that is currently lost through incomplete article-type recognition or missing ACOG/妇产科网 metadata, without changing the report, page, research, selection, or deployment contracts.

**Architecture:** Keep all existing selection windows, sorting, history de-duplication, LLM review, and report rendering untouched. Add a narrowly-scoped type-evidence gate for whitelisted academic-journal commentary/review formats, plus a standalone ACOG/妇产科网 detail-page enrichment function invoked once between fetching and deterministic filtering.

**Tech Stack:** TypeScript, Node `fetch`, Cheerio, Node test runner via `tsx`.

## Global Constraints

- Do not change `DailyReport`, page layout, `ResearchSection`, `runResearchSafely`, research settings, selection windows, sort order, history semantics, or GitHub Actions.
- Detail enrichment handles only `acog-news` and `obgy-cn`; no browser automation, WAF workaround, generic crawler, or URL-date fallback.
- Original/research articles, trials, observational studies, protocols, case reports, systematic/scoping/umbrella reviews, and meta-analyses remain excluded before new commentary/review allowances.
- Every recovered item still passes existing hard exclusions, OB-GYN relevance, time-window, displayed-history, and LLM review gates.

---

### Task 1: Make academic non-research type evidence explicit and safe

**Files:**
- Modify: `lib/sources/types.ts`
- Modify: `lib/sources/content-policy.ts`
- Modify: `lib/sources/obgyn-filter.ts`
- Test: `tests/obgyn/content-policy.test.ts`
- Test: `tests/obgyn/filter.test.ts`

**Interfaces:**
- Produces `getObgynContentTypeEvidence(article): { contentType?: ObgynContentType; source: "declared" | "metadata" | "title_excerpt" | "none" }`.
- Produces `isAllowedAcademicNonResearch(article, source): boolean`, used only by `routeDecision` after hard research exclusion and before the academic-journal fallback rejection.
- `RawArticle` gains optional intermediate-only `contentTypeEvidence`; it is never copied to report output.

- [ ] **Step 1: Write failing routing tests**

```ts
assert.deepEqual(filterObgynCandidates([editorial], [journal], now).map((x) => x.title), [editorial.title]);
assert.deepEqual(filterObgynCandidates([structuredOriginal], [journal], now), []);
assert.deepEqual(filterObgynCandidates([structuredSystematic], [journal], now), []);
assert.deepEqual(filterObgynCandidates([titleOnlyReview], [journal], now), []);
```

Cover declared Editorial, Narrative Review, Clinical Practice Review, Expert Forum, Perspective/Viewpoint and Debate/争鸣 with substantive excerpt; cover missing whitelist, missing excerpt and generic title-only `review` rejection.

- [ ] **Step 2: Run the focused tests and confirm the new acceptance cases fail**

Run: `npm test -- tests/obgyn/content-policy.test.ts tests/obgyn/filter.test.ts`

Expected: current routing either rejects the new declared review/commentary type or accepts an unsafe title-only form, proving the contract is not yet encoded.

- [ ] **Step 3: Implement evidence-aware classification**

```ts
const HARD_RESEARCH_TYPE_RE = /original article|research article|systematic review|meta-analysis|scoping review|umbrella review|protocol|case report/i;

if (HARD_RESEARCH_TYPE_RE.test(structuredTypeText)) return { kind: "reject", reason: "ordinary_research_article" };
if (isAllowedAcademicNonResearch(article, source)) return { kind: "column", category: "politics" };
```

Map only the requested aliases to existing `professional_review` or `expert_commentary`. Structured metadata always wins over title inference. Permit a title-plus-excerpt fallback only for a precise requested type with a substantive excerpt; generic `review` stays unknown. Restrict the allowance to configured `academic_journal` sources and the existing official/professional source classes, while retaining hard-exclusion, direct-domain, excerpt, and later LLM requirements.

- [ ] **Step 4: Run focused tests and full OB-GYN test suite**

Run: `npm test -- tests/obgyn/content-policy.test.ts tests/obgyn/filter.test.ts`

Expected: PASS, including all existing guideline, surgery and professional-dynamics tests.

- [ ] **Step 5: Commit the independently testable type-policy change**

```bash
git add lib/sources/types.ts lib/sources/content-policy.ts lib/sources/obgyn-filter.ts tests/obgyn/content-policy.test.ts tests/obgyn/filter.test.ts
git commit -m "fix: recognize qualified obgyn nonresearch commentary"
```

### Task 2: Add bounded, cached ACOG/妇产科网 detail metadata enrichment

**Files:**
- Create: `lib/sources/obgyn-detail-metadata.ts`
- Test: `tests/obgyn/detail-metadata.test.ts`

**Interfaces:**
- Produces `enrichObgynDetailMetadata(articles, options?): Promise<{ articles: ArticleInput[]; stats: ObgynDetailMetadataStats }>`.
- Exports pure `extractObgynDetailMetadata(html)` for fixture tests.
- Options permit injected fetch/cache/clock/logger dependencies for deterministic tests; production defaults use `fetch`, a 14-day JSON cache, 10-second timeout, one retry, global cap 16, per-source cap 8, and concurrency 3.

- [ ] **Step 1: Write failing detail-enrichment tests**

```ts
const result = await enrichObgynDetailMetadata([missingDateAcog], { fetchHtml });
assert.equal(result.articles[0].publishedAt?.toISOString(), "2026-08-06T00:00:00.000Z");
assert.equal(fetchCalls, 1);
```

Include real-structure-style ACOG date metadata; 妇产科网 date/summary/type metadata; nav/cookie/author/ad exclusion; in-run canonical URL de-duplication; source/global caps; cache hit; one retry; non-blocking 403/429/timeout/parse failures; and eligibility rejection for complete, non-target, hard-excluded and clearly research items.

- [ ] **Step 2: Run the new test file and confirm it fails because the module is absent**

Run: `npm test -- tests/obgyn/detail-metadata.test.ts`

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement the isolated enrichment layer**

```ts
export async function enrichObgynDetailMetadata(articles: ArticleInput[], options: EnrichOptions = {}) {
  const eligible = selectEligibleCandidates(articles).slice(0, 16);
  const results = await runWithConcurrency(eligible, 3, enrichOne);
  return { articles: mergeOnlyMissingFields(articles, results), stats };
}
```

Use canonical URL keys and a 14-day cache. Extract date in the specified structured-metadata order without assigning `dateModified` to `publishedAt`; extract excerpts from structured description/lead selectors while rejecting boilerplate; extract article type from citation/prism/JSON-LD/section/tag/breadcrumb before title fallback. Return untouched candidates on every failure and emit only the requested compact diagnostics.

- [ ] **Step 4: Run detail tests and OB-GYN regression tests**

Run: `npm test -- tests/obgyn/detail-metadata.test.ts tests/obgyn/pages.test.ts tests/obgyn/filter.test.ts`

Expected: PASS, with no network access required by fixtures.

- [ ] **Step 5: Commit the enrichment component**

```bash
git add lib/sources/obgyn-detail-metadata.ts tests/obgyn/detail-metadata.test.ts
git commit -m "fix: enrich acog and obgy news metadata"
```

### Task 3: Insert enrichment in the daily pipeline and verify boundaries

**Files:**
- Modify: `scripts/daily.ts`
- Test: `tests/obgyn/pipeline.test.ts`

**Interfaces:**
- `daily.ts` invokes `enrichObgynDetailMetadata(fetched)` exactly after `fetchAll()` and before `filterObgynCandidatesWithStats()`.
- Existing downstream filter receives the enriched article array; all downstream calls remain unchanged.

- [ ] **Step 1: Write a failing pipeline-order test**

```ts
assert.ok(source.indexOf("enrichObgynDetailMetadata(fetched)") > source.indexOf("await fetchAll()"));
assert.ok(source.indexOf("enrichObgynDetailMetadata(fetched)") < source.indexOf("filterObgynCandidatesWithStats("));
```

- [ ] **Step 2: Run the pipeline test and confirm it fails before wiring**

Run: `npm test -- tests/obgyn/pipeline.test.ts`

Expected: FAIL because no enrichment call exists.

- [ ] **Step 3: Add the single pipeline insertion and compact stats logging**

```ts
const enriched = await enrichObgynDetailMetadata(fetched);
const filtered = filterObgynCandidatesWithStats(enriched.articles, sources);
```

Log only requested/count/cache-hit/success/failure and field-enriched counters. Do not alter filtering, selection, report building, research execution, or render inputs.

- [ ] **Step 4: Run all checks**

Run: `npm test`

Run: `npx tsc --noEmit`

Run: `npm run sources:check`

Run: `npm run build-site`

Expected: all commands exit 0. If a lint command is not configured in `package.json`, explicitly record that no lint script exists rather than adding one.

- [ ] **Step 5: Run one fetch-only observational check and report the funnel**

Run: `npm run dry-run`

Expected: a non-blocking run that reports fetched candidates, requested/cache-hit/enriched fields, new type allowance, deterministic acceptance and final per-column counts; report actual source failures honestly.

- [ ] **Step 6: Commit the integration and test**

```bash
git add scripts/daily.ts tests/obgyn/pipeline.test.ts
git commit -m "feat: enrich obgyn detail metadata before filtering"
```
