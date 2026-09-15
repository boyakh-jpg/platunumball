import assert from "node:assert/strict";
import test from "node:test";
import { copyTextToClipboard, getAppShareUrl, shareLink } from "./sharing.js";
import { getRoomShareUrl } from "./recruitingPage.js";

const payload = { title: "농구 모임", text: "이번 주 경기", url: "https://example.com/app/matches?match=game-1" };

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
