import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("privacy and terms are public SPA routes", async () => {
  const [app, vercel] = await Promise.all([read("src/App.jsx"), read("vercel.json")]);

  assert.match(app, /path="\/privacy" element=\{<Privacy \/>\}/);
  assert.match(app, /path="\/terms" element=\{<Terms \/>\}/);
  assert.match(app, /<Route element=\{<PublicShell \/>\}>[\s\S]*path="\/privacy"[\s\S]*path="\/terms"/);

  const config = JSON.parse(vercel);
  const rewrites = new Map(config.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]));
  assert.equal(rewrites.get("/privacy"), "/index.html");
  assert.equal(rewrites.get("/terms"), "/index.html");
});

test("public footer and login expose both legal documents", async () => {
  const [footer, login] = await Promise.all([
    read("src/components/layout/DataAttribution.jsx"),
    read("src/pages/Login.jsx"),
  ]);

  for (const path of ["/privacy", "/terms"]) {
    assert.match(footer, new RegExp(`to="${path}"`));
    assert.match(login, new RegExp(`to="${path}"`));
  }
});

test("legal documents include required operating disclosures without placeholders", async () => {
  const [privacy, terms] = await Promise.all([
    read("src/pages/Privacy.jsx"),
    read("src/pages/Terms.jsx"),
  ]);

  for (const required of [
    "처리 목적·항목·보유기간",
    "제3자 제공",
    "처리위탁과 국외 이전",
    "쿠키·브라우저 저장소",
    "이용자와 법정대리인의 권리",
    "만 14세 미만 이용자",
    "파기와 안전조치",
    "privacy@boxtier.kr",
  ]) {
    assert.ok(privacy.includes(required), `privacy disclosure missing: ${required}`);
  }

  for (const required of [
    "계정과 이용자 자격",
    "경기 참가와 안전",
    "기록·랭킹·신뢰도",
    "금지행위",
    "비용과 결제",
    "준거법과 분쟁",
  ]) {
    assert.ok(terms.includes(required), `terms disclosure missing: ${required}`);
  }

  assert.doesNotMatch(`${privacy}\n${terms}`, /TODO|TBD|example\.com|입력 필요|추후 기재/i);
});
