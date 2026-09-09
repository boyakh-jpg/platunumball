import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { useRecruitingRoomParticipationActions } from "../src/components/recruiting/useRecruitingRoomParticipationActions.js";

const createSource = (await readFile(new URL("../src/components/match/CreateMatchActions.jsx", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const submitSource = createSource.slice(createSource.indexOf("  const submit = async"), createSource.indexOf("  return {\n    selectTeamA")).trim();

function createSaveHarness(auth, save = async () => "saved-record") {
  const state = { submitting: false, feedback: "이전 오류", destinations: [], cleared: false };
  const draft = { visibility: "private", mode: "1v1", soloTeamAPlayersText: "내 기록", soloTeamBPlayersText: "상대", scheduledDate: "2026-10-10" };
  const scope = {
    wizardStep: 5, finalWizardStep: 5, submittingRef: { current: false }, submitting: false,
    practiceMode: false, isSoloRecord: true, isMatchRecordRoom: false, isTournamentRoom: false,
    draft, isSupabaseConfigured: true, app: { state: { users: [] }, actions: { createMatch: save } },
    getClientActionAccessToken: auth, submitDisabled: false, submitDisabledReason: "",
    setSubmitFeedback: (value) => { state.feedback = value; },
    setSubmitting: (value) => { state.submitting = value; },
    formatCreateSaveError: (_error, fallback) => fallback,
    normalizeSoloRecordRosterInput: (text, refs) => ({ text, refs }),
    getPersonalRecordDraftPayload: (value) => value,
    RECORD_TYPES: { personalRecord: "personal_record" },
    receiptRecordMatchId: "", selectedCourt: null, receiptDraftPublicId: "", receiptReturnTo: "",
    clearCreateMatchGuestDraft: () => { state.cleared = true; },
    navigate: (path) => { state.destinations.push(path); },
  };
  const submit = new Function(...Object.keys(scope), `${submitSource}\nreturn submit;`)(...Object.values(scope));
  return { state, draft, scope, submit: () => submit({ preventDefault() {} }) };
}

test("생성은 인증 확인 지연부터 잠그고 중복 요청을 막으며 인증 실패 뒤 입력을 보존해 재시도한다", async () => {
  let rejectAuth;
  let authCalls = 0;
  let saveCalls = 0;
  const harness = createSaveHarness(() => {
    authCalls += 1;
    return authCalls === 1 ? new Promise((_resolve, reject) => { rejectAuth = reject; }) : Promise.resolve("token");
  }, async () => { saveCalls += 1; return "saved-record"; });
  const initialDraft = structuredClone(harness.draft);
  const pending = harness.submit();
  assert.equal(harness.state.submitting, true);
  assert.equal(harness.state.feedback, "");
  await harness.submit();
  assert.equal(authCalls, 1);
  rejectAuth(new Error("session unavailable"));
  await pending;
  assert.equal(harness.state.submitting, false);
  assert.equal(harness.scope.submittingRef.current, false);
  assert.match(harness.state.feedback, /다시 시도/);
  assert.deepEqual(harness.draft, initialDraft);
  assert.deepEqual(harness.state.destinations, []);
  assert.equal(saveCalls, 0);
  await harness.submit();
  assert.equal(saveCalls, 1);
  assert.equal(harness.state.feedback, "");
  assert.equal(harness.state.cleared, true);
  assert.deepEqual(harness.state.destinations, ["/app/profile/records"]);
});

test("생성 저장 실패에는 성공 이동 없이 입력과 재시도 가능 상태를 보존한다", async () => {
  for (const failure of [false, { ok: false }, new Error("offline")]) {
    const harness = createSaveHarness(async () => "token", async () => {
      if (failure instanceof Error) throw failure;
      return failure;
    });
    const initialDraft = structuredClone(harness.draft);
    await harness.submit();
    assert.equal(harness.state.submitting, false);
    assert.match(harness.state.feedback, /저장하지 못했습니다/);
    assert.deepEqual(harness.draft, initialDraft);
    assert.equal(harness.state.cleared, false);
    assert.deepEqual(harness.state.destinations, []);
  }
});

function createJoinHarness(joinMode, action, { pickup = false, paid = false } = {}) {
  const draft = { joinMode, position: "SG", side: "teamB", reserve: true, teamId: joinMode === "team" ? "team" : "", playerIds: ["me"], reservePlayerIds: ["reserve"] };
  const state = { draft: { room: draft }, joining: "", party: "", error: "이전 오류", joined: [], prompt: null };
  const setter = (key) => (value) => { state[key] = typeof value === "function" ? value(state[key]) : value; };
  const actions = useRecruitingRoomParticipationActions({
    app: { currentUser: { id: "me" }, state: {}, actions: { interestRecruitingPost: action, joinRecruitingSideParty: action } },
    useCallback: (callback) => callback,
    getDefaultJoinDraft: () => draft, myTeams: [], joinDraftByPost: state.draft,
    isIndividualOnlyRecruitingRoom: () => false, isTeamOnlyRoom: () => joinMode === "team",
    setJoinDraftByPost: setter("draft"), joiningPostId: "", joiningPartyKey: "",
    requiresPaidCourtNotice: () => paid, setPaidCourtJoinPrompt: setter("prompt"),
    getRecruitingLobby: () => ({}), isPickupRecruitingRoom: () => pickup,
    getPickupOpenSlotPlacements: () => [], getRecruitingSideCapacity: () => 5, getRecruitingBenchCapacity: () => 1,
    getJoinActiveCapacity: () => 1, getJoinReserveCapacity: () => 1,
    setJoiningPostId: setter("joining"), setJoiningPartyKey: setter("party"), setInviteError: setter("error"),
    onJoined: (...args) => state.joined.push(args), getPartyOptionKey: () => "teamB:team",
  });
  return { state, actions, room: { id: "room" }, option: { team: { id: "team" }, sideName: "teamB", entry: { id: "entry" } } };
}

test("선수·심판·팀 참가와 파티 합류는 실패를 안내하고 선택을 보존해 다시 참여한다", async (t) => {
  for (const mode of ["player", "referee", "team", "party"]) {
    for (const failure of [false, { ok: false }, new Error("offline")]) {
      await t.test(`${mode}: ${failure instanceof Error ? "예외" : JSON.stringify(failure)}`, async () => {
        let finish;
        const calls = [];
        const harness = createJoinHarness(mode, (...args) => {
          calls.push(args);
          if (calls.length > 1) return Promise.resolve({ ok: true });
          return new Promise((resolve, reject) => {
            finish = () => failure instanceof Error ? reject(failure) : resolve(failure);
          });
        });
        const submit = () => mode === "party"
          ? harness.actions.joinSideParty(harness.room, harness.option)
          : harness.actions.submitJoin(harness.room);
        const initialDraft = structuredClone(harness.state.draft);
        const pending = submit();
        assert.equal(harness.state.error, "");
        assert.ok(mode === "party" ? harness.state.party : harness.state.joining);
        finish();
        await pending;
        assert.match(harness.state.error, /다시 시도/);
        assert.equal(harness.state.joining, "");
        assert.equal(harness.state.party, "");
        assert.deepEqual(harness.state.draft, initialDraft);
        assert.deepEqual(harness.state.joined, []);
        await submit();
        assert.equal(harness.state.error, "");
        assert.equal(harness.state.joined.length, 1);
        assert.deepEqual(calls[0], calls[1]);
      });
    }
  }
});

test("유료 구장은 확인 이후에만 요청하며 픽업 만석은 요청 없이 사유를 표시한다", async () => {
  let calls = 0;
  const paid = createJoinHarness("player", async () => { calls += 1; return false; }, { paid: true });
  await paid.actions.submitJoin(paid.room);
  assert.equal(calls, 0);
  assert.equal(paid.state.prompt.action, "join");
  await paid.actions.submitJoin(paid.room, { paidCourtConfirmed: true });
  assert.equal(calls, 1);
  assert.match(paid.state.error, /다시 시도/);
  const full = createJoinHarness("player", async () => { calls += 1; }, { pickup: true });
  await full.actions.submitJoin(full.room);
  assert.equal(calls, 1);
  assert.match(full.state.error, /정원이 찼습니다/);
});
