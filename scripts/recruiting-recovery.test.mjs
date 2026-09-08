import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { useRecruitingRoomParticipationActions } from "../src/components/recruiting/useRecruitingRoomParticipationActions.js";
import {
  ROOM_CHAT_MESSAGE_MAX_LENGTH,
  ROOM_CHAT_RATE_LIMIT,
  ROOM_CHAT_RATE_WINDOW_MS,
  ROOM_CHAT_REPEAT_BLOCK_MS,
  ROOM_CHAT_SEND_COOLDOWN_MS,
} from "../shared/lib/roomChat.js";

function createChatHarness(sendRecruitingChat) {
  const state = {
    drafts: { room: "  조금 늦게 도착합니다  ", other: "다른 방 초안" },
    errors: { room: "이전 오류" },
    cooldowns: {},
    sending: "",
  };
  const setter = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const log = { current: {} };
  const actions = useRecruitingRoomParticipationActions({
    app: { actions: { sendRecruitingChat } },
    chatDraftByPost: state.drafts,
    setChatDraftByPost: setter("drafts"),
    setChatErrorByPost: setter("errors"),
    setChatCooldownUntilByPost: setter("cooldowns"),
    setChatSendingPostId: setter("sending"),
    useCallback: (callback) => callback,
    roomChatLocked: false,
    getUnsafeUserTextReason: () => "",
    chatSendingPostId: "",
    chatCooldownUntilByPost: state.cooldowns,
    chatSendLogRef: log,
    CHAT_MESSAGE_MAX_LENGTH: ROOM_CHAT_MESSAGE_MAX_LENGTH,
    CHAT_RATE_WINDOW_MS: ROOM_CHAT_RATE_WINDOW_MS,
    CHAT_REPEAT_BLOCK_MS: ROOM_CHAT_REPEAT_BLOCK_MS,
    CHAT_RATE_LIMIT: ROOM_CHAT_RATE_LIMIT,
    CHAT_SEND_COOLDOWN_MS: ROOM_CHAT_SEND_COOLDOWN_MS,
  });
  return { state, log, submit: () => actions.submitChat({ preventDefault() {} }, { id: "room" }) };
}

test("방 채팅은 false, ok:false, 예외에서 초안을 보존하고 같은 내용 재전송 성공 뒤 초기화한다", async (t) => {
  const previousWindow = globalThis.window;
  globalThis.window = { setTimeout: () => 0 };
  t.after(() => {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  });
  for (const failure of [false, { ok: false }, new Error("offline")]) {
    await t.test(failure instanceof Error ? "예외" : JSON.stringify(failure), async () => {
      let finish;
      const calls = [];
      const harness = createChatHarness((...args) => {
        calls.push(args);
        if (calls.length > 1) return Promise.resolve({ ok: true });
        return new Promise((resolve, reject) => {
          finish = () => failure instanceof Error ? reject(failure) : resolve(failure);
        });
      });
      const sending = harness.submit();
      assert.equal(harness.state.drafts.room, "  조금 늦게 도착합니다  ");
      assert.equal(harness.state.errors.room, "");
      assert.equal(harness.state.sending, "room");
      finish();
      await sending;
      assert.equal(harness.state.drafts.room, "  조금 늦게 도착합니다  ");
      assert.match(harness.state.errors.room, /전송하지 못했습니다.*다시 시도/);
      assert.equal(harness.state.sending, "");
      assert.deepEqual(harness.log.current, {});
      assert.deepEqual(harness.state.cooldowns, {});
      await harness.submit();
      assert.deepEqual(calls, [["room", "조금 늦게 도착합니다"], ["room", "조금 늦게 도착합니다"]]);
      assert.equal(harness.state.drafts.room, "");
      assert.equal(harness.state.drafts.other, "다른 방 초안");
      assert.equal(harness.state.errors.room, "");
      assert.equal(harness.state.sending, "");
      assert.equal(harness.log.current.room.length, 1);
      assert.ok(harness.state.cooldowns.room > Date.now());
    });
  }
});

test("매치방 목록 재시도는 동일 지역·날짜의 첫 페이지를 요청하고 중복 요청을 막는다", async () => {
  const source = await readFile(new URL("../src/pages/Recruiting.jsx", import.meta.url), "utf8");
  const refreshSource = source.match(/const refreshRecruitingFromServer = useCallback\((async \([\s\S]*?\n  \}), \[/)?.[1];
  const retrySource = source.match(/const retryQueueList = (\(\) => [^;]+);/)?.[1];
  assert.ok(refreshSource);
  assert.ok(retrySource);
  for (const startFilter of ["all", "instant", "2026-09-12"]) {
    const calls = [];
    let finish;
    const scope = {
      app: {
        remoteReady: true,
        currentUser: { id: "player" },
        actions: { loadRecruitingRegion: (request) => {
          calls.push(request);
          if (calls.length === 1) return Promise.resolve(false);
          return new Promise((resolve) => { finish = resolve; });
        } },
      },
      targetPostId: "",
      filterRequestSettled: true,
      lastRecruitingRefreshAtRef: { current: 0 },
      REMOTE_LIST_REFRESH_MIN_INTERVAL_MS: 60_000,
      regionScope: "region",
      selectedRegionKey: "서울특별시 강남구",
      startFilter,
      regionLoadRef: { current: "" },
      RECRUITING_FILTER_PAGE_LIMIT: 120,
      REMOTE_CLIENT_RECRUITING_LIMIT: 40,
    };
    const refresh = new Function(...Object.keys(scope), `return ${refreshSource};`)(...Object.values(scope));
    const retry = new Function("refreshRecruitingFromServer", `return ${retrySource};`)(refresh);
    assert.equal(await refresh(), false);
    scope.lastRecruitingRefreshAtRef.current = Date.now();
    const pending = retry();
    assert.equal(await retry(), false);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1], calls[0]);
    assert.deepEqual(calls[1], {
      regionScope: scope.regionScope,
      regionKey: scope.selectedRegionKey,
      limit: startFilter === "all" ? scope.REMOTE_CLIENT_RECRUITING_LIMIT : scope.RECRUITING_FILTER_PAGE_LIMIT,
      startFilter,
      includeFeedCounts: false,
    });
    finish(1);
    assert.equal(await pending, true);
    assert.equal(scope.regionLoadRef.current, "");
  }
});
