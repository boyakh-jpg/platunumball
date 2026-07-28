import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, FlaskConical, RotateCcw, ShieldCheck, Users } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import {
  PRACTICE_REDUCER_ACTIONS,
  PRACTICE_SELF_ID,
  acceptPracticeInvitations,
  approvePracticeDummyPlayers,
  completePracticeAttendance,
  confirmPracticeRecruitingRoom,
  createPracticeClockClient,
  createPracticeRecruitingRoom,
  createPracticeState,
  getPracticeProgress,
  runPracticeReducer,
  submitPracticeSampleResult,
} from "../lib/practiceMatch.js";
import { getMatchReservePlayerIds } from "../lib/matchUtils.js";
import { isPickupRoomFlow } from "../lib/roomFlow.js";
import CreateMatch from "./CreateMatch.jsx";
import { MatchRoomModal } from "./Matches.jsx";
import { RecruitingRoomModal } from "./Recruiting.jsx";

const PRACTICE_STEPS = ["방 만들기", "초대·응답", "출석·확정", "경기 진행", "기록 확인"];

function getPracticeInstruction(progress, match = null) {
  if (progress.phase === "recruiting" && progress.needsInvite) {
    const sideLabel = progress.inviteSide === "teamB" ? "B사이드" : "A사이드";
    const slotLabel = progress.inviteReserve ? "후보 빈 슬롯" : "출전 빈 슬롯";
    const targetLabel = progress.inviteTargetName ? `‘${progress.inviteTargetName}’ 선수를 검색·선택해` : "선수를 검색·선택해";
    return `${sideLabel} ${slotLabel}을 누르고 ${targetLabel} 직접 초대하세요.`;
  }
  if (progress.phase === "recruiting" && progress.pendingCount > 0) {
    return "초대를 보냈습니다. 연습 선수의 수락을 받은 뒤 공용 방 하단에서 매치를 확정하세요.";
  }
  if (progress.phase === "recruiting") {
    return "양쪽 인원이 찼습니다. 공용 방의 ‘매치 확정’을 눌러 경기 준비방으로 이동하세요.";
  }
  if (progress.phase === "checkin") {
    return isPickupRoomFlow(match)
      ? "연습 선수 출석을 처리한 뒤 ‘팀 나누기’에서 방식을 고르고 ‘배정 확정’을 누르세요."
      : "연습 선수 출석을 처리한 뒤 공용 방의 ‘경기 시작’을 직접 눌러보세요.";
  }
  if (progress.phase === "live") {
    return match?.rules?.gameClockEnabled
      ? "경기시계를 시작해 일시정지·샷클락을 시험하고, 예시 점수 또는 점수판을 기록한 뒤 경기를 종료하세요."
      : "공용 방에서 경기 진행 상태를 확인한 뒤 경기 종료를 눌러 기록 단계로 이동하세요.";
  }
  if (progress.phase === "postgame") {
    return match?.result
      ? "연습 선수 승인 후 본인 승인을 눌러 연습 기록을 확정하세요."
      : match?.refereeId
        ? "심판 예시 기록을 채운 뒤 최종 확정 단계를 확인하세요."
        : "경기 중 기록된 현재 팀 점수로 최종 확정하세요.";
  }
  if (progress.phase === "dispute") {
    return "이의가 있으면 방장이 판정합니다. 이의가 없으면 다른 참가자 승인 후 본인 승인을 진행하세요.";
  }
  if (progress.phase === "completed") {
    return "완료했습니다. 이 결과는 새로고침하거나 페이지를 나가면 사라집니다.";
  }
  return "실제 경기 만들기 화면에서 연습방 설정을 확인하고 생성하세요.";
}

export default function PracticeMatch({ app }) {
  const navigate = useNavigate();
  const [practiceState, setPracticeState] = useState(() => createPracticeState(app.state, app.currentUser));
  const stateRef = useRef(practiceState);
  const [practiceActorId, setPracticeActorId] = useState(PRACTICE_SELF_ID);
  const actorRef = useRef(PRACTICE_SELF_ID);
  const [postId, setPostId] = useState("");
  const [matchId, setMatchId] = useState("");
  const [roomOpen, setRoomOpen] = useState(false);
  const [helperStatus, setHelperStatus] = useState("");
  const [practiceSession, setPracticeSession] = useState(0);
  const [clockControllerId, setClockControllerId] = useState("");

  const commitState = useCallback((nextState) => {
    stateRef.current = nextState;
    setPracticeState(nextState);
  }, []);
  const selectPracticeActor = useCallback((actorId) => {
    const nextActorId = stateRef.current.users.some((user) => user.id === actorId)
      ? actorId
      : PRACTICE_SELF_ID;
    actorRef.current = nextActorId;
    setPracticeActorId(nextActorId);
  }, []);

  const resetPractice = useCallback(() => {
    const nextState = createPracticeState(app.state, app.currentUser);
    commitState(nextState);
    setPostId("");
    setMatchId("");
    setRoomOpen(false);
    setHelperStatus("");
    setClockControllerId("");
    selectPracticeActor(PRACTICE_SELF_ID);
    setPracticeSession((current) => current + 1);
  }, [app.currentUser, app.state, commitState, selectPracticeActor]);

  const practiceActions = useMemo(() => {
    const actions = {};
    PRACTICE_REDUCER_ACTIONS.forEach((actionName) => {
      actions[actionName] = (...args) => {
        const result = runPracticeReducer(stateRef.current, actionName, args, actorRef.current);
        if (result.applied) commitState(result.state);
        return result.applied;
      };
    });
    return {
      ...actions,
      finalizeMatch: (...args) => actions.finalizeMatchByAuthority?.(...args),
      createRecruitingPost: async (draft) => {
        const result = createPracticeRecruitingRoom(stateRef.current, draft, { inviteTutorial: true });
        if (!result.postId) return { ok: false, error: result.error };
        commitState(result.state);
        return result.postId;
      },
      confirmRecruitingMatch: async (targetPostId) => {
        const result = confirmPracticeRecruitingRoom(stateRef.current, targetPostId);
        if (!result.matchId) return "";
        commitState(result.state);
        return result.matchId;
      },
      loadDirectory: async () => ({ ok: true, count: 0 }),
      loadMatchDetail: async () => 1,
      loadRecruitingPost: async () => 1,
      loadRecruitingRegion: async () => 1,
      pollRecruitingChat: () => () => {},
      toggleFavoriteTeam: async () => true,
    };
  }, [commitState]);

  const practiceCurrentUser = practiceState.users.find((user) => user.id === practiceActorId)
    ?? practiceState.users.find((user) => user.id === PRACTICE_SELF_ID);
  const practiceApp = useMemo(() => ({
    state: practiceState,
    currentUser: practiceCurrentUser,
    currentUserId: practiceCurrentUser?.id ?? PRACTICE_SELF_ID,
    remoteReady: true,
    serverBusy: false,
    adminContext: null,
    directoryStatus: { loading: false, loaded: true, error: "" },
    recruitingPagination: { exhausted: true, loading: false },
    capabilities: { practice: true, remoteDirectory: false, roomShare: false },
    actions: practiceActions,
  }), [practiceActions, practiceCurrentUser, practiceState]);

  const forceEndPracticeMatch = useCallback(async (targetMatchId) => {
    const targetMatch = stateRef.current.matches.find((item) => item.id === targetMatchId);
    const managerId = targetMatch?.refereeId || targetMatch?.createdBy || PRACTICE_SELF_ID;
    const result = runPracticeReducer(stateRef.current, "endMatch", [targetMatchId], managerId);
    if (result.applied) commitState(result.state);
  }, [commitState]);
  const rawClockClient = useMemo(
    () => createPracticeClockClient(
      () => stateRef.current,
      () => actorRef.current,
      forceEndPracticeMatch,
    ),
    [forceEndPracticeMatch],
  );
  const clockClient = useCallback(async (...args) => {
    const response = await rawClockClient(...args);
    setClockControllerId(response?.clock?.controllerId ?? "");
    return response;
  }, [rawClockClient]);

  const progress = getPracticeProgress(practiceState, postId, matchId);
  const match = matchId ? practiceState.matches.find((item) => item.id === matchId) : null;
  useEffect(() => {
    if (!matchId || roomOpen || !match?.startedAt || match?.endedAt || match?.rules?.gameClockEnabled === false) {
      return undefined;
    }
    const pollClock = () => {
      clockClient(matchId, "read").catch(() => {});
    };
    pollClock();
    const intervalId = window.setInterval(pollClock, 15_000);
    return () => window.clearInterval(intervalId);
  }, [clockClient, match?.endedAt, match?.rules?.gameClockEnabled, match?.startedAt, matchId, roomOpen]);
  const instruction = getPracticeInstruction(progress, match);
  const pendingInvitationCount = progress.phase === "recruiting" ? Number(progress.pendingCount || 0) : 0;
  const practiceActorOptions = useMemo(() => {
    if (!match) return [];
    const activePlayerIds = [...(match.teamA?.players ?? []), ...(match.teamB?.players ?? [])];
    const reservePlayerIds = [
      ...getMatchReservePlayerIds(match, "teamA"),
      ...getMatchReservePlayerIds(match, "teamB"),
    ];
    const actorIds = [...new Set([
      match.createdBy,
      match.refereeId,
      ...activePlayerIds,
      ...reservePlayerIds,
    ].filter(Boolean))];
    return actorIds.map((actorId) => {
      const user = practiceState.users.find((candidate) => candidate.id === actorId);
      const roles = [
        actorId === match.createdBy ? "방장" : "",
        actorId === match.refereeId ? "심판" : "",
        activePlayerIds.includes(actorId) ? "출전 선수" : "",
        reservePlayerIds.includes(actorId) ? "후보 선수" : "",
        actorId === clockControllerId ? "경기시계 담당" : "",
      ].filter(Boolean);
      return { id: actorId, label: `${user?.name || "연습 선수"} · ${roles.join("·")}` };
    });
  }, [clockControllerId, match, practiceState.users]);

  const runHelper = () => {
    if (progress.phase === "recruiting" && pendingInvitationCount > 0) {
      commitState(acceptPracticeInvitations(stateRef.current, postId));
      setHelperStatus(`${pendingInvitationCount}명의 연습 선수가 초대를 수락했습니다.`);
      return;
    }
    if (progress.phase === "checkin") {
      commitState(completePracticeAttendance(stateRef.current, matchId));
      setHelperStatus(isPickupRoomFlow(match)
        ? "연습 선수 출석을 완료했습니다. 이제 팀 나누기와 배정 확정을 직접 해보세요."
        : "연습 선수 출석을 완료했습니다.");
      return;
    }
    if (progress.phase === "live" && !match?.result) {
      commitState(submitPracticeSampleResult(stateRef.current, matchId));
      setHelperStatus("예시 팀 점수를 경기 중 기록하고 경기를 종료했습니다.");
      return;
    }
    if (["postgame", "dispute"].includes(progress.phase) && !match?.result) {
      if (match?.refereeId) {
        commitState(submitPracticeSampleResult(stateRef.current, matchId));
        setHelperStatus("심판 예시 기록을 채웠습니다.");
      } else {
        commitState(approvePracticeDummyPlayers(stateRef.current, matchId));
        setHelperStatus("현재 팀 점수로 최종 확정했습니다.");
      }
      return;
    }
    if (["postgame", "dispute"].includes(progress.phase) && match?.result) {
      commitState(approvePracticeDummyPlayers(stateRef.current, matchId));
      setHelperStatus("예시 결과를 최종 확정했습니다.");
    }
  };

  const helperLabel = progress.phase === "recruiting" && pendingInvitationCount > 0
    ? `연습 선수 ${pendingInvitationCount}명 초대 수락`
    : progress.phase === "checkin"
      ? "연습 선수 출석 완료"
      : progress.phase === "live" && !match?.result
        ? "예시 팀 점수 기록 후 종료"
      : ["postgame", "dispute"].includes(progress.phase) && !match?.result
        ? match?.refereeId
          ? "심판 예시 기록 채우기"
          : "현재 팀 점수로 최종 확정"
        : ["postgame", "dispute"].includes(progress.phase) && match?.result
          ? "연습 결과 최종 확정"
          : "";
  const canSwitchToClockController = Boolean(
    progress.phase === "live"
    && match?.rules?.gameClockEnabled !== false
    && clockControllerId
    && practiceActorId !== clockControllerId,
  );

  const contextPanel = (
    <section className="practice-room-guide" aria-label="연습 진행 안내">
      <div>
        <span className="badge-row">
          <Badge tone="orange">연습방</Badge>
          <Badge tone="neutral">{progress.step}/5 · {progress.label}</Badge>
        </span>
        <strong>{instruction}</strong>
        <small>실제 전적·MMR·신뢰점수·알림에 저장되지 않습니다.</small>
        {helperStatus ? <em role="status">{helperStatus}</em> : null}
      </div>
      {practiceActorOptions.length ? (
        <label className="practice-role-switch">
          <span>현재 역할 화면 · 한 기기 체험</span>
          <select
            className="ui-control"
            value={practiceActorId}
            onChange={(event) => selectPracticeActor(event.target.value)}
          >
            {practiceActorOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
      ) : null}
      {canSwitchToClockController ? (
        <Button type="button" size="sm" onClick={() => selectPracticeActor(clockControllerId)}>
          경기시계 담당 화면으로 전환
        </Button>
      ) : null}
      {helperLabel ? <Button type="button" size="sm" onClick={runHelper}>{helperLabel}</Button> : null}
    </section>
  );

  const defaultCourt = practiceState.settings.approvedCourts?.[0];
  const initialDraft = useMemo(() => ({
    title: "처음 해보는 3v3 연습 경기",
    mode: "3v3",
    visibility: "private",
    timingType: "instant",
    hostJoinMode: "player",
    teamOnly: false,
    matchPurpose: "friendly",
    formationMode: "prearranged",
    ranked: false,
    official: false,
    preRegistered: false,
    mmrLimitMode: "off",
    approvalModeA: "all",
    approvalModeB: "all",
    benchCapacity: 1,
    gameClockEnabled: true,
    periodCount: 1,
    periodMinutes: 3,
    timeLimit: 3,
    courtId: defaultCourt?.id ?? "",
    court: defaultCourt?.name ?? "연습 코트",
    meetingPoint: "연습 코트 입구",
  }), [defaultCourt?.id, defaultCourt?.name]);

  return (
    <div className="practice-match-page">
      <Card as="header" className="practice-match-banner">
        <div>
          <span className="badge-row">
            <Badge tone="orange"><FlaskConical size={14} aria-hidden="true" /> 비저장 연습</Badge>
            <Badge tone="neutral">현재 서비스 화면</Badge>
          </span>
          <h1>처음부터 끝까지 한 번 해보기</h1>
          <p>방 설정은 실제 경기 만들기, 이후 단계는 실제 공용 방 모달과 경기시계를 사용합니다. 다른 연습 선수의 응답만 보조 버튼으로 처리합니다.</p>
        </div>
        <div className="practice-match-banner__actions ui-action-row">
          <Button as={Link} variant="secondary" size="sm" to="/app/guide?chapter=practice">
            <ArrowLeft size={16} aria-hidden="true" /> 설명으로
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={resetPractice}>
            <RotateCcw size={16} aria-hidden="true" /> 처음부터
          </Button>
        </div>
        <ol className="practice-match-steps" aria-label="연습 경기 순서">
          {PRACTICE_STEPS.map((label, index) => (
            <li
              className={index + 1 <= progress.step ? "is-active" : ""}
              key={label}
              aria-current={index + 1 === progress.step ? "step" : undefined}
            >
              {index + 1 < progress.step ? <CheckCircle2 size={16} aria-hidden="true" /> : <span>{index + 1}</span>}
              <strong>{label}</strong>
            </li>
          ))}
        </ol>
        <div className="practice-match-safety">
          <ShieldCheck size={18} aria-hidden="true" />
          <span>새로고침·페이지 이탈 시 초기화</span>
          <Users size={18} aria-hidden="true" />
          <span>참가자는 모두 격리된 연습용 선수</span>
        </div>
      </Card>

      {!postId && !matchId ? (
        <CreateMatch
          key={practiceSession}
          app={practiceApp}
          initialDraft={initialDraft}
          embedded
          practiceMode
          syncStepToUrl={false}
          onRecruitingCreated={(createdPostId) => {
            setPostId(createdPostId);
            setRoomOpen(true);
            setHelperStatus("");
          }}
          onCancel={() => navigate("/app/guide?chapter=practice")}
        />
      ) : null}

      {(postId || matchId) && !roomOpen ? (
        <Card className="practice-match-reopen">
          <div>
            <strong>연습방을 닫았습니다.</strong>
            <span>상태는 이 페이지를 나가기 전까지만 남아 있습니다.</span>
          </div>
          <Button type="button" onClick={() => setRoomOpen(true)}>연습방 다시 열기</Button>
        </Card>
      ) : null}

      {postId && roomOpen ? (
        <RecruitingRoomModal
          app={practiceApp}
          post={practiceState.recruitingPosts.find((post) => post.id === postId)}
          entryPoint="guide"
          contextPanel={contextPanel}
          skipInitialDetailLoad
          onRemake={resetPractice}
          onClose={() => setRoomOpen(false)}
          onOpenMatch={(createdMatchId) => {
            const createdMatch = stateRef.current.matches.find((item) => item.id === createdMatchId);
            selectPracticeActor(createdMatch?.refereeId || PRACTICE_SELF_ID);
            setMatchId(createdMatchId);
            setPostId("");
            setRoomOpen(true);
            setHelperStatus("");
          }}
        />
      ) : null}

      {matchId && roomOpen ? (
        <MatchRoomModal
          key={`${matchId}:${practiceActorId}`}
          app={practiceApp}
          matchId={matchId}
          entryPoint="guide"
          contextPanel={contextPanel}
          clockClient={clockClient}
          onRemake={resetPractice}
          onClose={() => setRoomOpen(false)}
        />
      ) : null}
    </div>
  );
}
