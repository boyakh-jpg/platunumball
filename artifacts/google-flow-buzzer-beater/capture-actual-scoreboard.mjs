import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetPath = (name) => path.join(here, "assets", name);
const appUrl = process.env.BOXTIER_PREVIEW_URL || "http://127.0.0.1:4176";
const imageDataUrl = (name) => `data:image/png;base64,${readFileSync(assetPath(name)).toString("base64")}`;

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 540, height: 960 },
  deviceScaleFactor: 2,
});

try {
  await page.goto(`${appUrl}/app/guide/practice`, { waitUntil: "networkidle" });

  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await page.getByRole("button", { name: "경기 생성", exact: true }).click();

  await page.getByRole("button", { name: /후보.*초대/ }).click();
  await page.getByPlaceholder("선수 또는 팀 검색").fill("한유진");
  await page.getByRole("button", { name: /한유진.*선택/ }).click();
  await page.getByRole("button", { name: "선택 1명 초대", exact: true }).click();
  await page.getByRole("button", { name: /연습 선수 1명 초대 수락/ }).click();
  await page.getByRole("button", { name: "경기 확정", exact: true }).click();

  await page.getByRole("button", { name: "연습 선수 출석 완료", exact: true }).click();
  await page.getByRole("button", { name: "경기 시작", exact: true }).click();
  await page.getByRole("button", { name: "경기시계 시작", exact: true }).click();

  const aControls = page.getByLabel("A 점수 조정");
  const bControls = page.getByLabel("B 점수 조정");
  for (let index = 0; index < 24; index += 1) {
    await aControls.getByRole("button", { name: "+3", exact: true }).click();
  }
  await aControls.getByRole("button", { name: "+2", exact: true }).click();
  for (let index = 0; index < 25; index += 1) {
    await bControls.getByRole("button", { name: "+3", exact: true }).click();
  }

  await page.getByRole("button", { name: "정지", exact: true }).click();
  await page.waitForTimeout(250);

  const stageVideoTeams = async () => {
    await page.evaluate(({ boxtierEmblem, owlsEmblem }) => {
      const stageLabel = (selector, name, emblem) => {
        const label = document.querySelector(selector);
        if (!label) throw new Error(`팀 라벨 없음: ${selector}`);
        label.textContent = "";
        const image = document.createElement("img");
        image.src = emblem;
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        const text = document.createElement("span");
        text.textContent = name;
        label.append(image, text);
      };

      stageLabel(".ui-match-clock-team-a .ui-match-clock-team-label", "BOXTIER", boxtierEmblem);
      stageLabel(".ui-match-clock-team-b .ui-match-clock-team-label", "NIGHT OWLS", owlsEmblem);
      const period = document.querySelector(".ui-match-clock-period");
      const time = document.querySelector(".ui-match-clock-main-time time");
      if (period) period.textContent = "4Q";
      if (time) time.textContent = "00:00.0";
    }, {
      boxtierEmblem: imageDataUrl("emblem-boxtier.png"),
      owlsEmblem: imageDataUrl("emblem-night-owls.png"),
    });
  };

  await page.addStyleTag({ content: `
    .ui-match-clock-team-label {
      display: grid;
      justify-items: center;
      gap: 3px;
      line-height: 1;
      white-space: nowrap;
    }
    .ui-match-clock-team-label img {
      width: clamp(24px, 5vmin, 42px);
      height: clamp(24px, 5vmin, 42px);
      object-fit: contain;
    }
    .ui-match-clock-team-label span {
      font-size: clamp(0.65rem, 2.8vmin, 1.35rem);
      letter-spacing: 0.015em;
    }
  ` });

  const fullscreenClock = page.getByRole("dialog", { name: "전체화면 경기시계" });
  if (!(await fullscreenClock.isVisible())) {
    await page.getByRole("button", { name: "전체화면", exact: true }).click();
  }
  await fullscreenClock.waitFor();
  await stageVideoTeams();
  await page.screenshot({
    path: assetPath("ref-mobile-scoreboard-fullscreen-before-74-75.png"),
    animations: "disabled",
  });

  const plusThree = aControls.getByRole("button", { name: "+3", exact: true });
  const plusThreeBox = await plusThree.boundingBox();
  if (!plusThreeBox) throw new Error("BOXTIER +3 버튼 위치를 찾지 못함");
  await plusThree.evaluate((button, { x, y, width, height }) => {
    const overlay = document.createElement("div");
    overlay.id = "capture-finger-overlay";
    overlay.setAttribute("aria-hidden", "true");
    overlay.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      left: ${x + width * 0.45}px;
      top: ${y + height * 0.2}px;
      width: 34px;
      height: 112px;
      border-radius: 20px 20px 16px 16px;
      background: linear-gradient(90deg, #bb7754 0%, #edb18c 45%, #ffd1ad 72%, #c98662 100%);
      border: 1px solid rgba(73, 35, 21, 0.46);
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.42), inset -5px 0 7px rgba(93, 39, 19, 0.18);
      transform: rotate(-16deg);
      transform-origin: 50% 12%;
      pointer-events: none;
    `;
    const nail = document.createElement("span");
    nail.style.cssText = `
      position: absolute;
      left: 7px;
      top: 5px;
      width: 20px;
      height: 25px;
      border-radius: 12px 12px 9px 9px;
      background: linear-gradient(#ffe0c8, #eab595);
      border: 1px solid rgba(113, 58, 37, 0.28);
    `;
    overlay.append(nail);
    const fullscreenLayer = button.closest('[role="dialog"]');
    (fullscreenLayer || button.parentElement || document.body).append(overlay);
  }, plusThreeBox);
  await page.screenshot({
    path: assetPath("ref-mobile-scoreboard-fullscreen-press-plus3.png"),
    animations: "disabled",
  });
  await page.locator("#capture-finger-overlay").evaluate((element) => element.remove());

  await plusThree.click();
  await page.waitForTimeout(250);
  await stageVideoTeams();
  await page.screenshot({
    path: assetPath("ref-mobile-scoreboard-fullscreen-after-77-75.png"),
    animations: "disabled",
  });

  const scores = await page.getByLabel("기록 점수판").innerText();
  process.stdout.write(`${JSON.stringify({
    source: page.url(),
    before: "BOXTIER 74 - 75 NIGHT OWLS",
    action: "BOXTIER +3 한 번",
    after: "BOXTIER 77 - 75 NIGHT OWLS",
    files: [
      assetPath("ref-mobile-scoreboard-fullscreen-before-74-75.png"),
      assetPath("ref-mobile-scoreboard-fullscreen-press-plus3.png"),
      assetPath("ref-mobile-scoreboard-fullscreen-after-77-75.png"),
    ],
    renderedScoreboard: scores,
  }, null, 2)}\n`);
} finally {
  await browser.close();
}
