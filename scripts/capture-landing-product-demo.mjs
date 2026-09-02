import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = (process.env.BOXTIER_BASE_URL ?? "https://boxtier.kr").replace(/\/$/, "");
const readApiBaseUrl = (process.env.BOXTIER_READ_API_BASE_URL ?? baseUrl).replace(/\/$/, "");
const email = process.env.BOXTIER_DEMO_EMAIL;
const password = process.env.BOXTIER_DEMO_PASSWORD;
const matchId = process.env.BOXTIER_DEMO_MATCH_ID ?? "tm_31b5b240e7876ae208743610";
const outputDir = path.resolve("tmp/landing-product-demo");
const rawVideoPath = path.join(outputDir, "landing-product-demo-raw.webm");
const metadataPath = path.join(outputDir, "capture.json");
const receiptAssetPath = path.resolve("public/assets/showcase/landing-product-demo-receipt.png");
const browserCandidates = [
  process.env.BOXTIER_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

if (Boolean(email) !== Boolean(password)) {
  throw new Error("BOXTIER_DEMO_EMAIL과 BOXTIER_DEMO_PASSWORD는 함께 지정해야 합니다.");
}

async function firstAvailablePath(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // 다음 설치 경로를 확인한다.
    }
  }
  throw new Error("Edge 또는 Chrome 실행 파일을 찾지 못했습니다. BOXTIER_BROWSER_PATH를 지정하세요.");
}

function parseEnv(source) {
  return Object.fromEntries(source.split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf("=");
    if (separator < 1 || line.trimStart().startsWith("#")) return [];
    return [[line.slice(0, separator), line.slice(separator + 1).replace(/^['\"]|['\"]$/g, "")]];
  }));
}

let supabaseUrl;
let session;
if (email && password) {
  const productionEnv = parseEnv(await readFile(".env.production", "utf8"));
  supabaseUrl = productionEnv.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = productionEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !supabaseKey) throw new Error(".env.production의 Supabase 설정을 찾지 못했습니다.");

  const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabaseKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!authResponse.ok) throw new Error(`데모 계정 로그인 실패: HTTP ${authResponse.status}`);
  session = await authResponse.json();
}

await mkdir(outputDir, { recursive: true });
await access(receiptAssetPath);
const executablePath = await firstAvailablePath(browserCandidates);
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({
  viewport: { width: 540, height: 960 },
  screen: { width: 540, height: 960 },
  colorScheme: "dark",
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: outputDir, size: { width: 540, height: 960 } },
});

if (readApiBaseUrl !== baseUrl) {
  const readOnlyApiPaths = new Set([
    "/api/matches/detail",
    "/api/matches/public-detail",
  ]);
  await context.route("**/api/**", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    const pathname = requestUrl.pathname;
    if (
      request.method() !== "POST"
      || !readOnlyApiPaths.has(pathname)
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    const requestHeaders = { ...request.headers() };
    delete requestHeaders.host;
    delete requestHeaders.origin;
    const response = await fetch(`${readApiBaseUrl}${pathname}`, {
      method: "POST",
      headers: requestHeaders,
      body: request.postDataBuffer(),
    });
    const responseHeaders = Object.fromEntries(response.headers.entries());
    // fetch() has already decoded the upstream body. Do not make the browser
    // try to decode the fulfilled response a second time.
    delete responseHeaders["content-encoding"];
    delete responseHeaders["content-length"];
    delete responseHeaders["transfer-encoding"];
    delete responseHeaders.connection;
    console.log(JSON.stringify({ readProxy: pathname, status: response.status }));
    await route.fulfill({
      status: response.status,
      headers: responseHeaders,
      body: Buffer.from(await response.arrayBuffer()),
    });
  });
}

await context.addInitScript(() => {
  const styleId = "box-tier-demo-overlay-style";

  function installStyle() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .box-tier-demo-caption {
        position: fixed;
        z-index: 2147483647;
        top: max(14px, env(safe-area-inset-top));
        left: 14px;
        right: 14px;
        padding: 13px 15px 14px;
        pointer-events: none;
        border: 1px solid rgba(255,255,255,.15);
        border-radius: 14px;
        background: rgba(13,15,19,.94);
        box-shadow: 0 10px 30px rgba(0,0,0,.4);
        color: #fff;
        font-family: system-ui, sans-serif;
      }
      .box-tier-demo-caption strong {
        display: block;
        margin-bottom: 5px;
        color: #ff9b52;
        font-size: 18px;
        line-height: 1.2;
      }
      .box-tier-demo-caption span {
        display: block;
        color: rgba(255,255,255,.88);
        font-size: 13px;
        font-weight: 650;
        line-height: 1.45;
      }
      .box-tier-demo-tap {
        position: fixed;
        z-index: 2147483647;
        width: 46px;
        height: 46px;
        pointer-events: none;
        border: 3px solid #ff7a1a;
        border-radius: 999px;
        box-shadow: 0 0 0 8px rgba(255,122,26,.24);
        transform: translate(-50%, -50%) scale(.3);
        animation: box-tier-demo-tap 1.15s ease-out forwards;
      }
      .box-tier-demo-cue {
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
        border: 3px solid #ff7a1a;
        border-radius: 12px;
        background: rgba(255,122,26,.12);
        box-shadow: 0 0 0 7px rgba(255,122,26,.2);
        animation: box-tier-demo-cue .7s ease-in-out infinite alternate;
      }
      .box-tier-demo-cue::after {
        content: attr(data-label);
        position: absolute;
        left: 50%;
        bottom: calc(100% + 10px);
        transform: translateX(-50%);
        padding: 6px 11px;
        border-radius: 999px;
        background: #ff7a1a;
        color: #111;
        font: 850 13px/1 system-ui, sans-serif;
        white-space: nowrap;
      }
      .box-tier-demo-cue[data-label-placement="below"]::after {
        top: calc(100% + 10px);
        bottom: auto;
      }
      @keyframes box-tier-demo-tap {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(.3); }
        14% { opacity: 1; }
        58% { opacity: .72; }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1.4); }
      }
      @keyframes box-tier-demo-cue { from { opacity: .7; } to { opacity: 1; } }
    `;
    document.head.append(style);
  }

  window.__boxTierDemoCaption = (title, body) => {
    installStyle();
    document.querySelector(".box-tier-demo-caption")?.remove();
    const caption = document.createElement("aside");
    caption.className = "box-tier-demo-caption";
    caption.setAttribute("aria-hidden", "true");
    const heading = document.createElement("strong");
    const description = document.createElement("span");
    heading.textContent = title;
    description.textContent = body;
    caption.append(heading, description);
    document.body.append(caption);
  };

  window.__boxTierDemoClearCue = () => document.querySelector(".box-tier-demo-cue")?.remove();
  window.__boxTierDemoTap = (x, y) => {
    installStyle();
    const tap = document.createElement("span");
    tap.className = "box-tier-demo-tap";
    tap.style.left = `${x}px`;
    tap.style.top = `${y}px`;
    document.body.append(tap);
    tap.addEventListener("animationend", () => tap.remove(), { once: true });
  };
  window.__boxTierDemoCue = (bounds, label = "여기 탭") => {
    installStyle();
    window.__boxTierDemoClearCue();
    const padding = 6;
    const cue = document.createElement("span");
    cue.className = "box-tier-demo-cue";
    cue.setAttribute("aria-hidden", "true");
    cue.dataset.label = label;
    cue.style.left = `${Math.max(8, bounds.left - padding)}px`;
    cue.style.top = `${Math.max(8, bounds.top - padding)}px`;
    cue.style.width = `${Math.min(innerWidth - 16, bounds.width + padding * 2)}px`;
    cue.style.height = `${bounds.height + padding * 2}px`;
    if (bounds.top < 150) cue.dataset.labelPlacement = "below";
    document.body.append(cue);
  };
  document.addEventListener("pointerdown", (event) => {
    window.__boxTierDemoTap(event.clientX, event.clientY);
  }, true);
});

const page = await context.newPage();
page.on("dialog", (dialog) => dialog.accept());
const video = page.video();
const captureStartedAt = Date.now();
const scenes = [];
const wait = (milliseconds) => page.waitForTimeout(milliseconds);

async function authenticate() {
  if (!session) return;
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
  await page.evaluate(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), {
    key: storageKey,
    value: session,
  });
}

async function gotoApp(route) {
  await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
  await wait(1_500);
}

async function caption(title, body) {
  await page.evaluate(({ heading, description }) => {
    window.__boxTierDemoCaption(heading, description);
  }, { heading: title, description: body });
}

async function cueTarget(target, label = "여기 탭") {
  await target.scrollIntoViewIfNeeded();
  await wait(180);
  await target.evaluate((element, cueLabel) => {
    const bounds = element.getBoundingClientRect();
    window.__boxTierDemoCue(
      { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
      cueLabel,
    );
  }, label);
}

async function clickWithCue(target, { cueMs = 800, settleMs = 900 } = {}) {
  await cueTarget(target);
  await wait(cueMs);
  await target.evaluate(() => window.__boxTierDemoClearCue());
  await target.click();
  await wait(settleMs);
}

async function showTapCue(target, { cueMs = 900, settleMs = 850 } = {}) {
  await cueTarget(target);
  await wait(cueMs);
  await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    window.__boxTierDemoClearCue();
    window.__boxTierDemoTap(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
  });
  await wait(settleMs);
}

function startScene() {
  return Date.now();
}

async function endScene(name, startedAt, minimumDurationMs) {
  const elapsed = Date.now() - startedAt;
  if (elapsed < minimumDurationMs) await wait(minimumDurationMs - elapsed);
  scenes.push({
    name,
    start: (startedAt - captureStartedAt) / 1000,
    duration: (Date.now() - startedAt) / 1000,
    url: page.url(),
  });
}

try {
  await authenticate();

  await gotoApp("/app/create?intent=match");
  const publicMatchButton = page.getByRole("button", { name: /^공개 매칭방/ });
  await publicMatchButton.waitFor({ timeout: 20_000 });
  await caption(
    "공개 5v5 경쟁방 만들기",
    "공개방·경쟁전·개인전·5v5를 고르면 매칭 목록에서 참가자를 모집합니다.",
  );
  let startedAt = startScene();
  await clickWithCue(publicMatchButton, { cueMs: 1_000, settleMs: 700 });
  await clickWithCue(page.getByRole("radio", { name: "5v5", exact: true }).first(), {
    cueMs: 1_000,
    settleMs: 700,
  });
  const competitiveOption = page.getByRole("radio", { name: /^경쟁전/ });
  await cueTarget(competitiveOption, "MMR 반영 경쟁전");
  await wait(2_300);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("create-match", startedAt, 7_200);

  await caption(
    "티어에 맞는 상대 모집",
    "MMR은 실력이 비슷한 상대를 찾고 순위를 계산하는 경기력 점수입니다. 공개 경쟁 개인방은 허용구간 안에서 모집합니다.",
  );
  startedAt = startScene();
  const matchCriteria = page.getByText(/SILVER 3 ~ GOLD 2 · 상세 산식 비공개/).first();
  await matchCriteria.waitFor({ timeout: 10_000 });
  await cueTarget(matchCriteria, "실력 허용구간");
  await wait(4_600);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("tier-match", startedAt, 6_500);

  await gotoApp("/app/recruiting");
  await caption(
    "지역별 공개방 찾기",
    "시·도와 시·군·구 필터로 가까운 코트의 공개 매칭방을 찾습니다.",
  );
  startedAt = startScene();
  const cityFilter = page.getByRole("combobox", { name: "시도" });
  await cityFilter.waitFor({ timeout: 20_000 });
  await showTapCue(cityFilter, { cueMs: 1_100, settleMs: 300 });
  await cityFilter.selectOption({ label: "부산광역시" });
  await wait(800);
  const districtFilter = page.getByRole("combobox", { name: "시군구" });
  await showTapCue(districtFilter, { cueMs: 1_100, settleMs: 300 });
  await districtFilter.selectOption({ label: "중구" });
  await cueTarget(districtFilter, "지역 필터");
  await wait(2_100);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("region-filter", startedAt, 6_500);

  await gotoApp(`/app/matches?match=${encodeURIComponent(matchId)}`);
  const matchRoom = page.getByRole("dialog", { name: "매치방" });
  await matchRoom.waitFor({ timeout: 20_000 });
  await matchRoom.getByText("5v5", { exact: true }).first().waitFor({ timeout: 20_000 });
  await caption(
    "경기 20분 전 QR 체크인",
    "등록 선수와 후보가 QR로 출석하면 운영자가 실제 참가 명단과 미출석자를 확인합니다.",
  );
  startedAt = startScene();
  const attendanceRule = matchRoom.getByText("경기 20분 전부터", { exact: false }).first();
  await attendanceRule.waitFor({ timeout: 10_000 });
  await cueTarget(attendanceRule, "QR 출석 기준");
  await wait(4_500);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("attendance", startedAt, 7_000);

  await caption(
    "5v5 참가 확인 · 팀 구성",
    "출석한 선수의 포지션과 출전·후보 상태를 확인하고 양쪽 5명 구성을 맞춥니다.",
  );
  startedAt = startScene();
  const homeTeam = matchRoom.getByText("HOME TEAM", { exact: true }).first();
  await homeTeam.waitFor({ timeout: 10_000 });
  await cueTarget(homeTeam, "5v5 팀 구성");
  await wait(3_900);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("team-assignment", startedAt, 6_200);

  const resultReceiptButton = matchRoom.getByRole("button", { name: "영수증 발급", exact: true });
  await resultReceiptButton.waitFor({ state: "visible", timeout: 20_000 });
  await caption(
    "휴대폰이 모바일 전광판",
    "4쿼터 경기시계와 양 팀 점수를 현장에서 운영하고, 저장된 점수는 참가자 화면에 이어집니다.",
  );
  startedAt = startScene();
  const scoreboardHelp = matchRoom.getByText("BOXTIER 모바일 전광판", { exact: true }).first();
  await scoreboardHelp.waitFor({ timeout: 10_000 });
  await cueTarget(scoreboardHelp, "모바일 전광판");
  await wait(5_000);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("live-scoreboard", startedAt, 7_500);

  await caption("경기 종료 · 결과 확인", "종료된 경기의 최종 점수와 확정 기록을 검토합니다.");
  startedAt = startScene();
  const finalScore = matchRoom.locator(".arena-source-record-score strong").first();
  await finalScore.waitFor({ timeout: 10_000 });
  await cueTarget(finalScore, "최종 점수");
  await wait(3_200);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("final-result", startedAt, 5_800);

  await gotoApp("/app/rankings");
  await caption(
    "기록이 쌓이면 티어도 변화",
    "확정된 경쟁전 결과를 서버가 계산해 통합·경기 방식별 MMR과 티어, 랭크보드를 갱신합니다.",
  );
  startedAt = startScene();
  const integratedRanking = page.getByRole("heading", { name: "전국 통합 MMR", exact: true });
  await integratedRanking.waitFor({ timeout: 20_000 });
  await cueTarget(integratedRanking, "통합 MMR 랭크보드");
  await wait(4_900);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("tier-update", startedAt, 7_000);

  await gotoApp(`/app/matches?match=${encodeURIComponent(matchId)}`);
  const receiptRoom = page.getByRole("dialog", { name: "매치방" });
  await receiptRoom.waitFor({ timeout: 20_000 });
  const receiptButton = receiptRoom.getByRole("button", { name: "영수증 발급", exact: true });
  await receiptButton.waitFor({ state: "visible", timeout: 20_000 });

  await caption("기록방에서 영수증 만들기", "같은 5v5 기록방 모달의 실제 영수증 발급 버튼을 누릅니다.");
  startedAt = startScene();
  await cueTarget(receiptButton);
  await wait(4_500);
  await receiptButton.evaluate(() => window.__boxTierDemoClearCue());
  await receiptButton.click({ noWaitAfter: true });
  await wait(150);
  await endScene("receipt-entry", startedAt, 5_500);

  await page.close();
  await video.saveAs(rawVideoPath);
  await context.close();
  await browser.close();

  const metadata = {
    capturedAt: new Date().toISOString(),
    baseUrl,
    readApiBaseUrl,
    authenticated: Boolean(session),
    viewport: { width: 540, height: 960 },
    captionAccentRemoved: true,
    rawVideoPath,
    receiptAssetPath,
    match: { id: matchId, mode: "5v5" },
    facts: {
      create: "실제 공개 경쟁 개인방 생성 폼에서 5v5와 MMR 허용구간을 확인하되 방을 생성하지 않습니다.",
      matching: "지역은 자동 배정이 아니라 공개 매칭 목록의 시·도/시·군·구 필터로 설명합니다.",
      room: "출석 기준, 팀 구성, 모바일 전광판 안내, 최종 결과를 동일한 실제 5v5 기록방에서 읽기 전용으로 녹화합니다.",
      scoreboard: "캡처 시점에 진행 중인 테스트 경기가 없어 종료·확정된 기록방이 안내하는 실제 모바일 전광판 흐름을 보여줍니다. 진행 중 조작을 꾸미지 않습니다.",
      tier: "확정 경쟁전 결과가 서버 계산을 거쳐 통합·경기 방식별 MMR과 티어에 반영된다는 정책과 실제 통합 랭크보드를 보여줍니다. 비어 있는 5v5 순위를 꾸미지 않습니다.",
      receipt: "같은 5v5 기록방 모달의 실제 영수증 발급 버튼을 클릭하고, 마지막 감열지는 사용자가 제공한 완성 이미지를 사용합니다.",
    },
    scenes,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify({ rawVideoPath, metadataPath, receiptAssetPath, sceneCount: scenes.length }, null, 2));
} catch (error) {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  throw error;
}
