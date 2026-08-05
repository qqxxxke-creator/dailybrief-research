import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyDocumentType,
  hasSubstantiveContent,
  isOfficialFormalDocument,
} from "../../lib/sources/content-policy";
import { loadAllSources } from "../../lib/sources/registry";
import type { RawArticle, SourceDef } from "../../lib/sources/types";

const officialSource: SourceDef = {
  id: "acog-clinical-guidance",
  name: "ACOG Clinical Guidance",
  type: "scrape",
  url: "https://www.acog.org/clinical/clinical-guidance",
  category: "tech",
  sourceClass: "official_authority",
};

const journalSource: SourceDef = {
  ...officialSource,
  id: "jmig-articles-in-press",
  name: "Journal of Minimally Invasive Gynecology",
  sourceClass: "academic_journal",
};

function article(title: string, overrides: Partial<RawArticle> = {}): RawArticle {
  return {
    sourceId: officialSource.id,
    title,
    url: "https://www.acog.org/clinical/example",
    publishedAt: new Date("2026-08-05T00:00:00.000Z"),
    category: "tech",
    ...overrides,
  };
}

test("classifies official formal documents by item type, not institution id", () => {
  assert.equal(classifyDocumentType(article("ACOG Practice Advisory")), "practice_advisory");
  assert.equal(classifyDocumentType(article("ACOG webinar registration")), "education");
});

test("prioritizes structured document type over title patterns", () => {
  assert.equal(
    classifyDocumentType(article("Practice Advisory: maternal health", { documentType: "news" })),
    "news",
  );
});

test("allows title-only fallback only for official formal documents", () => {
  const formalArticle = article("Practice Advisory: maternal health");
  const videoArticle = article("ACOG video overview");

  assert.equal(isOfficialFormalDocument(formalArticle, officialSource), true);
  assert.equal(isOfficialFormalDocument(videoArticle, officialSource), false);
  assert.equal(isOfficialFormalDocument(formalArticle, journalSource), false);
});

test("hard-excludes non-formal conflicts before formal document patterns", () => {
  for (const title of [
    "Practice Advisory webinar registration",
    "Practice Advisory: patient education",
    "Sponsored Practice Advisory",
    "Practice Advisory 招聘",
    "Practice Advisory 采购",
    "Practice Advisory 无实质活动",
    "Practice Advisory hospital promotion",
    "Practice Advisory hospital publicity",
    "Practice Advisory department promotion",
    "Practice Advisory clinic promotion",
    "Practice Advisory 医院宣传",
    "Practice Advisory 科室宣传",
  ]) {
    const conflictingArticle = article(title);
    assert.ok(
      !["guideline", "consensus", "statement", "practice_advisory", "safety_alert", "policy"].includes(
        classifyDocumentType(conflictingArticle),
      ),
      `${title} must not classify as a formal document`,
    );
    assert.equal(isOfficialFormalDocument(conflictingArticle, officialSource), false, title);
  }
});

test("hard-excludes formal structured metadata when item metadata signals non-formal content", () => {
  const conflictingArticle = article("Practice Advisory: maternal health", {
    documentType: "practice_advisory",
    meta: "Sponsored patient education webinar registration",
  });

  assert.ok(
    !["guideline", "consensus", "statement", "practice_advisory", "safety_alert", "policy"].includes(
      classifyDocumentType(conflictingArticle),
    ),
  );
  assert.equal(isOfficialFormalDocument(conflictingArticle, officialSource), false);
});

test("does not mistake a normal clinical department reference for promotion", () => {
  const formalArticle = article("Practice Advisory: clinical department implementation");

  assert.equal(classifyDocumentType(formalArticle), "practice_advisory");
  assert.equal(isOfficialFormalDocument(formalArticle, officialSource), true);
});

test("requires an official host, valid date, and original URL for title-only fallback", () => {
  const formalArticle = article("Practice Advisory: maternal health");

  assert.equal(isOfficialFormalDocument({ ...formalArticle, url: "https://other.example/advisory" }, officialSource), false);
  assert.equal(isOfficialFormalDocument({ ...formalArticle, url: "not a url" }, officialSource), false);
  assert.equal(isOfficialFormalDocument({ ...formalArticle, publishedAt: undefined }, officialSource), false);
  assert.equal(isOfficialFormalDocument({ ...formalArticle, publishedAt: new Date("invalid") }, officialSource), false);
});

test("recognizes excerpts and declared content types as substantive content", () => {
  assert.equal(hasSubstantiveContent(article("News", { excerpt: "A clinically relevant update." })), true);
  assert.equal(hasSubstantiveContent(article("News", { contentType: "abstract" })), true);
  assert.equal(hasSubstantiveContent(article("News", { excerpt: "   " })), false);
});

test("declares every configured source class explicitly", () => {
  const sources = loadAllSources();
  assert.ok(sources.every((source) => source.sourceClass));

  const sourceClassById = new Map(sources.map((source) => [source.id, source.sourceClass]));
  assert.equal(sourceClassById.get("acog-clinical-guidance"), "official_authority");
  assert.equal(sourceClassById.get("gocm-guidelines"), "academic_journal");
  assert.equal(sourceClassById.get("jmig-articles-in-press"), "academic_journal");
  assert.equal(sourceClassById.get("aagl-surgeryu"), "professional_vertical");
  assert.equal(sourceClassById.get("who-maternal-health"), "general_authority");
  assert.equal(sourceClassById.get("fda-owh-news"), "general_authority");
});
