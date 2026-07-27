import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("privacy and terms are public SPA routes", async () => {
  const [app, vercel, vite] = await Promise.all([
    read("src/App.jsx"),
    read("vercel.json"),
    read("vite.config.js"),
  ]);

  assert.match(app, /path="\/privacy" element=\{<Privacy \/>\}/);
  assert.match(app, /path="\/terms" element=\{<Terms \/>\}/);
  assert.match(app, /<Route element=\{<PublicShell \/>\}>[\s\S]*path="\/privacy"[\s\S]*path="\/terms"/);

  const config = JSON.parse(vercel);
  const rewrites = new Map(config.rewrites.map((rewrite) => [rewrite.source, rewrite.destination]));
  assert.equal(rewrites.get("/privacy"), "/privacy.html");
  assert.equal(rewrites.get("/terms"), "/terms.html");
  assert.match(vite, /privacy:\s*resolve\(process\.cwd\(\), "privacy\.html"\)/);
  assert.match(vite, /terms:\s*resolve\(process\.cwd\(\), "terms\.html"\)/);
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

test("OAuth homepage identifies BOXTIER, explains its purpose, and links the privacy policy", async () => {
  const [landing, footer, index] = await Promise.all([
    read("src/pages/Landing.jsx"),
    read("src/components/layout/DataAttribution.jsx"),
    read("index.html"),
  ]);

  assert.match(landing, /landing-compact-summary/);
  assert.doesNotMatch(landing, /BASKETBALL MATCH &amp; RECORD PLATFORM/);
  assert.match(landing, /농구 경기 모집 · 기록 · MMR 랭킹 · 팀 운영/);
  assert.match(footer, /to="\/privacy"/);
  assert.match(index, /content="BOXTIER - 농구 경기를 기록하고 팀과 티어를 관리하는 농구 플랫폼"/);
  assert.match(index, /<meta name="application-name" content="BOXTIER" \/>/);
  assert.match(index, /<link rel="canonical" href="https:\/\/boxtier\.kr\/" \/>/);
  assert.match(index, /<title>BOXTIER<\/title>/);
  assert.match(index, /<p class="oauth-static-brand">BOXTIER<\/p>/);
  assert.match(index, /Google 로그인에서 제공되는 계정 식별자, 이메일, 이름과 프로필 이미지/);
  assert.match(index, /<a href="\/privacy">개인정보처리방침<\/a>/);
});

test("OAuth legal URLs have dedicated non-JavaScript HTML disclosures", async () => {
  const [privacyHtml, termsHtml, main] = await Promise.all([
    read("privacy.html"),
    read("terms.html"),
    read("src/main.jsx"),
  ]);

  for (const required of [
    "BOXTIER 개인정보처리방침",
    "Google 로그인 데이터",
    "계정 식별자, 이메일, 이름과 프로필 이미지",
    "회원 식별, 계정 생성과 로그인에만 사용",
    "판매하거나 광고, 신용평가 또는 AI 모델 학습에 사용하지 않습니다",
    "privacy@boxtier.kr",
  ]) {
    assert.ok(privacyHtml.includes(required), `static privacy disclosure missing: ${required}`);
  }

  assert.match(termsHtml, /BOXTIER 서비스 약관/);
  assert.match(termsHtml, /필수 웹 기능은 평생 무료/);
  assert.match(termsHtml, /href="\/privacy">개인정보처리방침<\/a>/);
  assert.match(main, /rootElement\.replaceChildren\(\)/);
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
    "필수 웹 기능은 평생 무료",
    "준거법과 분쟁",
  ]) {
    assert.ok(terms.includes(required), `terms disclosure missing: ${required}`);
  }

  assert.doesNotMatch(`${privacy}\n${terms}`, /TODO|TBD|example\.com|입력 필요|추후 기재/i);
});
