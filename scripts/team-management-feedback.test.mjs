import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isCurrentScopedOperation } from "../src/lib/asyncState.js";
import { getTeamJoinApplicationError, normalizeTeamJoinApplication } from "../src/lib/teamJoinApplication.js";

const [controllerSource, viewSource, dialogSource] = await Promise.all([
  "src/pages/TeamDetail.jsx", "src/pages/TeamDetailView.jsx", "src/components/team/TeamJoinApplicationDialog.jsx",
].map((path) => readFile(new URL(`../${path}`, import.meta.url), "utf8")));

function actionFromSource(source, name, context) {
  const start = source.indexOf(`  const ${name} = `);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf("\n  };", start) + "\n  };".length;
  return new Function(...Object.keys(context), `${source.slice(start, end)}\nreturn ${name};`)(...Object.values(context));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function createTeamScreen() {
  const state = {};
  const context = {
    isCurrentScopedOperation,
    currentTeamIdRef: { current: "team-a" },
    teamInvitePendingRef: { current: null },
    teamManagementPendingRef: { current: null },
    teamOperationSequenceRef: { current: 0 },
  };
  for (const name of ["TeamInvitePending", "TeamManagementPending", "TeamInviteError", "TeamManagementError", "MemberDraft", "MemberQuery", "SelectedInviteProfile", "JoinApplicationOpen", "ReviewedJoinApplication"]) {
    context[`set${name}`] = (value) => { state[name] = value; };
  }
  const resetBody = controllerSource.match(/useEffect\(\(\) => \{(\s+teamInvitePendingRef\.current[\s\S]*?)\n  \}, \[teamId\]\);/);
  assert.ok(resetBody, "team lifecycle must reset and invalidate its management state");
  const reset = new Function(...Object.keys(context), resetBody[1]);
  let cleanup = reset(...Object.values(context));
  return {
    state,
    context,
    leave: () => cleanup(),
    navigate(teamId) {
      cleanup();
      context.currentTeamIdRef.current = teamId;
      cleanup = reset(...Object.values(context));
    },
    management() {
      return actionFromSource(controllerSource, "runTeamManagementMutation", { ...context, team: { id: context.currentTeamIdRef.current } });
    },
    invite(action) {
      return actionFromSource(controllerSource, "inviteMember", {
        ...context, team: { id: context.currentTeamIdRef.current }, canAddMember: true,
        app: { actions: { inviteTeamMember: action } }, addUserId: "invitee", memberDraft: state.MemberDraft,
      });
    },
  };
}

const submitEvent = { preventDefault() {} };

test("가입 신청 실패는 모달 안에 표시하고 작성값을 유지한 채 재시도한다", async () => {
  const screen = createTeamScreen();
  screen.state.JoinApplicationOpen = true;
  let calls = 0;
  const request = actionFromSource(controllerSource, "requestTeamMembership", {
    runTeamManagementMutation: screen.management(), team: { id: "team-a" },
    app: { actions: { requestTeamMembership: async () => ({ ok: ++calls > 1 }) } },
    setJoinApplicationOpen: screen.context.setJoinApplicationOpen,
  });
  const draft = normalizeTeamJoinApplication({ contact: "연락 방법", heightCm: 180 });
  const originalDraft = { ...draft };
  let validationError = "이전 입력 오류";
  const submit = actionFromSource(dialogSource, "submit", {
    pending: false, draft, getTeamJoinApplicationError, normalizeTeamJoinApplication,
    setError: (value) => { validationError = value; }, onSubmit: request,
  });
  await submit(submitEvent);
  assert.equal(screen.state.JoinApplicationOpen, true);
  assert.equal(screen.state.TeamManagementPending, false);
  assert.match(screen.state.TeamManagementError, /저장하지 못했습니다/);
  assert.equal(validationError, "");
  assert.deepEqual(draft, originalDraft);
  assert.match(viewSource, /<TeamJoinApplicationDialog[^>]*serverError=\{teamManagementError\}/);
  assert.match(dialogSource, /const displayedError = error \|\| serverError;/);
  assert.match(dialogSource, /role="alert">\{displayedError\}/);
  await submit(submitEvent);
  assert.equal(calls, 2);
  assert.equal(screen.state.JoinApplicationOpen, false);
  assert.equal(screen.state.TeamManagementError, "");
});

for (const outcome of ["success", "failure", "throw"]) {
  test(`이전 팀 관리 ${outcome} 응답은 새 팀 요청의 잠금과 오류를 건드리지 않는다`, async () => {
    const screen = createTeamScreen();
    const oldRequest = deferred();
    const completion = screen.management()(() => oldRequest.promise);
    screen.navigate("team-b");
    const newRequest = deferred();
    const newCompletion = screen.management()(() => newRequest.promise);
    screen.state.TeamManagementError = "B팀 안내";
    if (outcome === "throw") oldRequest.reject(new Error("offline"));
    else oldRequest.resolve({ ok: outcome === "success" });
    assert.equal(await completion, false);
    assert.equal(screen.state.TeamManagementPending, true);
    assert.equal(screen.state.TeamManagementError, "B팀 안내");
    newRequest.resolve({ ok: true });
    assert.equal(await newCompletion, true);
    assert.equal(screen.state.TeamManagementPending, false);
  });
}

test("A→B→A 이동 후 이전 A 요청은 새 A 요청으로 인정하지 않는다", async () => {
  const screen = createTeamScreen();
  const oldRequest = deferred();
  const completion = screen.management()(() => oldRequest.promise);
  screen.navigate("team-b");
  screen.navigate("team-a");
  const newRequest = deferred();
  const newCompletion = screen.management()(() => newRequest.promise);
  oldRequest.resolve({ ok: true });
  assert.equal(await completion, false);
  assert.equal(screen.state.TeamManagementPending, true);
  screen.leave();
  newRequest.resolve({ ok: false });
  assert.equal(await newCompletion, false);
  assert.equal(screen.state.TeamManagementError, "");
});

for (const outcome of ["success", "failure", "throw"]) {
  test(`이전 팀 초대 ${outcome} 응답은 새 팀 초대 선택과 잠금을 유지한다`, async () => {
    const screen = createTeamScreen();
    const oldRequest = deferred();
    const completion = screen.invite(() => oldRequest.promise)(submitEvent);
    screen.state.JoinApplicationOpen = true;
    screen.state.ReviewedJoinApplication = { applicantName: "A 지원자" };
    screen.navigate("team-b");
    assert.equal(screen.state.JoinApplicationOpen, false);
    assert.equal(screen.state.ReviewedJoinApplication, null);
    assert.equal(screen.state.TeamInvitePending, false);
    assert.deepEqual(screen.state.MemberDraft, { userId: "", role: "regular" });
    screen.state.MemberDraft = { userId: "B선수", role: "mercenary" };
    screen.state.MemberQuery = "B선수";
    screen.state.SelectedInviteProfile = { id: "B선수" };
    const newRequest = deferred();
    const newCompletion = screen.invite(() => newRequest.promise)(submitEvent);
    if (outcome === "throw") oldRequest.reject(new Error("offline"));
    else oldRequest.resolve({ ok: outcome === "success" });
    await completion;
    assert.equal(screen.state.TeamInvitePending, true);
    assert.equal(screen.state.TeamInviteError, "");
    assert.equal(screen.state.MemberDraft.userId, "B선수");
    assert.equal(screen.state.MemberQuery, "B선수");
    assert.equal(screen.state.SelectedInviteProfile.id, "B선수");
    newRequest.resolve({ ok: true });
    await newCompletion;
    assert.equal(screen.state.TeamInvitePending, false);
    assert.deepEqual(screen.state.MemberDraft, { userId: "", role: "regular" });
  });
}

test("초대 중 명단 변경 중복 실행을 막고 실패 후 다시 실행할 수 있다", async () => {
  const screen = createTeamScreen();
  const invitation = deferred();
  const completion = screen.invite(() => invitation.promise)(submitEvent);
  let calls = 0;
  const mutation = async () => { calls += 1; return { ok: true }; };
  assert.equal(await screen.management()(mutation), false);
  assert.equal(calls, 0);
  invitation.reject(new Error("offline"));
  await completion;
  assert.match(screen.state.TeamInviteError, /보내지 못했습니다/);
  assert.equal(await screen.management()(mutation), true);
  assert.equal(calls, 1);
});
