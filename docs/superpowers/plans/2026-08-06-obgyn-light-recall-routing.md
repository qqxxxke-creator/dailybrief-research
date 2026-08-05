# OB-GYN Light Recall Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Increase useful OB-GYN recall with lightweight item-type routing, two-tier time windows, and stage counts while preserving strict exclusions and history deduplication.

**Architecture:** Keep the existing fetch → deterministic filter → history → semantic review → digest/render pipeline. Derive a tentative target column from existing document-type and content signals, review priority-window items first, and review supplemental-window items only when accepted non-research content remains below five. Reuse `meta` for the supplemental marker and do not change either report schema or Research Intelligence.

**Tech Stack:** TypeScript, Node.js, `node:test`, JSON source configuration, static HTML rendering.

## Global Constraints

- Guidelines use 30/90-day priority/supplement windows; surgery uses 7/30 days; international and China updates use 72-hour/7-day windows; research remains 7 days.
- Previously displayed news URLs and research identities remain excluded.
- Official and vertically scoped OB-GYN sources may reach semantic review without keyword hits when the item has substantive text; formal official documents may retain the existing title-only fallback.
- General WHO/FDA-style sources keep keyword plus domain checks.
- Ordinary journal research is removed from the non-research pipeline and is not injected into Research Intelligence.
- No changes to `runResearchSafely`, research sources, the report JSON schema, or page layout.
- Hard exclusions for non-OB-GYN content, promotion, advertising, sponsorship, recruitment, procurement, registration, patient education, and empty event promotion remain unchanged.

---

### Task 1: Content decisions, two-tier windows, and aggregate statistics

**Files:**
- Modify: `sources.config.json`
- Modify: `lib/sources/obgyn-filter.ts`
- Modify: `scripts/daily.ts`
- Test: `tests/obgyn/filter.test.ts`
- Test: `tests/obgyn/replacement-sources.test.ts`

**Interfaces:**
- Produce `filterObgynCandidatesWithStats(articles, sources, now)` returning candidates partitionable as priority or supplemental plus aggregate decisions.
- Preserve `filterObgynCandidates(...)` as a compatibility wrapper.

- [x] Add failing tests for 30/90-day guideline, 7/30-day surgery, and 72-hour/7-day dynamics windows.
- [x] Add failing tests that ordinary journal research is rejected while formal guidance and technique articles are retained.
- [x] Implement counters for time, relevance, unsupported type, missing content, duplicate, promotion, and accepted decisions.
- [x] Set source lookbacks to the maximum supplemental window needed by their default feed while applying effective windows from the tentative routed column.
- [x] Log the deterministic counters plus history and semantic-review counts in `scripts/daily.ts`.
- [x] Run focused tests until green.

### Task 2: Deterministic lightweight item routing and supplemental selection

**Files:**
- Modify: `lib/sources/obgyn-filter.ts`
- Modify: `scripts/daily.ts`
- Modify: `lib/output/render.ts`
- Test: `tests/obgyn/routing.test.ts`
- Test: `tests/obgyn/domain-cutover.test.ts`

**Interfaces:**
- Produce `routeObgynArticles(articles, sources)` by updating existing `category`; `groupRaw` derives the compatible existing subgroup from category and source locale.
- Produce `selectObgynWindowArticles(priorityAccepted, supplementalAccepted, minimum=5)` and prefix supplemental `meta` with `近期补充`.

- [x] Add failing tests for guideline/consensus, surgical/video-article, and society-news/policy/clinical-update routing.
- [x] Confirm ambiguous items retain their configured source category and subgroup.
- [x] Implement deterministic routing after semantic acceptance; use source language/current China subgroup only to choose China versus international dynamics.
- [x] Exclude ordinary research articles instead of assigning them to a non-research column.
- [x] Make `groupRaw` derive an existing compatible subgroup after category changes.
- [x] Review priority candidates first and add newest accepted supplemental candidates only until the non-research total reaches five.
- [x] Run routing and render tests until green.

### Task 3: Vertically scoped semantic admission and regression verification

**Files:**
- Modify: `lib/sources/obgyn-filter.ts`
- Modify: `lib/ai/enrich.ts`
- Test: `tests/obgyn/filter.test.ts`

**Interfaces:**
- All non-general OB-GYN source classes may submit substantive ordinary content to semantic review without keyword hits.
- Ordinary content must receive `accepted`; `uncertain` remains available only to formal official documents.

- [x] Add failing tests for substantive ordinary content from official and academic OB-GYN sources without keyword hits.
- [x] Add a failing test that `uncertain` ordinary journal/news content is not displayed.
- [x] Implement the minimum admission changes without altering hard exclusions or general-authority AND filtering.
- [x] Extend existing history scanning with normalized-title identities while retaining canonical URLs.
- [x] Log final column counts; when fewer than three non-research articles remain, log at most twenty title/source/reason rows.
- [x] Run focused tests, then `npm.cmd test`, `npx.cmd tsc --noEmit`, `npm.cmd run sources:check`, and `git diff --check`.
