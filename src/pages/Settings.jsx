import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, Database, MapPin, Moon, Search, Send, ShieldCheck, Sun, UserRound } from "lucide-react";
import Button from "../components/common/Button.jsx";
import Card from "../components/common/Card.jsx";
import Badge from "../components/common/Badge.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import { DEFAULT_REPORT_REASON, REPORT_REASONS } from "../lib/reportReasons.js";
import { formatStatLine, getMatchReservePlayerIds, getMatchSidePlayerIds } from "../lib/matchUtils.js";
import { COURTS, REGIONS } from "../lib/constants.js";
import {
  REFEREE_EXAM_BANK_SIZE,
  REFEREE_EXAM_PASS_SCORE,
  REFEREE_EXAM_SIZE,
  REFEREE_EXAM_VERSION,
  getRefereeExamSet,
  gradeRefereeExam,
} from "../lib/refereeExamBank.js";
import { isSupabaseConfigured } from "../lib/supabase.js";

const REPORT_MATCH_WINDOW_DAYS = 7;
const REFEREE_EXAM_COOLDOWN_DAYS = 7;
const DEFAULT_COURT_REQUEST = {
  name: "",
  region: "마포",
  type: "야외",
  addressText: "",
  locationNote: "",
  courtKind: "street_hoop",
  paid: false,
  reservation: false,
};
const DEFAULT_REFEREE_REQUEST = {
  qualification: "community_exam",
  experience: "",
  memo: "",
};

function getMatchReportTime(match = {}) {
  const rawDate = match.endedAt ?? match.confirmedAt ?? match.scheduledDate ?? match.scheduledAt ?? match.createdAt;
  if (!rawDate) return 0;
  if (match.scheduledDate && rawDate === match.scheduledDate) {
    const time = match.scheduledTime || "00:00";
    const value = new Date(`${match.scheduledDate}T${time}`).getTime();
    return Number.isFinite(value) ? value : 0;
  }
  const value = new Date(rawDate).getTime();
  return Number.isFinite(value) ? value : 0;
}

function makeRefereeAttemptId() {
  return `rea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getLatestRefereeExamAttempt(attempts = [], userId) {
  return [...attempts]
    .filter((attempt) => attempt.userId === userId)
    .sort((a, b) => new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime())[0] ?? null;
}

function formatKoreanDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getReportParticipantRows(match = {}, userMap = {}) {
  const rows = [];
  const seen = new Set();
  const addSideRows = (sideName, role, playerIds) => {
    playerIds.forEach((userId) => {
      const user = userMap[userId];
      if (!user || seen.has(userId)) return;
      seen.add(userId);
      rows.push({
        userId,
        user,
        sideName,
        sideLabel: sideName === "teamA" ? "A사이드" : "B사이드",
        teamName: match[sideName]?.name ?? (sideName === "teamA" ? "A사이드" : "B사이드"),
        role,
        stats: match.result?.playerStats?.[userId] ?? match.playerStats?.[userId] ?? {},
      });
    });
  };

  addSideRows("teamA", "출전", getMatchSidePlayerIds(match, "teamA"));
  addSideRows("teamB", "출전", getMatchSidePlayerIds(match, "teamB"));
  addSideRows("teamA", "후보", getMatchReservePlayerIds(match, "teamA"));
  addSideRows("teamB", "후보", getMatchReservePlayerIds(match, "teamB"));
  return rows;
}

export default function Settings({ app, auth }) {
  const privacy = app.state.settings?.privacy ?? {};
  const theme = app.state.settings?.theme === "light" ? "light" : "dark";
  const blockedUserIds = app.state.settings?.blockedUserIds ?? [];
  const [blockUserId, setBlockUserId] = useState(app.state.users.find((user) => user.id !== app.currentUserId)?.id ?? "");
  const [reportMatchId, setReportMatchId] = useState(app.state.matches[0]?.id ?? "");
  const [reportReason, setReportReason] = useState(DEFAULT_REPORT_REASON);
  const [reportMemo, setReportMemo] = useState("");
  const [reportedUserIds, setReportedUserIds] = useState([]);
  const [accountQuery, setAccountQuery] = useState("");
  const [courtAddressQuery, setCourtAddressQuery] = useState("");
  const [courtDraft, setCourtDraft] = useState(() => ({
    ...DEFAULT_COURT_REQUEST,
    region: app.currentUser?.region ?? DEFAULT_COURT_REQUEST.region,
  }));
  const [refereeDraft, setRefereeDraft] = useState(DEFAULT_REFEREE_REQUEST);
  const [refereeExamSeed, setRefereeExamSeed] = useState(() => `${Date.now()}-${app.currentUserId}`);
  const [refereeExamOpen, setRefereeExamOpen] = useState(false);
  const [refereeExamAnswers, setRefereeExamAnswers] = useState({});
  const [refereeExamResult, setRefereeExamResult] = useState(null);
  const userMap = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const matchMap = useMemo(() => Object.fromEntries(app.state.matches.map((match) => [match.id, match])), [app.state.matches]);
  const courtRequests = app.state.settings?.courtRequests ?? [];
  const refereeRequests = app.state.settings?.refereeRequests ?? [];
  const refereeExamAttempts = app.state.settings?.refereeExamAttempts ?? [];
  const [currentRefereeExamAttemptId, setCurrentRefereeExamAttemptId] = useState("");
  const [refereeExamNotice, setRefereeExamNotice] = useState("");

  const blockableUsers = useMemo(
    () => app.state.users.filter((user) => user.id !== app.currentUserId && !blockedUserIds.includes(user.id)),
    [app.currentUserId, app.state.users, blockedUserIds],
  );
  const selectedBlockUserId = blockableUsers.some((user) => user.id === blockUserId) ? blockUserId : blockableUsers[0]?.id ?? "";
  const recentReportMatches = useMemo(() => {
    const now = Date.now();
    const cutoff = now - REPORT_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return [...app.state.matches]
      .map((match) => ({ match, reportTime: getMatchReportTime(match) }))
      .filter(({ match, reportTime }) => (
        reportTime >= cutoff &&
        reportTime <= now &&
        getReportParticipantRows(match, userMap).some((row) => row.userId === app.currentUserId)
      ))
      .sort((a, b) => b.reportTime - a.reportTime)
      .map(({ match }) => match);
  }, [app.currentUserId, app.state.matches, userMap]);
  const selectedReportMatchId = recentReportMatches.some((match) => match.id === reportMatchId) ? reportMatchId : recentReportMatches[0]?.id ?? "";
  const selectedReportMatch = recentReportMatches.find((match) => match.id === selectedReportMatchId) ?? null;
  const reportParticipantRows = useMemo(
    () => (selectedReportMatch ? getReportParticipantRows(selectedReportMatch, userMap) : []),
    [selectedReportMatch, userMap],
  );
  const reportParticipantIds = useMemo(
    () => reportParticipantRows.map((row) => row.userId),
    [reportParticipantRows],
  );
  const selectedReportedUserIds = reportedUserIds.filter((userId) => reportParticipantIds.includes(userId));
  const matchCountByUser = useMemo(() => {
    const counts = new Map();
    app.state.matches.forEach((match) => {
      [...(match.teamA?.players ?? []), ...(match.teamB?.players ?? [])].forEach((userId) => {
        counts.set(userId, (counts.get(userId) ?? 0) + 1);
      });
    });
    return counts;
  }, [app.state.matches]);
  const testAccounts = useMemo(
    () => app.state.users.filter((user) => user.testLoginId),
    [app.state.users],
  );
  const visibleTestAccounts = useMemo(() => {
    const keyword = accountQuery.trim().toLowerCase();
    return testAccounts
      .filter((user) => (
        keyword
          ? `${user.name} ${user.handle} ${user.region} ${user.position} ${user.testLoginId}`.toLowerCase().includes(keyword)
          : true
      ))
      .slice(0, 12);
  }, [accountQuery, testAccounts]);
  const averageMatches = testAccounts.length
    ? Math.round(testAccounts.reduce((sum, user) => sum + (matchCountByUser.get(user.id) ?? 0), 0) / testAccounts.length)
    : 0;
  const courtAddressResults = useMemo(() => {
    const keyword = courtAddressQuery.trim().toLowerCase();
    return COURTS
      .filter((court) => {
        const haystack = `${court.name} ${court.region} ${court.addressText} ${court.locationNote} ${court.hashtag}`.toLowerCase();
        return keyword ? haystack.includes(keyword) : court.region === courtDraft.region;
      })
      .slice(0, 5);
  }, [courtAddressQuery, courtDraft.region]);
  const refereeExamQuestions = useMemo(() => getRefereeExamSet(refereeExamSeed), [refereeExamSeed]);
  const answeredRefereeExamCount = Object.keys(refereeExamAnswers).length;
  const refereeExamRequired = refereeDraft.qualification === "community_exam";
  const refereeExamPassed = refereeExamResult?.passed === true;
  const latestRefereeExamAttempt = useMemo(
    () => getLatestRefereeExamAttempt(refereeExamAttempts, app.currentUserId),
    [app.currentUserId, refereeExamAttempts],
  );
  const refereeExamLockedUntilMs = latestRefereeExamAttempt?.availableAfter ? new Date(latestRefereeExamAttempt.availableAfter).getTime() : 0;
  const refereeExamLocked = Number.isFinite(refereeExamLockedUntilMs) && refereeExamLockedUntilMs > Date.now();
  const refereeExamLockLabel = refereeExamLocked ? formatKoreanDateTime(latestRefereeExamAttempt.availableAfter) : "";

  const submitBlock = (event) => {
    event.preventDefault();
    if (selectedBlockUserId) app.actions.blockUser(selectedBlockUserId);
  };
  const submitReport = (event) => {
    event.preventDefault();
    const memo = reportMemo.trim();
    const targetNames = selectedReportedUserIds.map((userId) => userMap[userId]?.name).filter(Boolean);
    const targetLine = targetNames.length ? `대상: ${targetNames.join(", ")}` : "대상: 경기 전체";
    if (selectedReportMatchId) app.actions.reportMatch(selectedReportMatchId, [reportReason, targetLine, memo].filter(Boolean).join(" · "), selectedReportedUserIds);
  };
  const updateCourtDraft = (patch) => setCourtDraft((current) => ({ ...current, ...patch }));
  const selectCourtAddress = (court) => {
    updateCourtDraft({
      name: courtDraft.name.trim() ? courtDraft.name : court.name,
      region: court.region,
      type: court.type,
      addressText: court.addressText,
      locationNote: court.locationNote,
      courtKind: court.courtKind,
      paid: court.paid,
      reservation: court.reservation,
    });
    setCourtAddressQuery(`${court.name} ${court.addressText}`);
  };
  const submitCourtRequest = (event) => {
    event.preventDefault();
    app.actions.submitCourtRequest(courtDraft);
    setCourtAddressQuery("");
    setCourtDraft({
      ...DEFAULT_COURT_REQUEST,
      region: app.currentUser?.region ?? DEFAULT_COURT_REQUEST.region,
    });
  };
  const updateRefereeDraft = (patch) => setRefereeDraft((current) => ({ ...current, ...patch }));
  const startRefereeExam = () => {
    if (refereeExamOpen && !refereeExamResult) {
      setRefereeExamNotice("이미 진행 중인 시험이 있습니다.");
      return;
    }
    if (refereeExamLocked) {
      setRefereeExamNotice(`심판 시험은 주 1회만 가능합니다. 다음 응시 가능: ${refereeExamLockLabel}`);
      return;
    }
    const nextSeed = `${Date.now()}-${app.currentUserId}-${Math.random()}`;
    const attemptId = makeRefereeAttemptId();
    setCurrentRefereeExamAttemptId(attemptId);
    setRefereeExamSeed(nextSeed);
    setRefereeExamAnswers({});
    setRefereeExamResult(null);
    setRefereeExamNotice("");
    app.actions.startRefereeExamAttempt({
      id: attemptId,
      seed: nextSeed,
      examVersion: REFEREE_EXAM_VERSION,
    });
    setRefereeExamOpen(true);
  };
  const selectRefereeExamAnswer = (questionId, answerIndex) => {
    if (refereeExamResult) return;
    setRefereeExamAnswers((current) => ({ ...current, [questionId]: answerIndex }));
  };
  const submitRefereeExam = () => {
    const result = gradeRefereeExam(refereeExamSeed, refereeExamAnswers);
    setRefereeExamResult(result);
    if (currentRefereeExamAttemptId) app.actions.finishRefereeExamAttempt(currentRefereeExamAttemptId, result);
  };
  const submitRefereeRequest = (event) => {
    event.preventDefault();
    app.actions.submitRefereeRequest({
      ...refereeDraft,
      examVersion: REFEREE_EXAM_VERSION,
      examScore: refereeExamResult?.score ?? 0,
      examTotal: refereeExamResult?.total ?? REFEREE_EXAM_SIZE,
      examPassed: refereeDraft.qualification === "official_license" ? false : refereeExamPassed,
      examAttemptId: currentRefereeExamAttemptId,
    });
    setRefereeDraft(DEFAULT_REFEREE_REQUEST);
    setCurrentRefereeExamAttemptId("");
    setRefereeExamAnswers({});
    setRefereeExamResult(null);
    setRefereeExamOpen(false);
  };
  const toggleReportedUser = (userId) => {
    setReportedUserIds((current) => (
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId]
    ));
  };

  useEffect(() => {
    setReportedUserIds((current) => {
      const next = current.filter((userId) => reportParticipantIds.includes(userId));
      return next.length === current.length ? current : next;
    });
  }, [reportParticipantIds]);

  return (
    <div className="page-stack">
      <header className="page-header">
        <div>
          <p className="eyebrow">Settings</p>
          <h1>설정</h1>
        </div>
      </header>
      <div className="content-grid">
        <div className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">데이터 모드</p>
                <h2>{isSupabaseConfigured ? "Supabase" : "localStorage demo"}</h2>
              </div>
              <Badge tone={isSupabaseConfigured ? "green" : "orange"}>{isSupabaseConfigured ? "연결됨" : "Demo"}</Badge>
            </div>
            <div className="contract-grid single">
              <div>
                <span>저장소</span>
                <strong>{isSupabaseConfigured ? "Cloud" : "Local"}</strong>
              </div>
              <div>
                <span>세션</span>
                <strong>{auth?.user ? auth.user.user_metadata?.providerName ?? "Test" : "Guest"}</strong>
              </div>
            </div>
          </Card>

          <Card className="section-card theme-choice-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">화면 테마</p>
                <h2>밝기</h2>
              </div>
              {theme === "light" ? <Sun size={22} /> : <Moon size={22} />}
            </div>
            <div className="segmented-control">
              <button
                type="button"
                className={theme === "light" ? "active" : ""}
                onClick={() => app.actions.updateSettings({ theme: "light" })}
              >
                라이트
              </button>
              <button
                type="button"
                className={theme === "dark" ? "active" : ""}
                onClick={() => app.actions.updateSettings({ theme: "dark" })}
              >
                다크
              </button>
            </div>
          </Card>

          <Card className="section-card admin-seed-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Admin Seed</p>
                <h2>테스트 리그 DB</h2>
              </div>
              <Database size={22} />
            </div>
            <div className="contract-grid single">
              <div>
                <span>로그인 계정</span>
                <strong>{testAccounts.length}개</strong>
              </div>
              <div>
                <span>경기 데이터</span>
                <strong>{app.state.matches.length}경기</strong>
              </div>
              <div>
                <span>평균 경기</span>
                <strong>{averageMatches}경기/계정</strong>
              </div>
              <div>
                <span>모집방</span>
                <strong>{app.state.recruitingPosts.length}개</strong>
              </div>
            </div>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Admin Login</p>
                <h2>테스트 계정 로그인</h2>
              </div>
              <UserRound size={22} />
            </div>
            <div className="admin-account-search">
              <Search size={18} />
              <input value={accountQuery} placeholder="이름, 지역, 포지션, rankball-001 검색" onChange={(event) => setAccountQuery(event.target.value)} />
            </div>
            <div className="admin-account-grid">
              {visibleTestAccounts.map((user) => (
                <button
                  key={user.id}
                  type="button"
                  className={user.id === app.currentUserId ? "active" : ""}
                  onClick={() => app.actions.switchUser(user.id)}
                >
                  <PlayerHoverCard as="span" user={user} teams={app.state.teams}>
                    <span className="avatar small" style={{ "--avatar": user.avatarColor }}>{user.name.slice(0, 1)}</span>
                    <strong>{user.name}</strong>
                  </PlayerHoverCard>
                  <em>{user.testLoginId} · {user.region} · {matchCountByUser.get(user.id) ?? 0}경기</em>
                </button>
              ))}
            </div>
            <label>
              전체 계정 선택
              <select value={app.currentUserId} onChange={(event) => app.actions.switchUser(event.target.value)}>
                {app.state.users.map((user) => (
                  <option key={user.id} value={user.id}>{user.testLoginId ? `${user.testLoginId} · ` : ""}{user.name} · {user.region} · {user.position}</option>
                ))}
              </select>
            </label>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">공개 범위</p>
                <h2>프로필 표시</h2>
              </div>
              <ShieldCheck size={22} />
            </div>
            <div className="settings-toggle-grid">
              <label>
                <input
                  type="checkbox"
                  checked={privacy.regionRanking !== false}
                  onChange={(event) => app.actions.updatePrivacySettings({ regionRanking: event.target.checked })}
                />
                지역 랭킹에 표시
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={privacy.teamHistory !== false}
                  onChange={(event) => app.actions.updatePrivacySettings({ teamHistory: event.target.checked })}
                />
                소속팀 히스토리 표시
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={privacy.statSummary !== false}
                  onChange={(event) => app.actions.updatePrivacySettings({ statSummary: event.target.checked })}
                />
                개인 스탯 요약 표시
              </label>
            </div>
          </Card>
        </div>

        <aside className="page-stack">
          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">초기화</p>
                <h2>샘플 데이터 복원</h2>
              </div>
            </div>
            <Button variant="secondary" onClick={app.actions.reset}>데모 데이터 초기화</Button>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Court</p>
                <h2>구장 등록요청</h2>
              </div>
              <MapPin size={22} />
            </div>
            <form className="form-stack" onSubmit={submitCourtRequest}>
              <div className="settings-address-search">
                <label>
                  주소 검색
                  <div className="admin-account-search">
                    <Search size={18} />
                    <input value={courtAddressQuery} placeholder="코트명, 주소, 해시태그 검색" onChange={(event) => setCourtAddressQuery(event.target.value)} />
                  </div>
                </label>
                <div className="settings-address-results">
                  {courtAddressResults.map((court) => (
                    <button key={court.id} type="button" onClick={() => selectCourtAddress(court)}>
                      <strong>{court.name}</strong>
                      <span>{court.region} · {court.addressText}</span>
                    </button>
                  ))}
                  {!courtAddressResults.length ? <span>검색 결과 없음. 직접 주소를 입력하세요.</span> : null}
                </div>
              </div>
              <label>
                구장명
                <input value={courtDraft.name} placeholder="예: 망원 나들목 골대" onChange={(event) => updateCourtDraft({ name: event.target.value })} />
              </label>
              <div className="ow-field-grid">
                <label>
                  지역
                  <select value={courtDraft.region} onChange={(event) => updateCourtDraft({ region: event.target.value })}>
                    {REGIONS.map((region) => <option key={region} value={region}>{region}</option>)}
                  </select>
                </label>
                <label>
                  유형
                  <select value={courtDraft.type} onChange={(event) => updateCourtDraft({ type: event.target.value })}>
                    <option value="야외">야외</option>
                    <option value="실내">실내</option>
                  </select>
                </label>
              </div>
              <label>
                주소
                <input value={courtDraft.addressText} placeholder="도로명/근처 주소" onChange={(event) => updateCourtDraft({ addressText: event.target.value })} />
              </label>
              <label>
                찾아가는 메모
                <textarea value={courtDraft.locationNote} placeholder="예: 나들목 지나 오른쪽 두 번째 골대" onChange={(event) => updateCourtDraft({ locationNote: event.target.value })} />
              </label>
              <div className="settings-toggle-grid">
                <label>
                  <input
                    type="checkbox"
                    checked={courtDraft.courtKind === "official"}
                    onChange={(event) => updateCourtDraft({ courtKind: event.target.checked ? "official" : "street_hoop" })}
                  />
                  정식구장
                </label>
                <label>
                  <input type="checkbox" checked={courtDraft.paid} onChange={(event) => updateCourtDraft({ paid: event.target.checked })} />
                  유료구장
                </label>
                <label>
                  <input type="checkbox" checked={courtDraft.reservation} onChange={(event) => updateCourtDraft({ reservation: event.target.checked })} />
                  구장예약됨
                </label>
              </div>
              <Button type="submit" variant="secondary" disabled={!courtDraft.name.trim() || !courtDraft.addressText.trim()}>
                <Send size={16} /> 등록요청
              </Button>
            </form>
            <div className="compact-list">
              {courtRequests.slice(0, 4).map((request) => (
                <div key={request.id}>
                  <span>{request.name} · {request.region}</span>
                  <strong>{request.status === "pending" ? "대기" : request.status}</strong>
                </div>
              ))}
              {!courtRequests.length ? <div><span>요청한 구장이 없습니다.</span><strong>{COURTS.length}개 등록</strong></div> : null}
            </div>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">차단</p>
                <h2>플레이어 숨김</h2>
              </div>
              <Badge tone={blockedUserIds.length ? "orange" : "neutral"}>{blockedUserIds.length}명</Badge>
            </div>
            <form className="form-stack" onSubmit={submitBlock}>
              <label>
                차단할 플레이어
                <select value={selectedBlockUserId} onChange={(event) => setBlockUserId(event.target.value)}>
                  {blockableUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.region}</option>)}
                </select>
              </label>
              <Button type="submit" variant="secondary" disabled={!selectedBlockUserId}>차단</Button>
            </form>
            <div className="compact-list">
              {blockedUserIds.length ? blockedUserIds.map((userId) => (
                <div key={userId}>
                  <span>{userMap[userId]?.name ?? "플레이어"}</span>
                  <button type="button" onClick={() => app.actions.unblockUser(userId)}>해제</button>
                </div>
              )) : <div><span>차단한 플레이어가 없습니다.</span><strong>0</strong></div>}
            </div>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">신고</p>
                <h2>경기 기록 신고</h2>
              </div>
              <Badge tone={app.state.reports?.length ? "orange" : "neutral"}>{app.state.reports?.length ?? 0}건</Badge>
            </div>
            <form className="form-stack" onSubmit={submitReport}>
              <label>
                경기
                <select
                  value={selectedReportMatchId}
                  disabled={!recentReportMatches.length}
                  onChange={(event) => {
                    setReportMatchId(event.target.value);
                    setReportedUserIds([]);
                  }}
                >
                  {!recentReportMatches.length ? <option value="">최근 7일 경기 없음</option> : null}
                  {recentReportMatches.map((match) => <option key={match.id} value={match.id}>{match.title}</option>)}
                </select>
                <small>최근 7일 내 내가 출전했거나 후보로 등록된 경기만 표시됩니다.</small>
              </label>
              {selectedReportMatch ? (
                <div className="report-player-picker">
                  <span>신고 대상</span>
                  <div>
                    {reportParticipantRows.map((row) => {
                      const checked = selectedReportedUserIds.includes(row.userId);
                      return (
                        <button key={row.userId} type="button" className={checked ? "selected" : ""} onClick={() => toggleReportedUser(row.userId)}>
                          <span className="avatar small" style={{ "--avatar": row.user.avatarColor }}>{row.user.name.slice(0, 1)}</span>
                          <span className="report-player-info">
                            <strong>{row.user.name}</strong>
                            <em>{row.sideLabel} · {row.teamName} · {row.role} · {row.user.position}</em>
                            <small>{formatStatLine(row.stats)}</small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <small>선택하지 않으면 경기 전체 신고로 접수됩니다.</small>
                </div>
              ) : (
                <div className="empty-state">최근 7일 내 신고할 경기가 없습니다.</div>
              )}
              <label>
                사유
                <select value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
                  {REPORT_REASONS.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                </select>
              </label>
              <label>
                상세 메모
                <textarea value={reportMemo} placeholder="상황을 짧게 적어주세요." onChange={(event) => setReportMemo(event.target.value)} />
              </label>
              <Button type="submit" variant="secondary" disabled={!selectedReportMatchId}>신고 접수</Button>
            </form>
            <div className="compact-list">
              {app.state.reports?.slice(0, 4).map((report) => (
                <div key={report.id}>
                  <span>{matchMap[report.targetId]?.title ?? "경기"} · {report.reason}</span>
                  <strong>{report.status}</strong>
                </div>
              ))}
            </div>
          </Card>

          <Card className="section-card">
            <div className="section-title-row">
              <div>
                <p className="eyebrow">Referee</p>
                <h2>심판 등록요청</h2>
              </div>
              <ShieldCheck size={22} />
            </div>
            <div className="referee-rulebook-panel compact">
              <div className="referee-rulebook-head">
                <div>
                  <span className="eyebrow">Study guide</span>
                  <strong>커뮤니티 심판 룰북</strong>
                  <p>문제 원문은 숨기고 판정 기준, 개인활약 기록 기준, 상황 예시만 따로 정리했다.</p>
                </div>
                <Badge tone="blue">학습자료</Badge>
              </div>
              <Link className="button button-secondary button-md" to="/app/referee-rulebook">
                <BookOpen size={16} /> 룰북 보기
              </Link>
            </div>
            <div className="referee-exam-panel">
              <div className="referee-exam-summary">
                <span><strong>{REFEREE_EXAM_BANK_SIZE}</strong>문제은행</span>
                <span><strong>{REFEREE_EXAM_SIZE}</strong>문항</span>
                <span><strong>{REFEREE_EXAM_PASS_SCORE}</strong>점 통과</span>
              </div>
              <p className={`referee-exam-lock ${refereeExamLocked ? "locked" : ""}`}>
                {refereeExamLocked
                  ? `주 1회 제한 중 · 다음 응시 가능 ${refereeExamLockLabel}`
                  : `시험 시작 후 ${REFEREE_EXAM_COOLDOWN_DAYS}일 동안 재응시할 수 없습니다.`}
              </p>
              {refereeExamNotice ? <p className="referee-exam-lock locked">{refereeExamNotice}</p> : null}
              <div className="referee-exam-actions">
                <Button type="button" variant="secondary" onClick={startRefereeExam} disabled={refereeExamLocked || (refereeExamOpen && !refereeExamResult)}>
                  {refereeExamOpen && !refereeExamResult ? "시험 진행 중" : "심판 시험 시작"}
                </Button>
                {refereeExamResult ? (
                  <Badge tone={refereeExamResult.passed ? "green" : "orange"}>
                    {refereeExamResult.score}/{refereeExamResult.total} · {refereeExamResult.passed ? "통과" : "미통과"}
                  </Badge>
                ) : (
                  <Badge tone="neutral">{answeredRefereeExamCount}/{REFEREE_EXAM_SIZE}</Badge>
                )}
              </div>
              {refereeExamOpen ? (
                <div className="referee-exam-list">
                  {refereeExamQuestions.map((question) => (
                    <div key={question.id} className="referee-exam-question">
                      <strong>{question.number}. {question.stem}</strong>
                      <div className="referee-exam-choice-grid">
                        {question.choices.map((choice, index) => {
                          const review = refereeExamResult?.reviewedById?.[question.id];
                          const selected = refereeExamAnswers[question.id] === index;
                          const checked = Boolean(refereeExamResult);
                          const correct = checked && review?.answerIndex === index;
                          const wrong = checked && selected && review?.answerIndex !== index;
                          return (
                            <button
                              key={choice}
                              type="button"
                              className={`${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrong ? "wrong" : ""}`}
                              onClick={() => selectRefereeExamAnswer(question.id, index)}
                            >
                              {choice}
                            </button>
                          );
                        })}
                      </div>
                      {refereeExamResult ? <small>{refereeExamResult.reviewedById?.[question.id]?.explanation}</small> : null}
                    </div>
                  ))}
                  <Button type="button" onClick={submitRefereeExam} disabled={answeredRefereeExamCount < REFEREE_EXAM_SIZE || Boolean(refereeExamResult)}>
                    채점하기
                  </Button>
                </div>
              ) : null}
            </div>
            <form className="form-stack" onSubmit={submitRefereeRequest}>
              <label>
                신청 유형
                <select value={refereeDraft.qualification} onChange={(event) => updateRefereeDraft({ qualification: event.target.value })}>
                  <option value="community_exam">커뮤니티 심판 시험</option>
                  <option value="official_license">정식 라이선스 보유</option>
                </select>
              </label>
              <label>
                심판 경험
                <input value={refereeDraft.experience} placeholder="예: 동호회 20경기, 학교대회 5경기" onChange={(event) => updateRefereeDraft({ experience: event.target.value })} />
              </label>
              <label>
                메모
                <textarea value={refereeDraft.memo} placeholder="자격증, 활동지역, 가능한 시간 등을 적어주세요." onChange={(event) => updateRefereeDraft({ memo: event.target.value })} />
              </label>
              <Button type="submit" variant="secondary" disabled={refereeExamRequired && !refereeExamPassed}>
                <Send size={16} /> 심판 등록요청
              </Button>
              {refereeExamRequired && !refereeExamPassed ? <small>커뮤니티 심판은 시험 통과 후 등록요청할 수 있습니다.</small> : null}
            </form>
            <div className="compact-list">
              {refereeRequests.slice(0, 4).map((request) => (
                <div key={request.id}>
                  <span>
                    {request.qualification === "official_license" ? "정식 라이선스" : "커뮤니티 시험"} · 신뢰도 {request.trustScore}
                    {request.examTotal ? ` · 시험 ${request.examScore}/${request.examTotal}` : ""}
                  </span>
                  <strong>{request.status === "pending" ? "대기" : request.status}</strong>
                </div>
              ))}
              {!refereeRequests.length ? <div><span>요청한 심판 등록이 없습니다.</span><strong>신뢰도 {app.currentUser?.trustScore ?? 0}</strong></div> : null}
            </div>
          </Card>
        </aside>
      </div>
    </div>
  );
}
