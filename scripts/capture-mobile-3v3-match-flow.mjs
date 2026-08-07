import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CDP_PORT = 9222;
const VIEWPORT = { width: 430, height: 932, deviceScaleFactor: 1, mobile: true };

const tabs = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((response) => response.json());
const tab = tabs.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
if (!tab) throw new Error("Chrome CDP 탭을 찾지 못했습니다.");

const socket = new WebSocket(tab.webSocketDebuggerUrl);
const pending = new Map();
let messageId = 0;
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  pending.get(message.id)?.(message);
  pending.delete(message.id);
};
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});

function send(method, params = {}) {
  return new Promise((resolve) => {
    const id = ++messageId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression, returnByValue = true) {
  const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue });
  if (response.result?.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  return response.result?.result?.value;
}

async function wait(ms = 500) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickText(text, selector = "button") {
  const point = await evaluate(`(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((element) => element.innerText?.trim() === ${JSON.stringify(text)});
    if (!target) return null;
    target.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) {
    socket.close();
    throw new Error(`화면에서 찾지 못함: ${text}`);
  }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
  await evaluate(`([...document.querySelectorAll(${JSON.stringify(selector)})]
    .find((element) => element.innerText?.trim() === ${JSON.stringify(text)})).click()`);
  await wait();
  return point;
}

async function setLabeledValue(label, value) {
  const point = await evaluate(`(() => {
    const input = [...document.querySelectorAll("input, textarea")]
      .find((element) => element.labels?.[0]?.innerText?.trim() === ${JSON.stringify(label)});
    if (!input) return null;
    input.scrollIntoView({ block: "center", inline: "center" });
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    setter.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    const rect = input.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`화면에서 입력란을 찾지 못함: ${label}`);
  await wait();
  return point;
}

async function setPlaceholderValue(placeholder, value) {
  const found = await evaluate(`(() => {
    const input = [...document.querySelectorAll("input, textarea")]
      .find((element) => element.placeholder === ${JSON.stringify(placeholder)});
    if (!input) return false;
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value").set.call(input, ${JSON.stringify(String(value))});
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!found) throw new Error(`화면에서 입력란을 찾지 못함: ${placeholder}`);
  await wait();
}

async function selectValue(value) {
  const changed = await evaluate(`(() => {
    const select = [...document.querySelectorAll("select")].find((element) =>
      [...element.options].some((option) => option.value === ${JSON.stringify(value)}));
    if (!select) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, ${JSON.stringify(value)});
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`선택값을 찾지 못함: ${value}`);
  await wait();
}

async function selectActivePlayer() {
  const value = await evaluate(`(() => {
    const select = [...document.querySelectorAll("select")].find((element) =>
      element.labels?.[0]?.innerText?.includes("현재 역할 화면"));
    const option = [...(select?.options ?? [])].find((item) =>
      item.text.includes("출전 선수") && !item.text.includes("방장"));
    if (!select || !option) return "";
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(select, option.value);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return option.value;
  })()`);
  if (!value) throw new Error("이의신청할 출전 선수를 찾지 못함");
  await wait();
  return value;
}

async function screenshot(filename) {
  const response = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(filename, Buffer.from(response.result.data, "base64"));
}

async function targetPoint(text, selector = "button") {
  return evaluate(`(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((element) => element.innerText?.trim() === ${JSON.stringify(text)});
    if (!target) return null;
    target.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
}

async function captureScene(outputDir, scenes, name, text, selector = "button", duration = 2.4) {
  const point = text ? await targetPoint(text, selector) : { x: 215, y: 466 };
  if (text && !point) throw new Error(`캡처 대상을 찾지 못함: ${text}`);
  await wait(250);
  const file = path.join(outputDir, `${String(scenes.length + 1).padStart(2, "0")}-${name}.png`);
  await screenshot(file);
  scenes.push({ file, point, duration });
}

await send("Emulation.setDeviceMetricsOverride", VIEWPORT);

async function printProbe() {
  console.log(await evaluate(`JSON.stringify({
    url: location.href,
    buttons: [...document.querySelectorAll("button")].map((button) => ({
      text: button.innerText.trim(), disabled: button.disabled, className: button.className,
      checked: button.getAttribute("aria-checked"),
    })).filter((button) => button.text),
    inputs: [...document.querySelectorAll("input, textarea, select")].map((input) => ({
      tag: input.tagName,
      type: input.type,
      name: input.name,
      value: input.value,
      placeholder: input.placeholder,
      label: input.labels?.[0]?.innerText?.trim(),
      options: input.tagName === "SELECT" ? [...input.options].map((option) => ({ value: option.value, text: option.text })) : undefined,
    })),
    text: document.body.innerText,
  }, null, 2)`));
}

if (process.argv.includes("--probe")) {
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--creation-probe")) {
  await send("Page.navigate", { url: "http://127.0.0.1:5173/app/guide/practice" });
  await wait(2_000);
  for (const label of ["개인전", "현장 픽업\n개인으로 참가해 현장에서 팀과 교대 순서를 정합니다.", "즉시", "3v3", "2명"]) {
    await clickText(label);
    console.log(label, await evaluate(`JSON.stringify([...document.querySelectorAll("button")]
      .filter((button) => button.matches(".active,[aria-checked='true']"))
      .map((button) => button.innerText.trim()))`));
  }
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--capture-all")) {
  const outputDir = path.resolve("tmp/mobile-3v3-match-flow");
  const scenes = [];
  await mkdir(outputDir, { recursive: true });

  await send("Page.navigate", { url: "http://127.0.0.1:5173/app" });
  await wait(2_000);
  await captureScene(outputDir, scenes, "home-schedule", "일정", "a,button", 2.0);
  await send("Page.navigate", { url: "http://127.0.0.1:5173/app/matches" });
  await wait(1_500);
  await captureScene(outputDir, scenes, "schedule-list", null, "button", 2.0);

  await send("Page.navigate", { url: "http://127.0.0.1:5173/app/guide/practice" });
  await wait(2_000);
  await clickText("개인전");
  await clickText("현장 픽업\n개인으로 참가해 현장에서 팀과 교대 순서를 정합니다.");
  await clickText("즉시");
  await clickText("3v3");
  await clickText("2명");
  await captureScene(outputDir, scenes, "create-3v3", "다음", "button", 2.6);
  await clickText("다음");
  await clickText("커스텀");
  await clickText("단일 경기");
  await setLabeledValue("경기 시간 (분)", 8);
  await captureScene(outputDir, scenes, "single-eight-minutes", "다음", "button", 2.6);
  await clickText("다음");
  await captureScene(outputDir, scenes, "court-instant", "경기 생성", "button", 2.6);
  await clickText("경기 생성");
  await wait(1_000);
  await captureScene(outputDir, scenes, "room-created", "빈 슬롯\n초대", "button", 2.2);
  await clickText("빈 슬롯\n초대");
  await setPlaceholderValue("선수 검색", "한유진");
  await clickText("한유진\n#practice-guard-3 · PG\n선택");
  await captureScene(outputDir, scenes, "invite-selected", "선택 1명 초대", "button", 2.4);
  await clickText("선택 1명 초대");

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await selectValue("practice-guard-3");
  await captureScene(outputDir, scenes, "guest-accept", "수락", "button", 2.5);
  await clickText("수락");
  await captureScene(outputDir, scenes, "guest-room", null, "button", 2.1);

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await selectValue("practice-player-self");
  await captureScene(outputDir, scenes, "host-confirm", "경기 확정", "button", 2.4);
  await clickText("경기 확정");
  await captureScene(outputDir, scenes, "attendance-qr", null, "button", 2.4);
  await clickText("연습 선수 출석 완료");
  await captureScene(outputDir, scenes, "attendance-complete", "완전 랜덤 배치", "button", 2.2);
  await clickText("완전 랜덤 배치");
  await captureScene(outputDir, scenes, "random-assignment", "배정 확정", "button", 2.7);
  await clickText("배정 확정");
  await captureScene(outputDir, scenes, "roster-with-reserves", "경기 시작", "button", 2.7);
  await clickText("경기 시작");
  const switchController = await targetPoint("모바일 전광판 담당 화면으로 전환", "button");
  await captureScene(outputDir, scenes, "match-started", switchController ? "모바일 전광판 담당 화면으로 전환" : "경기시계 시작", "button", 2.0);
  if (switchController) await clickText("모바일 전광판 담당 화면으로 전환");
  await captureScene(outputDir, scenes, "scoreboard-fullscreen", "경기시계 시작", "button", 2.0);
  await captureScene(outputDir, scenes, "clock-ready", "경기시계 시작", "button", 1.0);
  await clickText("경기시계 시작");
  await wait(2_000);
  await captureScene(outputDir, scenes, "clock-running", "정지", "button", 2.0);
  await evaluate(`window.__captureDateNow = Date.now.bind(Date); Date.now = () => window.__captureDateNow() + 474700`);
  await captureScene(outputDir, scenes, "clock-two-seconds", "정지", "button", 2.0);
  await wait(3_400);
  await captureScene(outputDir, scenes, "clock-ended", "부저", "button", 1.0);
  await evaluate(`Date.now = window.__captureDateNow; delete window.__captureDateNow`);
  await clickText("부저");
  await clickText("예시 팀 점수 기록 후 종료");
  await captureScene(outputDir, scenes, "score-confirmed", null, "button", 2.5);

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await selectActivePlayer();
  await setLabeledValue("B사이드 · 현재 17", 18);
  await setLabeledValue("점수 정정 사유", "B사이드 1점이 누락됐습니다.");
  await captureScene(outputDir, scenes, "dispute-entry", "이의제기", "button", 2.8);
  await clickText("이의제기");
  await captureScene(outputDir, scenes, "dispute-filed", null, "button", 2.2);

  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await selectValue("practice-player-self");
  await setPlaceholderValue("가결·부결 근거를 입력", "전광판 기록과 현장 확인 결과 기존 점수가 맞습니다.");
  await captureScene(outputDir, scenes, "reject-reason", "부결", "button", 2.8);
  await clickText("부결");
  await captureScene(outputDir, scenes, "three-minute-condition", "연습 결과 최종 확정", "button", 2.8);
  await clickText("연습 결과 최종 확정");
  await captureScene(outputDir, scenes, "final-result", "추천 저장", "button", 2.8);
  const firstRecommendation = await evaluate(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => item.innerText.includes("한유진") && item.innerText.includes("받은 추천"));
    if (!button) return false;
    button.click();
    return true;
  })()`);
  if (!firstRecommendation) throw new Error("추천 대상을 찾지 못함");
  await captureScene(outputDir, scenes, "recommend-selected", "추천 저장", "button", 2.3);
  await clickText("추천 저장");
  await captureScene(outputDir, scenes, "recommend-saved", null, "button", 2.2);

  await writeFile(path.join(outputDir, "scenes.json"), JSON.stringify(scenes, null, 2));
  console.log(JSON.stringify({ outputDir, sceneCount: scenes.length }, null, 2));
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=invite")) {
  await clickText("빈 슬롯\n초대");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=search-invite")) {
  await setPlaceholderValue("선수 검색", "한유진");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=select-invite")) {
  await clickText("한유진\n#practice-guard-3 · PG\n선택");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=send-invite")) {
  await clickText("선택 1명 초대");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=guest")) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await selectValue("practice-guard-3");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=guest-accept")) {
  await clickText("수락");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=host-confirm")) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await selectValue("practice-player-self");
  await clickText("경기 확정");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=attendance")) {
  await clickText("연습 선수 출석 완료");
  await clickText("완전 랜덤 배치");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=assignment")) {
  await clickText("배정 확정");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=start")) {
  await clickText("경기 시작");
  await wait(2_000);
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=clock")) {
  await clickText("모바일 전광판 담당 화면으로 전환");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=clock-start")) {
  await clickText("전체화면");
  await clickText("경기시계 시작");
  await wait(2_000);
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=end")) {
  await clickText("예시 팀 점수 기록 후 종료");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=dispute")) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await selectValue("practice-wing-2");
  await setLabeledValue("B사이드 · 현재 17", 18);
  await setLabeledValue("점수 정정 사유", "B사이드 1점이 누락됐습니다.");
  await clickText("이의제기");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=reject")) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await selectValue("practice-player-self");
  await setPlaceholderValue("가결·부결 근거를 입력", "전광판 기록과 현장 확인 결과 기존 점수가 맞습니다.");
  await clickText("부결");
  await printProbe();
  socket.close();
  process.exit(0);
}

if (process.argv.includes("--resume=finalize")) {
  await clickText("연습 결과 최종 확정");
  await printProbe();
  socket.close();
  process.exit(0);
}

const outputDir = path.resolve("tmp/mobile-3v3-match-flow");
await mkdir(outputDir, { recursive: true });
await send("Page.navigate", { url: "http://127.0.0.1:5173/app/guide/practice" });
await wait(2_500);
console.log("loaded");
await screenshot(path.join(outputDir, "000-start.png"));
console.log("shot");
await clickText("현장 픽업\n개인으로 참가해 현장에서 팀과 교대 순서를 정합니다.");
console.log("pickup");
await clickText("3v3");
console.log("3v3");
await clickText("2명");
console.log("bench");
await clickText("다음");
console.log("next");
await clickText("커스텀");
await clickText("단일 경기");
await setLabeledValue("경기 시간 (분)", 8);
await clickText("다음");
await clickText("경기 생성");
await wait(1_500);
if (process.argv.includes("--stage=room")) await printProbe();
console.log(outputDir);
socket.close();
