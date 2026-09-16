import assert from "node:assert/strict";
import test from "node:test";
import { canShareImageFile, copyTextToClipboard, getAppShareUrl, getPromotionShareText, shareImageFile, shareLink } from "./sharing.js";
import { getRoomShareUrl } from "./recruitingPage.js";

const payload = { title: "농구 모임", text: "이번 주 경기", url: "https://example.com/app/matches?match=game-1" };

test("이미지 공유 지원 여부는 실제 파일로 확인하고 확인 실패는 미지원으로 처리한다", () => {
  const file = new File(["png"], "share.png", { type: "image/png" });
  const supported = { share() {}, canShare: (data) => { assert.deepEqual(data, { files: [file] }); return true; } };
  assert.equal(canShareImageFile(supported, file), true);
  for (const browser of [undefined, {}, { share() {} }, { canShare: () => true }, { share() {}, canShare: () => false }, { share() {}, canShare() { throw new Error("blocked"); } }]) {
    assert.equal(canShareImageFile(browser, file), false);
  }
  assert.equal(canShareImageFile(supported, null), false);
});

test("이미지 보내기는 준비된 PNG를 전달하고 공유 성공·취소·실패를 구분한다", async () => {
  const file = new File(["png"], "share.png", { type: "image/png" });
  let shared;
  const navigator = { canShare: () => true, share: async (data) => { shared = data; } };
  assert.equal(await shareImageFile(file, { title: payload.title, navigator }), "shared");
  assert.deepEqual(shared, { title: payload.title, files: [file] });
  for (const [name, expected] of [["AbortError", "cancelled"], ["NotAllowedError", "failed"], ["DataError", "failed"]]) {
    assert.equal(await shareImageFile(file, { navigator: { ...navigator, share: async () => { throw Object.assign(new Error(), { name }); } } }), expected);
  }
  assert.equal(await shareImageFile(file, { navigator: { canShare: () => false, share: () => assert.fail("미지원 기기는 공유창을 열면 안 됨") } }), "failed");
});

test("공유 주소는 설정된 서비스 주소와 상세 경로를 사용한다", () => {
  assert.equal(getAppShareUrl("/app/teams/team-1", "https://example.com"), "https://example.com/app/teams/team-1");
});

test("경기방은 가상 모집글 ID 대신 실제 경기로 연결하고 모집방은 모집글로 연결한다", () => {
  assert.equal(getRoomShareUrl("match-room-game-1", "game-1"), "/app/matches?match=game-1");
  assert.equal(getRoomShareUrl("post-1", "game-1"), "/app/matches?match=game-1");
  assert.equal(getRoomShareUrl("post/1"), "/app/recruiting?post=post%2F1");
});

test("기기 공유에 성공하면 링크를 중복 복사하지 않는다", async () => {
  let shared;
  const status = await shareLink(payload, {
    navigator: { share: async (value) => { shared = value; } },
    copy: async () => assert.fail("복사하면 안 됨"),
  });
  assert.equal(status, "shared");
  assert.deepEqual(shared, payload);
});

test("사용자가 공유창을 닫으면 복사하거나 오류를 표시하지 않는다", async () => {
  assert.equal(await shareLink(payload, {
    navigator: { share: async () => { throw Object.assign(new Error(), { name: "AbortError" }); } },
    copy: async () => assert.fail("취소 후 복사하면 안 됨"),
  }), "cancelled");
});

test("기기 공유 미지원 또는 거절 시 동일한 주소를 복사한다", async () => {
  for (const navigator of [{}, { share: async () => { throw new Error("거절"); } }]) {
    let copied;
    assert.equal(await shareLink(payload, {
      navigator, copy: async (value) => { copied = value; return true; },
    }), "copied");
    assert.equal(copied, payload.url);
  }
});

test("모집 공유는 알려진 정보와 참가 조건을 담고 누락된 값은 만들지 않는다", () => {
  const text = getPromotionShareText({
    title: "주말 농구", eyebrow: "3x3 · 모집 중",
    fields: [
      { label: "인원", value: "5/6명" },
      { label: "일정", value: "토요일 15:00" },
      { label: "비용", value: "주최자에게 확인" },
      { label: "미정 구장", value: "" },
      { label: "승인팀", value: 0 },
      { label: "누락", value: null },
    ],
    note: "참가 조건이 적용됩니다.", actionLabel: "경기방 확인",
  });
  assert.equal(text, "3x3 · 모집 중 · 주말 농구\n인원: 5/6명\n일정: 토요일 15:00\n비용: 주최자에게 확인\n승인팀: 0\n참가 조건이 적용됩니다.\n경기방 확인");
});

test("모집 공유 복사는 안내 문구와 원래 상세 주소를 함께 전달한다", async () => {
  const fallbackText = `${payload.text}\n\n${payload.url}`;
  for (const navigator of [{}, { share: async () => { throw new Error("거절"); } }]) {
    let copied;
    assert.equal(await shareLink(payload, { navigator, fallbackText, copy: async (value) => { copied = value; return true; } }), "copied");
    assert.equal(copied, fallbackText);
  }
  assert.equal(await shareLink(payload, {
    navigator: { share: async () => { throw Object.assign(new Error(), { name: "AbortError" }); } },
    fallbackText, copy: async () => assert.fail("취소 후 모집 문구를 복사하면 안 됨"),
  }), "cancelled");
});

test("복사까지 실패하면 성공으로 알리지 않는다", async () => {
  assert.equal(await shareLink(payload, { navigator: {}, copy: async () => false }), "failed");
  assert.equal(await shareLink(payload, { navigator: {}, copy: async () => { throw new Error(); } }), "failed");
  assert.equal(await shareLink({}, { navigator: {} }), "failed");
});

test("클립보드 권한이 없어도 선택 복사를 시도하고 임시 입력과 포커스를 복구한다", async () => {
  const calls = [];
  const buffer = {
    setAttribute() {}, focus: () => calls.push("focus-buffer"), select: () => calls.push("select"),
    remove: () => calls.push("remove"),
  };
  const document = {
    activeElement: { focus: () => calls.push("restore-focus") },
    createElement: () => buffer,
    body: { appendChild: () => calls.push("append") },
    execCommand: (command) => { assert.equal(command, "copy"); calls.push("copy"); return true; },
  };
  assert.equal(await copyTextToClipboard(payload.url, {
    navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } }, document,
  }), true);
  assert.equal(buffer.value, payload.url);
  assert.deepEqual(calls, ["append", "focus-buffer", "select", "copy", "remove", "restore-focus"]);
  assert.equal(await copyTextToClipboard(payload.url, { navigator: {}, document: {} }), false);
});
