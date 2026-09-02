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
const attendanceAssetPath = path.resolve("public/assets/guide/attendance-qr.png");
const scoreboardAssetPath = path.resolve("public/assets/guide/live-clock.jpg");
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

async function loadPublicMatchDemoData() {
  const response = await fetch(`${readApiBaseUrl}/api/matches/public-detail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ matchId }),
  });
  if (!response.ok) throw new Error(`공개 경기 데이터 조회 실패: HTTP ${response.status}`);

  const state = (await response.json())?.state ?? {};
  const match = (state.matches ?? []).find((item) => String(item.id) === String(matchId));
  if (!match) throw new Error(`공개 경기 데이터에서 ${matchId}를 찾지 못했습니다.`);

  const activePlayerIds = new Set([
    ...(match.teamA?.players ?? []),
    ...(match.teamB?.players ?? []),
  ].map(String));
  const tierPlayer = (state.users ?? [])
    .filter((user) => activePlayerIds.has(String(user.id)))
    .filter((user) => {
      const placement = user.ratings?.placement;
      return !placement
        || placement.completed === true
        || Number(placement.matchCount) >= Math.max(1, Number(placement.target) || 5);
    })
    .filter((user) => Number.isFinite(Number(user.ratings?.integrated)))
    .sort((left, right) => Number(right.ratings.integrated) - Number(left.ratings.integrated))[0];
  if (!tierPlayer) throw new Error("녹화 경기 참가자 중 공개 티어를 확인할 수 있는 선수가 없습니다.");

  return { match, tierPlayer };
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
await Promise.all([
  access(receiptAssetPath),
  access(attendanceAssetPath),
  access(scoreboardAssetPath),
]);
const attendanceAssetDataUrl = `data:image/png;base64,${(await readFile(attendanceAssetPath)).toString("base64")}`;
const scoreboardAssetDataUrl = `data:image/jpeg;base64,${(await readFile(scoreboardAssetPath)).toString("base64")}`;
const demoMatchData = await loadPublicMatchDemoData();
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
      .box-tier-demo-cue[data-label-align="right"]::after {
        right: 0;
        left: auto;
        transform: none;
      }
      .box-tier-demo-cue[data-label-align="left"]::after {
        right: auto;
        left: 0;
        transform: none;
      }
      .box-tier-demo-product-visual {
        position: fixed;
        z-index: 2147483600;
        inset: 0;
        overflow: hidden;
        pointer-events: none;
        background: #111318;
        color: #fff;
        font-family: system-ui, sans-serif;
      }
      .box-tier-demo-product-frame {
        position: absolute;
        top: 160px;
        left: 14px;
        right: 14px;
        height: 560px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 18px;
        background: #08090b;
        box-shadow: 0 20px 50px rgba(0,0,0,.48);
      }
      .box-tier-demo-product-visual img {
        position: absolute;
        display: block;
        max-width: none;
        transition: left .7s ease-in-out;
      }
      .box-tier-demo-product-visual[data-kind="attendance"] img {
        top: -100px;
        left: -105px;
        width: 900px;
      }
      .box-tier-demo-product-visual[data-kind="attendance"][data-view="status"] img {
        left: -105px;
      }
      .box-tier-demo-product-visual[data-kind="scoreboard"] .box-tier-demo-product-frame {
        top: 180px;
        height: 470px;
      }
      .box-tier-demo-product-visual[data-kind="scoreboard"] img {
        top: 62px;
        left: -27px;
        width: 570px;
      }
      .box-tier-demo-product-note {
        position: absolute;
        left: 20px;
        right: 20px;
        top: 742px;
        color: rgba(255,255,255,.72);
        font-size: 13px;
        font-weight: 750;
        line-height: 1.45;
        text-align: center;
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

  window.__boxTierDemoShowProductVisual = ({ src, kind, note }) => {
    installStyle();
    document.querySelector(".box-tier-demo-product-visual")?.remove();
    const visual = document.createElement("section");
    visual.className = "box-tier-demo-product-visual";
    visual.dataset.kind = kind;
    visual.setAttribute("aria-hidden", "true");
    const frame = document.createElement("div");
    frame.className = "box-tier-demo-product-frame";
    const image = document.createElement("img");
    image.src = src;
    frame.append(image);
    const noteElement = document.createElement("p");
    noteElement.className = "box-tier-demo-product-note";
    noteElement.textContent = note;
    visual.append(frame, noteElement);
    document.body.append(visual);
  };
  window.__boxTierDemoSetProductView = (view) => {
    const visual = document.querySelector(".box-tier-demo-product-visual");
    if (visual) visual.dataset.view = view;
  };
  window.__boxTierDemoClearProductVisual = () => {
    document.querySelector(".box-tier-demo-product-visual")?.remove();
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
    const cueLeft = Math.max(8, bounds.left - padding);
    const cueRight = Math.min(innerWidth - 8, bounds.left + bounds.width + padding);
    const cueCenter = (cueLeft + cueRight) / 2;
    cue.style.left = `${cueLeft}px`;
    cue.style.top = `${Math.max(8, bounds.top - padding)}px`;
    cue.style.width = `${Math.max(0, cueRight - cueLeft)}px`;
    cue.style.height = `${bounds.height + padding * 2}px`;
    if (bounds.top < 150) cue.dataset.labelPlacement = "below";
    if (cueCenter > innerWidth - 90) cue.dataset.labelAlign = "right";
    if (cueCenter < 90) cue.dataset.labelAlign = "left";
    document.body.append(cue);
  };
  window.__boxTierDemoCueProductRegion = (region, label) => {
    const image = document.querySelector(".box-tier-demo-product-visual img");
    if (!image?.naturalWidth || !image?.naturalHeight) throw new Error("제품 이미지 좌표를 계산할 수 없습니다.");
    const bounds = image.getBoundingClientRect();
    window.__boxTierDemoCue({
      left: bounds.left + (region.left / image.naturalWidth) * bounds.width,
      top: bounds.top + (region.top / image.naturalHeight) * bounds.height,
      width: (region.width / image.naturalWidth) * bounds.width,
      height: (region.height / image.naturalHeight) * bounds.height,
    }, label);
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
  await target.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  });
  await wait(300);
  await target.evaluate((element, cueLabel) => {
    const bounds = element.getBoundingClientRect();
    window.__boxTierDemoCue(
      { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
      cueLabel,
    );
  }, label);
}

async function showProductVisual({ src, kind, note }) {
  await page.evaluate((visual) => window.__boxTierDemoShowProductVisual(visual), { src, kind, note });
  await wait(500);
}

async function cueProductBounds(bounds, label) {
  await page.evaluate(({ cueBounds, cueLabel }) => {
    window.__boxTierDemoCue(cueBounds, cueLabel);
  }, { cueBounds: bounds, cueLabel: label });
}

async function cueProductRegion(region, label) {
  await page.evaluate(({ cueRegion, cueLabel }) => {
    window.__boxTierDemoCueProductRegion(cueRegion, cueLabel);
  }, { cueRegion: region, cueLabel: label });
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
  await endScene("create-match", startedAt, 8_000);

  await caption(
    "비슷한 실력대끼리 모집",
    "경쟁전은 현재 MMR을 기준으로 참가 가능한 점수 범위를 보여줘 실력이 비슷한 상대를 모읍니다.",
  );
  startedAt = startScene();
  const matchCriteria = page.getByText(/SILVER 3 ~ GOLD 2 · 상세 산식 비공개/).first();
  await matchCriteria.waitFor({ timeout: 10_000 });
  await cueTarget(matchCriteria, "참가 가능한 MMR 범위");
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
    "QR로 현장 출석 확인",
    "경기 20분 전부터 등록 선수와 후보가 QR을 스캔하고, A/B 출석 인원을 같은 화면에서 확인합니다.",
  );
  startedAt = startScene();
  await showProductVisual({
    src: attendanceAssetDataUrl,
    kind: "attendance",
    note: "실제 BoxTier QR 출석판 · QR과 사이드별 출석 상태를 한 화면에서 확인",
  });
  await cueProductBounds({ left: 42, top: 210, width: 174, height: 190 }, "현장 QR 스캔");
  await wait(3_200);
  await page.evaluate(() => {
    window.__boxTierDemoClearCue();
    window.__boxTierDemoSetProductView("status");
  });
  await wait(800);
  await cueProductBounds({ left: 50, top: 340, width: 480, height: 72 }, "A/B 출석 현황");
  await wait(3_300);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("attendance", startedAt, 8_400);
  await page.evaluate(() => window.__boxTierDemoClearProductVisual());

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
    "담당자가 1Q 경기시간·양 팀 점수·샷클락을 한 화면에서 조작하고, 저장된 기록은 참가자 화면에 이어집니다.",
  );
  startedAt = startScene();
  await showProductVisual({
    src: scoreboardAssetDataUrl,
    kind: "scoreboard",
    note: "실제 BoxTier 모바일 전광판 · 경기시간, 점수, 샷클락을 현장에서 조작",
  });
  await cueProductRegion({ left: 310, top: 175, width: 300, height: 260 }, "1Q · 경기시간");
  await wait(2_800);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await cueProductRegion({ left: 62, top: 245, width: 798, height: 205 }, "양 팀 점수 · 득점 버튼");
  await wait(2_700);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await cueProductRegion({ left: 875, top: 225, width: 143, height: 245 }, "샷클락 30초");
  await wait(2_500);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("live-scoreboard", startedAt, 9_000);
  await page.evaluate(() => window.__boxTierDemoClearProductVisual());

  await caption("경기 종료 · 결과 확인", "종료된 경기의 최종 점수와 확정 기록을 검토합니다.");
  startedAt = startScene();
  const finalScore = matchRoom.locator(".arena-source-record-score strong").first();
  await finalScore.waitFor({ timeout: 10_000 });
  await cueTarget(finalScore, "최종 점수");
  await wait(3_200);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("final-result", startedAt, 5_800);

  await gotoApp(`/app/players/${encodeURIComponent(demoMatchData.tierPlayer.id)}`);
  await caption(
    "기록이 쌓이면 티어도 변화",
    "확정된 경쟁전 결과가 MMR에 반영되고, 누적 기록에 따라 현재 티어와 다음 승급 조건을 프로필에서 확인합니다.",
  );
  startedAt = startScene();
  const tierHero = page.locator(".player-tier-hero");
  await tierHero.waitFor({ timeout: 20_000 });
  await cueTarget(tierHero, `현재 티어 · ${Math.round(Number(demoMatchData.tierPlayer.ratings.integrated))} MMR`);
  await wait(3_200);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  const promotionHeading = page.getByRole("heading", { name: /승급 조건$|최상위 티어$/ }).first();
  await promotionHeading.waitFor({ timeout: 20_000 });
  await cueTarget(promotionHeading, "다음 티어 승급 조건");
  await wait(2_500);
  await page.evaluate(() => window.__boxTierDemoClearCue());
  await endScene("tier-update", startedAt, 7_000);

  await gotoApp(`/app/matches?match=${encodeURIComponent(matchId)}`);
  const receiptRoom = page.getByRole("dialog", { name: "매치방" });
  await receiptRoom.waitFor({ timeout: 20_000 });
  const receiptButton = receiptRoom.getByRole("button", { name: "영수증 발급", exact: true });
  await receiptButton.waitFor({ state: "visible", timeout: 20_000 });

  await caption(
    "기록방에서 영수증 만들기",
    "확정된 5v5 기록으로 감열지 영수증을 만들고 이미지·Story·Feed로 공유할 수 있습니다.",
  );
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
    attendanceAssetPath,
    scoreboardAssetPath,
    match: { id: matchId, mode: demoMatchData.match.mode },
    tierPlayer: {
      id: demoMatchData.tierPlayer.id,
      name: demoMatchData.tierPlayer.name,
      integratedMmr: Math.round(Number(demoMatchData.tierPlayer.ratings.integrated)),
    },
    facts: {
      create: "실제 공개 경쟁 개인방 생성 폼에서 5v5와 참가 가능한 MMR 범위를 확인하되 방을 생성하지 않습니다.",
      matching: "지역은 자동 배정이 아니라 공개 매칭 목록의 시·도/시·군·구 필터로 설명합니다.",
      room: "팀 구성과 최종 결과는 동일한 실제 5v5 기록방에서 읽기 전용으로 녹화합니다.",
      attendance: "서비스 사용 설명에 포함된 실제 QR 출석판 캡처로 QR과 A/B 출석 현황을 보여줍니다. 오래된 안내 문장 영역은 제외하고 현재 20분 전 기준을 설명합니다.",
      scoreboard: "서비스 사용 설명에 포함된 실제 모바일 전광판 캡처의 원본 좌표를 화면 좌표로 변환해 경기시간, 양 팀 점수 버튼, 샷클락을 정확히 강조합니다. 진행 중 점수 변경을 꾸미지 않습니다.",
      tier: "같은 5v5 경기의 실제 참가자 중 배치가 완료된 선수 프로필에서 현재 티어, 통합 MMR, 다음 티어 승급 조건을 보여줍니다.",
      receipt: "같은 5v5 기록방 모달의 실제 영수증 발급 버튼을 클릭하고, 이미지·Story·Feed 공유 흐름을 설명한 뒤 사용자가 제공한 감열지 완성 이미지를 사용합니다.",
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
