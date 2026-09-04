import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const assetDir = path.join(packageDir, "assets");
const appUrl = process.env.BOXTIER_PREVIEW_URL || "http://127.0.0.1:4176";
const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
});

const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
page.on("dialog", (dialog) => dialog.dismiss());

await page.goto(`${appUrl}/`, { waitUntil: "networkidle" });
await page.getByRole("link", { name: /가입 없이 영수증 만들기/ }).click();
await page.waitForURL("**/app/receipt");
await page.getByRole("button", { name: "감열지 영수증" }).click();

await page.getByPlaceholder("TEAM A 이름").fill("BOXTIER");
await page.getByPlaceholder("TEAM B 이름").fill("NIGHT OWLS");
const mainScores = page.locator(".match-receipt-score-input input");
await mainScores.nth(0).fill("77");
await mainScores.nth(1).fill("75");
await page.locator('input[type="date"]').fill("2026-09-04");
await page.locator('input[type="time"]').fill("22:17");
await page.locator("select").nth(0).selectOption("5v5");
await page.locator("select").nth(1).selectOption("final");
await page.getByPlaceholder("경기 장소 대신 주소나 장소를 입력 가능").fill("서울 야외 농구장");
await page.getByPlaceholder("선택 · 20자 이내").fill("BOXTIER NIGHT LEAGUE");

const emblemInputs = page.locator('.match-receipt-emblem-upload input[type="file"]');
await emblemInputs.nth(0).setInputFiles(path.join(assetDir, "emblem-boxtier.png"));
await page.getByRole("dialog", { name: "엠블럼 이미지 편집" }).waitFor();
await page.getByRole("button", { name: "흑백 적용" }).click();
await page.getByRole("dialog", { name: "엠블럼 이미지 편집" }).waitFor({ state: "hidden" });

await emblemInputs.nth(1).setInputFiles(path.join(assetDir, "emblem-night-owls.png"));
await page.getByRole("dialog", { name: "엠블럼 이미지 편집" }).waitFor();
await page.getByRole("button", { name: "흑백 적용" }).click();
await page.getByRole("dialog", { name: "엠블럼 이미지 편집" }).waitFor({ state: "hidden" });

const periods = [
  ["1Q", 18, 18],
  ["2Q", 20, 19],
  ["3Q", 17, 21],
  ["4Q", 22, 17],
];
for (const [period, home, away] of periods) {
  await page.getByLabel(`${period} TEAM A 점수`).fill(String(home));
  await page.getByLabel(`${period} TEAM B 점수`).fill(String(away));
}

await page.getByPlaceholder("선택 · 한글 28자 또는 영문 56자").fill("버저비터 승리 · 마지막 1초, 2점 차 역전승");
const includePhoto = page.getByRole("checkbox", { name: "경기 사진 포함" });
if (await includePhoto.isChecked()) await includePhoto.uncheck();

const receiptCanvas = page.locator('canvas[aria-label="감열지 영수증 미리보기"]');
await receiptCanvas.waitFor();
await page.waitForTimeout(1200);
await receiptCanvas.screenshot({ path: path.join(assetDir, "ref-receipt-buzzer-beater-issued.png") });

await page.getByRole("button", { name: "영수증 완성하기" }).click();
await page.getByRole("button", { name: "Story 저장" }).waitFor({ timeout: 90000 });
const downloadPromise = page.waitForEvent("download");
await page.getByRole("button", { name: "Story 저장" }).click();
const download = await downloadPromise;
await download.saveAs(path.join(assetDir, "ref-receipt-buzzer-beater-issued-story.png"));

console.log(JSON.stringify({
  source: page.url(),
  receipt: path.join(assetDir, "ref-receipt-buzzer-beater-issued.png"),
  story: path.join(assetDir, "ref-receipt-buzzer-beater-issued-story.png"),
  status: await page.locator('[role="status"]').last().textContent(),
}, null, 2));

await browser.close();
