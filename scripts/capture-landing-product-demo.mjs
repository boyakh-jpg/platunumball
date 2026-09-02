import { access, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = (process.env.BOXTIER_BASE_URL ?? "http://127.0.0.1:4176").replace(/\/$/, "");
const outputDir = path.resolve("tmp/landing-product-demo");
const rawVideoPath = path.join(outputDir, "landing-product-demo-raw.webm");
const metadataPath = path.join(outputDir, "capture.json");
const browserCandidates = [
  process.env.BOXTIER_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

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

await mkdir(outputDir, { recursive: true });
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
await context.addInitScript(() => {
  const styleId = "box-tier-demo-tap-style";

  function installStyle() {
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent = `
      .box-tier-demo-tap {
        position: fixed;
        z-index: 2147483647;
        width: 44px;
        height: 44px;
        pointer-events: none;
        border: 3px solid var(--orange-2);
        border-radius: 999px;
        box-shadow: 0 0 0 7px color-mix(in srgb, var(--orange-2) 22%, transparent);
        transform: translate(-50%, -50%) scale(0.3);
        animation: box-tier-demo-tap 1.2s ease-out forwards;
      }

      .box-tier-demo-cue {
        position: fixed;
        z-index: 2147483646;
        pointer-events: none;
        border: 3px solid var(--orange-2);
        border-radius: 12px;
        background: color-mix(in srgb, var(--orange-2) 10%, transparent);
        box-shadow: 0 0 0 6px color-mix(in srgb, var(--orange-2) 18%, transparent);
        animation: box-tier-demo-cue 0.7s ease-in-out infinite alternate;
      }

      .box-tier-demo-cue::after {
        content: "여기 탭";
        position: absolute;
        left: 50%;
        bottom: calc(100% + 10px);
        transform: translateX(-50%);
        padding: 5px 10px;
        border-radius: 999px;
        background: var(--orange-2);
        color: var(--bg);
        font: 800 13px/1 system-ui, sans-serif;
        white-space: nowrap;
      }

      .box-tier-demo-cue[data-label-placement="below"]::after {
        top: calc(100% + 10px);
        bottom: auto;
      }

      @keyframes box-tier-demo-tap {
        0% { opacity: 0; transform: translate(-50%, -50%) scale(0.3); }
        12% { opacity: 1; }
        58% { opacity: 0.72; }
        100% { opacity: 0; transform: translate(-50%, -50%) scale(1.35); }
      }

      @keyframes box-tier-demo-cue {
        from { opacity: 0.72; }
        to { opacity: 1; }
      }
    `;
    document.head.append(style);
  }

  window.__boxTierDemoTap = (x, y) => {
    installStyle();
    const tap = document.createElement("span");
    tap.className = "box-tier-demo-tap";
    tap.style.left = `${x}px`;
    tap.style.top = `${y}px`;
    document.body.append(tap);
    tap.addEventListener("animationend", () => tap.remove(), { once: true });
  };

  window.__boxTierDemoClearCue = () => {
    document.querySelector(".box-tier-demo-cue")?.remove();
  };

  window.__boxTierDemoCue = (bounds) => {
    installStyle();
    window.__boxTierDemoClearCue();
    const padding = 6;
    const cue = document.createElement("span");
    cue.className = "box-tier-demo-cue";
    cue.setAttribute("aria-hidden", "true");
    cue.style.left = `${Math.max(8, bounds.left - padding)}px`;
    cue.style.top = `${Math.max(8, bounds.top - padding)}px`;
    cue.style.width = `${Math.min(innerWidth - 16, bounds.width + padding * 2)}px`;
    cue.style.height = `${bounds.height + padding * 2}px`;
    if (bounds.top < 72) cue.dataset.labelPlacement = "below";
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

const wait = (milliseconds = 450) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function clickText(text, selector = "button") {
  await page.waitForFunction(
    ({ expected, query }) => [...document.querySelectorAll(query)].some((element) => element.innerText?.trim() === expected),
    { expected: text, query: selector },
  );
  await page.evaluate(
    ({ expected, query }) => {
      const target = [...document.querySelectorAll(query)].find((element) => element.innerText?.trim() === expected);
      target.scrollIntoView({ block: "center", inline: "center" });
      const bounds = target.getBoundingClientRect();
      window.__boxTierDemoTap(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
      target.click();
    },
    { expected: text, query: selector },
  );
  await wait();
}

async function cueTarget(target) {
  await target.scrollIntoViewIfNeeded();
  await wait(120);
  await target.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    window.__boxTierDemoCue({
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
    });
  });
}

function recordScene(name, source, startedAt) {
  scenes.push({
    name,
    source,
    start: (startedAt - captureStartedAt) / 1000,
    duration: (Date.now() - startedAt) / 1000,
    url: page.url(),
  });
}

async function captureLocatorClickScene(target, name, source, { cueMs = 650, settleMs = 850 } = {}) {
  await cueTarget(target);
  const startedAt = Date.now();
  await wait(cueMs);
  await target.evaluate(() => window.__boxTierDemoClearCue());
  await target.click();
  await wait(settleMs);
  recordScene(name, source, startedAt);
}

async function captureTextClickScene(text, name, source, options) {
  const target = page.getByRole("button", { name: text, exact: true });
  await target.waitFor();
  await captureLocatorClickScene(target, name, source, options);
}

async function hasText(text, selector = "button") {
  return page.evaluate(
    ({ expected, query }) => [...document.querySelectorAll(query)].some((element) => element.innerText?.trim() === expected),
    { expected: text, query: selector },
  );
}

async function clickButtonUntil(source, expected, attempts = 4) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await Promise.all(expected.map((text) => hasText(text))).then((matches) => matches.some(Boolean))) return;
    const button = page.getByRole("button", { name: source, exact: true });
    if (await button.count()) {
      await button.click().catch(() => {});
    }
    await wait(500);
  }
  const buttons = await page.locator("button").allInnerTexts();
  throw new Error(`${source} 실행 후 상태 전환 실패: ${buttons.join(" | ")}`);
}

async function setLabeledValue(label, value) {
  const changed = await page.evaluate(
    ({ expected, nextValue }) => {
      const input = [...document.querySelectorAll("input, textarea")]
        .find((element) => element.labels?.[0]?.innerText?.trim() === expected);
      if (!input) return false;
      input.scrollIntoView({ block: "center", inline: "center" });
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, String(nextValue));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { expected: label, nextValue: value },
  );
  if (!changed) throw new Error(`입력란을 찾지 못함: ${label}`);
  await wait();
}

async function setPlaceholderValue(placeholder, value) {
  const changed = await page.evaluate(
    ({ expected, nextValue }) => {
      const input = [...document.querySelectorAll("input, textarea")]
        .find((element) => element.placeholder === expected);
      if (!input) return false;
      const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, String(nextValue));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    { expected: placeholder, nextValue: value },
  );
  if (!changed) throw new Error(`입력란을 찾지 못함: ${placeholder}`);
  await wait();
}

async function selectValue(value) {
  const changed = await page.evaluate((nextValue) => {
    const select = [...document.querySelectorAll("select")]
      .find((element) => [...element.options].some((option) => option.value === nextValue));
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, nextValue);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, value);
  if (!changed) throw new Error(`선택값을 찾지 못함: ${value}`);
  await wait();
}

async function holdScene(name, source, durationMs, { scrollTop = true } = {}) {
  if (scrollTop) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  }
  await wait(180);
  scenes.push({
    name,
    source,
    start: (Date.now() - captureStartedAt) / 1000,
    duration: durationMs / 1000,
    url: page.url(),
  });
  await wait(durationMs);
}

try {
  await page.goto(`${baseUrl}/app/guide/practice`, { waitUntil: "networkidle" });
  await clickText("개인전");
  await clickText("현장 픽업\n개인으로 참가해 현장에서 팀과 교대 순서를 정합니다.");
  await clickText("즉시");
  await clickText("3v3");
  await clickText("2명");
  await clickText("다음");
  await clickText("커스텀");
  await clickText("단일 경기");
  await setLabeledValue("경기 시간 (분)", 1);
  await clickText("다음");
  await clickText("경기 생성");
  await clickText("빈 슬롯\n초대");
  await setPlaceholderValue("선수 검색", "한유진");
  await clickText("한유진\n#practice-guard-3 · PG\n선택");
  await clickText("선택 1명 초대");
  await selectValue("practice-guard-3");
  await clickText("수락");
  await selectValue("practice-player-self");
  await clickText("경기 확정");

  await page.locator('[aria-label="경기 출석 QR 코드"]').scrollIntoViewIfNeeded();
  await holdScene("attendance-qr", "practice", 1_300, { scrollTop: false });
  await captureTextClickScene("연습 선수 출석 완료", "attendance-action", "practice");
  await holdScene("attendance-complete", "practice", 1_100);
  await captureTextClickScene("완전 랜덤 배치", "team-action", "practice");
  await holdScene("team-assignment", "practice", 1_700);
  await clickText("배정 확정");
  await clickText("경기 시작");
  if (await hasText("모바일 전광판 담당 화면으로 전환")) {
    await clickText("모바일 전광판 담당 화면으로 전환");
  }
  await clickText("경기시계 시작");
  await page.waitForFunction(() => {
    const text = document.querySelector(".ui-match-clock-badges")?.innerText ?? "";
    const values = text.match(/(\d+):(\d+)\s*\/\s*(\d+):(\d+)/)?.slice(1).map(Number);
    if (!values) return false;
    const [activeMinutes, activeSeconds, minimumMinutes, minimumSeconds] = values;
    return activeMinutes * 60 + activeSeconds >= minimumMinutes * 60 + minimumSeconds;
  }, undefined, { timeout: 70_000 });
  const scoreActions = [
    page.getByLabel("A 점수 조정").getByRole("button", { name: "+3", exact: true }),
    page.getByLabel("B 점수 조정").getByRole("button", { name: "+2", exact: true }),
    page.getByLabel("A 점수 조정").getByRole("button", { name: "+2", exact: true }),
  ];
  await cueTarget(scoreActions[0]);
  const scoreStartedAt = Date.now();
  for (const [index, scoreAction] of scoreActions.entries()) {
    if (index > 0) await cueTarget(scoreAction);
    await wait(520);
    await scoreAction.evaluate(() => window.__boxTierDemoClearCue());
    await scoreAction.click();
    await wait(380);
  }
  recordScene("score-actions", "practice", scoreStartedAt);
  await holdScene("scoreboard-running", "practice", 3_000);
  await selectValue("practice-player-self");
  await page.waitForFunction(() => [...document.querySelectorAll("button")]
    .some((button) => button.innerText?.trim() === "경기 종료"));
  await captureTextClickScene("경기 종료", "end-action", "practice");
  await clickButtonUntil("경기 종료", ["연습 결과 최종 확정"]);
  await holdScene("clock-ended", "practice", 1_400);
  await captureTextClickScene("연습 결과 최종 확정", "confirm-action", "practice");
  await holdScene("final-result", "practice", 1_400);

  await page.goto(`${baseUrl}/app`, { waitUntil: "networkidle" });
  await holdScene("record-and-tier", "seeded-record", 1_900);
  const recentMatchLink = page.locator(".home-recent-card .recent-match-list")
    .locator('a[href*="/app/matches?match="]')
    .first();
  await recentMatchLink.waitFor({ state: "visible" });
  const matchHref = await recentMatchLink.getAttribute("href");
  const matchId = new URL(matchHref, baseUrl).searchParams.get("match");
  if (!matchId) throw new Error("확정 데모 경기 ID를 실제 전적 링크에서 찾지 못했습니다.");

  await page.goto(`${baseUrl}/app/receipt?match=${encodeURIComponent(matchId)}`, { waitUntil: "networkidle" });
  await captureTextClickScene("감열지 영수증", "receipt-style-action", "seeded-record");
  const thermalReceipt = page.getByRole("img", { name: "감열지 영수증 미리보기", exact: true });
  await thermalReceipt.waitFor({ state: "visible" });
  await thermalReceipt.scrollIntoViewIfNeeded();
  await holdScene("verified-receipt", "seeded-record", 3_400, { scrollTop: false });

  await page.close();
  await video.saveAs(rawVideoPath);
  await context.close();
  await browser.close();

  const metadata = {
    capturedAt: new Date().toISOString(),
    baseUrl,
    viewport: { width: 540, height: 960 },
    browserExecutable: executablePath,
    rawVideoPath,
    matchId,
    facts: {
      practice: "QR 출석, 팀 배정, 전광판, 종료·확정은 비저장 연습 경기입니다.",
      seededRecord: "전적·티어·영수증은 홈 화면에서 발견한 별도 확정 데모 경기입니다.",
    },
    scenes,
  };
  await import("node:fs/promises").then(({ writeFile }) => writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`));
  console.log(JSON.stringify({ rawVideoPath, metadataPath, matchId, sceneCount: scenes.length }, null, 2));
} catch (error) {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  throw error;
}
