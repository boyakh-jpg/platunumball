import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = (process.env.BOXTIER_BASE_URL ?? "https://boxtier.kr").replace(/\/$/, "");
const readApiBaseUrl = (process.env.BOXTIER_READ_API_BASE_URL ?? baseUrl).replace(/\/$/, "");
const email = process.env.BOXTIER_DEMO_EMAIL;
const password = process.env.BOXTIER_DEMO_PASSWORD;
const liveMatchId = process.env.BOXTIER_LIVE_MATCH_ID ?? "m_mshmjm2k_lvd25";
const receiptMatchId = process.env.BOXTIER_RECEIPT_MATCH_ID ?? "tm_31b5b240e7876ae208743610";
const resultMatchId = process.env.BOXTIER_RESULT_MATCH_ID ?? receiptMatchId;
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

if (!email || !password) {
  throw new Error("BOXTIER_DEMO_EMAIL과 BOXTIER_DEMO_PASSWORD가 필요합니다.");
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

const productionEnv = parseEnv(await readFile(".env.production", "utf8"));
const supabaseUrl = productionEnv.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = productionEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!supabaseUrl || !supabaseKey) throw new Error(".env.production의 Supabase 설정을 찾지 못했습니다.");

const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: supabaseKey, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
if (!authResponse.ok) throw new Error(`데모 계정 로그인 실패: HTTP ${authResponse.status}`);
const session = await authResponse.json();

await mkdir(outputDir, { recursive: true });
await mkdir(path.dirname(receiptAssetPath), { recursive: true });
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
        border-left: 5px solid #ff7a1a;
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

  await gotoApp("/app/create?intent=record");
  await page.getByRole("button", { name: "경기 기록 만들기", exact: true }).waitFor({ timeout: 20_000 });
  await caption("경기 기록방 만들기", "경기 정보와 규칙을 입력해 실제 기록방을 엽니다.");
  let startedAt = startScene();
  await clickWithCue(page.getByRole("radio", { name: "5v5", exact: true }).first());
  await page.getByRole("button", { name: "경기 기록 만들기", exact: true }).scrollIntoViewIfNeeded();
  await endScene("create-room", startedAt, 4_600);

  await gotoApp(`/app/matches?match=${encodeURIComponent(liveMatchId)}`);
  await page.getByText("오늘의 2v2 픽업", { exact: false }).first().waitFor({ timeout: 20_000 });
  await caption("QR 출석 · 참가 확인", "QR 참가 확인 후 실제 경기방에서 출석 상태를 관리합니다.");
  startedAt = startScene();
  const attendanceButtons = page.getByRole("button", { name: "출석", exact: true });
  const attendanceCount = await attendanceButtons.count();
  for (let index = 0; index < Math.min(attendanceCount, 2); index += 1) {
    await showTapCue(attendanceButtons.nth(index), { cueMs: 700, settleMs: 750 });
  }
  await endScene("attendance", startedAt, 5_400);

  await caption("참가자 · 팀 구성", "출석한 선수를 기준으로 양 팀을 자동 배정할 수 있습니다.");
  startedAt = startScene();
  const assignmentPanel = page.locator('section[aria-label="출석 및 팀 배정 대상"]');
  await assignmentPanel.waitFor({ timeout: 10_000 });
  await cueTarget(assignmentPanel, "팀 배정 영역");
  await wait(2_200);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("team-assignment", startedAt, 4_400);

  await gotoApp(`/app/matches?match=${encodeURIComponent(resultMatchId)}`);
  const resultReceiptButton = page.getByRole("button", { name: "영수증 발급", exact: true });
  await resultReceiptButton.waitFor({ state: "visible", timeout: 20_000 });
  await caption("모바일 전광판 · 경기 결과", "경기 중 기록한 점수가 종료 후 같은 기록방의 최종 결과로 확정됩니다.");
  startedAt = startScene();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await endScene("live-scoreboard", startedAt, 6_500);

  await caption("경기 종료 · 결과 확인", "종료된 경기의 최종 점수와 확정 기록을 검토합니다.");
  startedAt = startScene();
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await endScene("final-result", startedAt, 4_200);

  await gotoApp(`/app/matches?match=${encodeURIComponent(receiptMatchId)}`);
  const issueReceipt = page.getByRole("button", { name: "영수증 발급", exact: true });
  await issueReceipt.waitFor({ timeout: 20_000 });
  await caption("기록방에서 영수증 만들기", "확정된 5v5 기록에서 실제 영수증 발급을 시작합니다.");
  startedAt = startScene();
  await clickWithCue(issueReceipt, { cueMs: 1_000, settleMs: 1_200 });
  await endScene("receipt-entry", startedAt, 4_000);

  await page.getByText("경기 영수증", { exact: true }).first().waitFor({ timeout: 20_000 });
  const periodScores = [[0, 0], [1, 0], [0, 0], [0, 0]];
  for (const [index, [teamAScore, teamBScore]] of periodScores.entries()) {
    const period = index + 1;
    await page.getByLabel(`${period}Q TEAM A 점수`, { exact: true }).fill(String(teamAScore));
    await page.getByLabel(`${period}Q TEAM B 점수`, { exact: true }).fill(String(teamBScore));
  }
  const thermalButton = page.getByRole("button", { name: "감열지 영수증", exact: true });
  await caption("4쿼터 감열지 영수증", "1Q–4Q 점수와 최종 결과를 실제 제품 미리보기에서 확인합니다.");
  startedAt = startScene();
  await clickWithCue(thermalButton, { cueMs: 1_000, settleMs: 1_000 });
  const thermalReceipt = page.getByRole("img", { name: "감열지 영수증 미리보기", exact: true });
  await thermalReceipt.waitFor({ state: "visible", timeout: 20_000 });
  await thermalReceipt.scrollIntoViewIfNeeded();
  await thermalReceipt.screenshot({ path: receiptAssetPath });
  await endScene("thermal-receipt", startedAt, 5_600);

  await page.close();
  await video.saveAs(rawVideoPath);
  await context.close();
  await browser.close();

  const metadata = {
    capturedAt: new Date().toISOString(),
    baseUrl,
    readApiBaseUrl,
    viewport: { width: 540, height: 960 },
    rawVideoPath,
    receiptAssetPath,
    matches: { liveMatchId, resultMatchId, receiptMatchId },
    facts: {
      create: "실제 기록방 생성 폼을 조작하되 추가 방은 생성하지 않습니다.",
      live: "운영 테스트 계정의 실제 경기방에서 출석·팀 배정 위치를 안내하고 공유 데이터는 변경하지 않습니다.",
      scoreboard: "캡처 시점에 진행 중인 테스트 경기가 없어 종료·확정된 실제 기록방의 모바일 결과를 읽기 전용으로 녹화합니다.",
      receipt: "실제 5v5 기록방의 영수증 발급 화면에서 4쿼터 점수를 입력하고 제품 감열지 미리보기를 캡처합니다.",
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
