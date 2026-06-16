import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, PlusCircle, ShieldAlert, Swords, X } from "lucide-react";
import Button from "../components/common/Button.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { MATCH_MODES } from "../lib/constants.js";
import { getMatchEndDate } from "../lib/matchUtils.js";
import { getRecruitingLobby, getRecruitingSideCapacity, isRecruitingPostForUser } from "../lib/recruiting.js";

const STATUS_META = {
  contract: { label: "동의 대기", tone: "blue" },
  agreed: { label: "예정", tone: "green" },
  approval: { label: "결과 승인중", tone: "orange" },
  disputed: { label: "이의신청중", tone: "orange" },
  confirmed: { label: "기록 확정", tone: "green" },
  void: { label: "무효", tone: "neutral" },
  cancelled: { label: "취소", tone: "neutral" },
};

const VIEWS = [
  {
    id: "active",
    code: "MY",
    title: "내 일정",
    desc: "진행, 예정, 지난 경기",
    icon: CalendarDays,
    statuses: ["contract", "agreed", "approval", "disputed", "confirmed"],
  },
  {
    id: "todo",
    code: "ACTION",
    title: "처리 필요",
    desc: "동의, 승인, 보류",
    icon: ShieldAlert,
    statuses: ["contract", "approval", "disputed"],
  },
  {
    id: "scheduled",
    code: "SOON",
    title: "예정",
    desc: "진행 예정 경기",
    icon: Swords,
    statuses: ["agreed"],
  },
  {
    id: "closed",
    code: "CLOSED",
    title: "닫힘",
    desc: "취소와 무효",
    icon: CheckCircle2,
    statuses: ["cancelled", "void"],
  },
];

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const tournamentFormatLabels = {
  league: "리그",
  tournament: "토너먼트",
};
const tournamentMmrLabels = {
  gap_adjusted: "격차 보정",
  standard: "일반 MMR",
  event_only: "대회 점수만",
};
const tournamentStatusLabels = {
  draft: "팀장 승인 대기",
  active: "진행 중",
  scheduled: "예정",
  closed: "종료",
  cancelled: "취소",
};

function toDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMatchDate(match) {
  if (match.scheduledDate) return String(match.scheduledDate).slice(0, 10);
  const dateText = String(match.scheduledAt ?? match.createdAt ?? "");
  return dateText.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
}

function getMonthKey(value = toDateInputValue()) {
  return String(value).slice(0, 7);
}

function addMonths(monthKey, amount) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + amount, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addDays(dateValue, amount) {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return toDateInputValue(date);
}

function subtractMonths(dateValue, amount) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setMonth(date.getMonth() - amount);
  return toDateInputValue(date);
}

function getCalendarDays(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const lastDay = new Date(year, month, 0);
  const days = Array.from({ length: firstDay.getDay() }, () => "");

  for (let day = 1; day <= lastDay.getDate(); day += 1) {
    days.push(`${monthKey}-${String(day).padStart(2, "0")}`);
  }

  while (days.length % 7 !== 0) days.push("");
  return days;
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split("-");
  return `${year}.${month}`;
}

function formatDateLabel(dateValue) {
  if (!dateValue) return "날짜 전체";
  const [, month, day] = dateValue.split("-");
  return `${month}.${day}`;
}

function formatTournamentWindow(tournament) {
  return [tournament.startDate, tournament.endDate].filter(Boolean).join(" ~ ") || "일정 미정";
}

function compareSchedule(a, b) {
  const aKey = `${getMatchDate(a) || "9999-12-31"} ${a.scheduledTime ?? ""} ${a.scheduledAt ?? ""}`;
  const bKey = `${getMatchDate(b) || "9999-12-31"} ${b.scheduledTime ?? ""} ${b.scheduledAt ?? ""}`;
  return aKey.localeCompare(bKey);
}

function formatMatchTime(match) {
  return match.scheduledAt ?? match.createdAt?.slice(0, 16)?.replace("T", " ") ?? "시간 미정";
}

function getMatchStartDate(match) {
  const source = match.scheduledDate
    ? `${match.scheduledDate}T${match.scheduledTime || "00:00"}`
    : String(match.scheduledAt ?? "").replace(" ", "T");
  const parsed = new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function getMatchProcessMeta(match, now = new Date()) {
  if (match.status !== "agreed") return STATUS_META[match.status] ?? { label: match.status, tone: "blue" };
  const startAt = getMatchStartDate(match);
  const endAt = getMatchEndDate(match);
  const nowMs = now.getTime();
  if (startAt && nowMs < startAt.getTime()) return { label: "예정", tone: "green" };
  if (startAt && endAt && nowMs <= endAt.getTime()) return { label: "현재 진행", tone: "blue" };
  if (startAt && endAt && nowMs > endAt.getTime()) return { label: "경기 종료", tone: "orange" };
  return STATUS_META.agreed;
}

function shouldShowScoreBox(match) {
  return Boolean(match.result) || ["approval", "disputed", "confirmed", "void"].includes(match.status);
}

function getMatchPlayerCount(match) {
  return new Set([...(match.teamA?.players ?? []), ...(match.teamB?.players ?? [])]).size;
}

function formatMatchRules(match) {
  const targetScore = Number(match.rules?.targetScore ?? 0);
  const timeLimit = Number(match.rules?.timeLimit ?? 0);
  const rules = [
    targetScore ? `${targetScore}점` : "",
    timeLimit ? `${timeLimit}분` : "",
    match.rules?.winByTwo ? "2점차" : "",
    match.rules?.ball ?? "",
  ].filter(Boolean);
  return rules.join(" · ") || "룰 미정";
}

function getWinner(match) {
  const scoreA = Number(match.teamA.score ?? match.result?.scoreA ?? 0);
  const scoreB = Number(match.teamB.score ?? match.result?.scoreB ?? 0);
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA.name : match.teamB.name;
}

function getMatchActionLabel(match) {
  if (match.status === "contract") return "동의";
  if (match.status === "agreed") return "경기방";
  if (match.status === "approval" || match.status === "disputed") return "처리";
  return "보기";
}

function getViewCount(matches, view, userId) {
  return matches.filter((match) => shouldShowMatchInList(match, view, userId, false)).length;
}

function matchHasUser(match, userId) {
  return match.teamA.players.includes(userId) || match.teamB.players.includes(userId);
}

function getUserSideName(match, userId) {
  if (match.teamA.players.includes(userId)) return "teamA";
  if (match.teamB.players.includes(userId)) return "teamB";
  return null;
}

function userDecisionDone(match, userId) {
  const sideName = getUserSideName(match, userId);
  if (!sideName) return false;
  if (match.status === "contract") return (match.agreements?.[sideName] ?? []).includes(userId);
  if (match.status === "approval") return (match.approvals?.[sideName] ?? []).includes(userId);
  return false;
}

function shouldShowMatchForView(match, view, userId) {
  if (!view.statuses.includes(match.status)) return false;
  if ((view.id === "active" || view.id === "todo") && userDecisionDone(match, userId)) return false;
  return true;
}

function shouldShowMatchInList(match, view, userId, hasDateFilter) {
  if (!shouldShowMatchForView(match, view, userId)) return false;
  if (view.id === "active" && match.status === "confirmed" && !hasDateFilter) return false;
  return true;
}

function getRecruitingEntryForUser(lobby, userId, teamIds = []) {
  const teamIdSet = new Set(teamIds);
  return (lobby.entries ?? []).find((entry) => (
    entry.playerId === userId ||
    (entry.players ?? []).includes(userId) ||
    (entry.teamId && teamIdSet.has(entry.teamId))
  )) ?? null;
}

function getTeamCaptainId(team) {
  return team?.members?.find((member) => member.role === "captain")?.userId ?? null;
}

function getTournamentTeamStatus(tournament, teamId) {
  return tournament.teamStatuses?.[teamId] ?? "invited";
}

function getTournamentTeamIds(tournament) {
  return [...new Set([
    ...(tournament.teamIds ?? []),
    ...Object.keys(tournament.teamStatuses ?? {}),
  ].filter(Boolean))];
}

function getTournamentMatches(tournament, matchesById, matches = []) {
  const fromIds = (tournament.matchIds ?? []).map((matchId) => matchesById[matchId]).filter(Boolean);
  const source = fromIds.length ? fromIds : matches.filter((match) => match.tournamentId === tournament.id);
  return [...source].sort((a, b) => (a.tournamentRound ?? 0) - (b.tournamentRound ?? 0) || (a.tournamentFixture ?? 0) - (b.tournamentFixture ?? 0));
}

function getTournamentTeamRows(tournament, teamById, userById, currentUserId) {
  return getTournamentTeamIds(tournament)
    .map((teamId) => {
      const team = teamById[teamId];
      const captainId = getTeamCaptainId(team);
      const status = getTournamentTeamStatus(tournament, teamId);
      return {
        team,
        teamId,
        captainId,
        captainName: userById[captainId]?.name ?? "주장 미지정",
        status,
        canApprove: tournament.status === "draft" && captainId === currentUserId && status !== "accepted",
      };
    })
    .filter((row) => row.team);
}

function getTournamentPairingPreview(tournament) {
  return tournament.format === "tournament"
    ? tournament.bracket?.rounds?.[0]?.pairings ?? []
    : tournament.bracket?.fixtures ?? [];
}

export default function Matches({ app }) {
  const [viewId, setViewId] = useState("active");
  const [kindFilter, setKindFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [historyRangeMonths, setHistoryRangeMonths] = useState(1);
  const [calendarMonth, setCalendarMonth] = useState(getMonthKey());
  const [tournamentPanelOpen, setTournamentPanelOpen] = useState(true);
  const [selectedTournamentId, setSelectedTournamentId] = useState(null);
  const todayValue = toDateInputValue();
  const maxScheduleDate = addDays(todayValue, 365);
  const historyCutoffDate = subtractMonths(todayValue, historyRangeMonths);
  const selectedView = VIEWS.find((view) => view.id === viewId) ?? VIEWS[0];
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const matchesById = useMemo(() => Object.fromEntries(app.state.matches.map((match) => [match.id, match])), [app.state.matches]);
  const myTeamIds = useMemo(
    () => app.state.teams
      .filter((team) => team.members.some((member) => member.userId === app.currentUser.id))
      .map((team) => team.id),
    [app.currentUser.id, app.state.teams],
  );
  const activeTournaments = useMemo(() => {
    return [...(app.state.tournaments ?? [])]
      .filter((tournament) => !["closed", "cancelled"].includes(tournament.status))
      .filter((tournament) => tournament.createdBy === app.currentUser.id || getTournamentTeamIds(tournament).some((teamId) => myTeamIds.includes(teamId)))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
  }, [app.currentUser.id, app.state.tournaments, myTeamIds]);
  const selectedTournament = useMemo(
    () => activeTournaments.find((tournament) => tournament.id === selectedTournamentId) ?? null,
    [activeTournaments, selectedTournamentId],
  );
  useBodyScrollLock(Boolean(selectedTournament));

  const baseFilteredMatches = useMemo(() => {
    return [...app.state.matches]
      .filter((match) => matchHasUser(match, app.currentUser.id))
      .filter((match) => {
        const matchDate = getMatchDate(match);
        if (!matchDate) return true;
        if (matchDate > maxScheduleDate) return false;
        if (["confirmed", "cancelled", "void"].includes(match.status) && matchDate < historyCutoffDate) return false;
        return true;
      })
      .filter((match) => kindFilter === "all" || (kindFilter === "ranked" ? match.ranked !== false : match.ranked === false))
      .filter((match) => modeFilter === "all" || match.mode === modeFilter);
  }, [app.currentUser.id, app.state.matches, historyCutoffDate, kindFilter, maxScheduleDate, modeFilter]);

  const filteredMatches = useMemo(() => {
    return baseFilteredMatches.filter((match) => !dateFilter || getMatchDate(match) === dateFilter);
  }, [baseFilteredMatches, dateFilter]);

  const calendarMatches = useMemo(() => {
    const recruitingRooms = [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status === "open")
      .filter((post) => isRecruitingPostForUser(post, app.currentUser.id, myTeamIds))
      .filter((post) => {
        const postDate = getMatchDate(post);
        return postDate && postDate <= maxScheduleDate;
      })
      .filter((post) => kindFilter === "all" || (kindFilter === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter);
    const displayableMatches = baseFilteredMatches.filter((match) => (
      getMatchDate(match) && VIEWS.some((view) => shouldShowMatchForView(match, view, app.currentUser.id))
    ));
    return [...displayableMatches, ...recruitingRooms];
  }, [app.currentUser.id, app.state.recruitingPosts, baseFilteredMatches, kindFilter, maxScheduleDate, modeFilter, myTeamIds]);

  const calendarCounts = useMemo(() => {
    return calendarMatches.reduce((map, match) => {
      const date = getMatchDate(match);
      map.set(date, (map.get(date) ?? 0) + 1);
      return map;
    }, new Map());
  }, [calendarMatches]);

  const calendarDays = useMemo(() => getCalendarDays(calendarMonth), [calendarMonth]);
  const calendarMonthCount = calendarDays.reduce((sum, day) => sum + (calendarCounts.get(day) ?? 0), 0);
  const visibleRecruitingCandidates = useMemo(() => {
    return [...(app.state.recruitingPosts ?? [])]
      .filter((post) => post.status === "open")
      .filter((post) => isRecruitingPostForUser(post, app.currentUser.id, myTeamIds))
      .filter((post) => {
        const postDate = getMatchDate(post);
        return postDate && postDate <= maxScheduleDate;
      })
      .filter((post) => kindFilter === "all" || (kindFilter === "ranked" ? post.ranked !== false : post.ranked === false))
      .filter((post) => modeFilter === "all" || post.mode === modeFilter);
  }, [app.currentUser.id, app.state.recruitingPosts, kindFilter, maxScheduleDate, modeFilter, myTeamIds]);
  const getViewIdForDate = (day) => {
    if (visibleRecruitingCandidates.some((post) => getMatchDate(post) === day)) return "active";
    const dayMatches = baseFilteredMatches.filter((match) => getMatchDate(match) === day);
    const preferredView = VIEWS.find((view) => dayMatches.some((match) => shouldShowMatchForView(match, view, app.currentUser.id)));
    return preferredView?.id ?? (day < todayValue ? "history" : "active");
  };

  const matchesByView = useMemo(() => {
    return filteredMatches
      .filter((match) => shouldShowMatchInList(match, selectedView, app.currentUser.id, Boolean(dateFilter)))
      .sort(compareSchedule);
  }, [app.currentUser.id, dateFilter, filteredMatches, selectedView]);

  const visibleRecruitingRooms = useMemo(() => {
    if (viewId !== "active") return [];
    return visibleRecruitingCandidates
      .filter((post) => {
        const postDate = getMatchDate(post);
        return !dateFilter || postDate === dateFilter;
      })
      .sort(compareSchedule)
      .slice(0, 12);
  }, [dateFilter, viewId, visibleRecruitingCandidates]);

  const visibleMatches = matchesByView.slice(0, 60);
  const hideEmptyMatchList = viewId === "active" && visibleRecruitingRooms.length > 0 && !visibleMatches.length;
  const activeCount = getViewCount(filteredMatches, VIEWS[0], app.currentUser.id);
  const todoCount = getViewCount(filteredMatches, VIEWS[1], app.currentUser.id);
  const scheduledCount = getViewCount(filteredMatches, VIEWS[2], app.currentUser.id);
  const saveTournamentSchedule = (event, tournamentId, matchId) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    app.actions.updateTournamentMatchSchedule(tournamentId, matchId, {
      scheduledDate: form.get("scheduledDate"),
      scheduledTime: form.get("scheduledTime"),
    });
  };

  return (
    <div className="page-stack om-match-page">
      <section className="om-match-hero">
        <div className="om-match-copy">
          <span className="om-kicker">MATCH QUEUE</span>
          <h1>내 경기</h1>
          <p>내가 들어간 진행, 예정, 지난 경기를 날짜별로 본다.</p>
        </div>
        <div className="om-match-panel">
          <div className="om-match-stats">
            <span><strong>{activeCount}</strong>MY</span>
            <span><strong>{todoCount}</strong>ACTION</span>
            <span><strong>{scheduledCount}</strong>SOON</span>
          </div>
          <Link to="/app/create">
            <Button className="om-match-create"><PlusCircle size={18} /> 경기 만들기</Button>
          </Link>
        </div>
      </section>

      <section className="om-view-grid" aria-label="경기 상태">
        {VIEWS.map((view) => {
          const Icon = view.icon;
          const active = view.id === viewId;
          return (
            <button
              key={view.id}
              type="button"
              className={active ? "om-view-card active" : "om-view-card"}
              onClick={() => setViewId(view.id)}
            >
              <span className="om-view-icon"><Icon size={22} /></span>
              <span>
                <small>{view.code}</small>
                <strong>{view.title}</strong>
                <em>{view.desc}</em>
              </span>
              <b>{getViewCount(baseFilteredMatches, view, app.currentUser.id)}</b>
            </button>
          );
        })}
      </section>

      <section className="om-calendar-panel" aria-label="진행 경기 캘린더">
        <div className="om-calendar-summary">
          <span className="om-view-icon"><CalendarDays size={22} /></span>
          <div>
            <span className="om-kicker">SCHEDULE</span>
            <h2>내 진행 일정</h2>
            <p>{dateFilter ? `${formatDateLabel(dateFilter)} 내 경기만 표시` : "내가 들어간 진행 중이거나 예정된 경기를 날짜별로 본다."}</p>
          </div>
          <div className="om-calendar-actions">
            <button type="button" className={!dateFilter ? "active" : ""} onClick={() => setDateFilter("")}>전체</button>
            <button
              type="button"
              className={dateFilter === todayValue ? "active" : ""}
              onClick={() => {
                setDateFilter(todayValue);
                setCalendarMonth(getMonthKey(todayValue));
                setViewId("active");
              }}
            >
              오늘
            </button>
          </div>
          <div className="om-history-range" aria-label="지난 경기 표시 범위">
            <span>지난 경기</span>
            {[1, 3, 6].map((month) => (
              <button
                key={month}
                type="button"
                className={historyRangeMonths === month ? "active" : ""}
                onClick={() => setHistoryRangeMonths(month)}
              >
                {month}개월
              </button>
            ))}
          </div>
        </div>

        <div className="om-calendar-box">
          <div className="om-calendar-toolbar">
            <button type="button" aria-label="이전 달" onClick={() => setCalendarMonth((month) => addMonths(month, -1))}>
              <ChevronLeft size={18} />
            </button>
            <strong>
              {formatMonthLabel(calendarMonth)}
              <span>{calendarMonthCount}경기</span>
            </strong>
            <button type="button" aria-label="다음 달" onClick={() => setCalendarMonth((month) => addMonths(month, 1))}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="om-calendar-weekdays">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="om-calendar-grid">
            {calendarDays.map((day, index) => {
              const count = calendarCounts.get(day) ?? 0;
              const selected = day && day === dateFilter;
              const isToday = day && day === todayValue;
              return day ? (
                <button
                  key={day}
                  type="button"
                  className={`${selected ? "active" : ""} ${isToday ? "today" : ""}`}
                  onClick={() => {
                    setDateFilter(day);
                    setViewId(getViewIdForDate(day));
                  }}
                >
                  <strong>{Number(day.slice(-2))}</strong>
                  {count ? <span>{count}</span> : null}
                </button>
              ) : (
                <span key={`empty-${index}`} />
              );
            })}
          </div>
        </div>
      </section>

      {activeTournaments.length ? (
        <section className={tournamentPanelOpen ? "om-tournament-panel" : "om-tournament-panel collapsed"} aria-label="비공개 대회">
          <div className="om-list-head">
            <div>
              <span className="om-kicker">PRIVATE EVENT</span>
              <h2>비공개 대회</h2>
            </div>
            <div className="om-tournament-head-actions">
              <span>{activeTournaments.length}개</span>
              <button type="button" onClick={() => setTournamentPanelOpen((current) => !current)}>
                {tournamentPanelOpen ? "접기" : "펼치기"}
              </button>
            </div>
          </div>
          <div className={tournamentPanelOpen ? "om-tournament-grid" : "om-tournament-grid compact"}>
            {activeTournaments.map((tournament) => {
              const tournamentMatches = getTournamentMatches(tournament, matchesById, app.state.matches);
              const teamRows = getTournamentTeamRows(tournament, teamById, userById, app.currentUser.id);
              const acceptedCount = teamRows.filter((row) => row.status === "accepted").length;
              const pendingRows = teamRows.filter((row) => row.status !== "accepted");
              return (
                <article key={tournament.id} className="om-tournament-card">
                  <div>
                    <span className="om-kicker">{tournamentFormatLabels[tournament.format] ?? tournament.format}</span>
                    <h3>{tournament.title}</h3>
                    <p><CalendarDays size={15} />{formatTournamentWindow(tournament)} · {tournament.court}</p>
                  </div>
                  <div className="om-tournament-meta">
                    <span>{tournament.mode}</span>
                    <span>{tournament.ranked === false ? "친선" : "정규"}</span>
                    <span>{tournamentMmrLabels[tournament.mmrPolicy] ?? tournament.mmrPolicy}</span>
                    <strong>{acceptedCount}/{teamRows.length} 승인</strong>
                    <strong>{tournamentMatches.length}경기</strong>
                  </div>
                  <div className="om-tournament-state">
                    <span>{tournamentStatusLabels[tournament.status] ?? tournament.status}</span>
                    <em>{pendingRows.length ? `${pendingRows.length}팀 승인 대기` : "참가 승인 완료"}</em>
                  </div>
                  <div className="om-tournament-actions">
                    <button type="button" onClick={() => setSelectedTournamentId(tournament.id)}>자세히</button>
                    <Link className="button button-secondary button-md om-tournament-detail-link" to={`/app/tournaments/${tournament.id}`}>
                      대진표
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {selectedTournament ? (() => {
        const tournamentMatches = getTournamentMatches(selectedTournament, matchesById, app.state.matches);
        const teamRows = getTournamentTeamRows(selectedTournament, teamById, userById, app.currentUser.id);
        const pendingRows = teamRows.filter((row) => row.status !== "accepted");
        const acceptedCount = teamRows.length - pendingRows.length;
        const pairingPreview = getTournamentPairingPreview(selectedTournament);
        const canManageSchedule = selectedTournament.createdBy === app.currentUser.id;
        return (
          <div className="om-tournament-modal-backdrop" role="presentation" onMouseDown={() => setSelectedTournamentId(null)}>
            <aside className="om-tournament-modal" role="dialog" aria-modal="true" aria-label="대회 상세" onMouseDown={(event) => event.stopPropagation()}>
              <div className="om-tournament-modal-head">
                <div>
                  <span className="om-kicker">{tournamentFormatLabels[selectedTournament.format] ?? selectedTournament.format}</span>
                  <h2>{selectedTournament.title}</h2>
                  <p>{formatTournamentWindow(selectedTournament)} · {selectedTournament.court}</p>
                </div>
                <button type="button" aria-label="닫기" onClick={() => setSelectedTournamentId(null)}><X size={20} /></button>
              </div>

              <div className="om-tournament-meta">
                <span>{selectedTournament.mode}</span>
                <span>{selectedTournament.ranked === false ? "친선" : "정규"}</span>
                <span>{tournamentMmrLabels[selectedTournament.mmrPolicy] ?? selectedTournament.mmrPolicy}</span>
                <strong>{acceptedCount}/{teamRows.length} 승인</strong>
                <strong>{tournamentMatches.length}경기</strong>
              </div>

              <section className="om-tournament-modal-section">
                <div className="om-modal-section-head">
                  <strong>승인 대기</strong>
                  <span>{pendingRows.length ? `${pendingRows.length}팀 남음` : "완료"}</span>
                </div>
                {pendingRows.length ? (
                  <div className="om-tournament-teams">
                    {pendingRows.map((row) => (
                      <div key={row.teamId}>
                        <span>
                          <TeamHoverCard team={row.team}><strong>{row.team.name}</strong></TeamHoverCard>
                          <em>{row.team.mmr} MMR · 주장 {row.captainName}</em>
                        </span>
                        {row.canApprove ? (
                          <button type="button" onClick={() => app.actions.approveTournamentTeam(selectedTournament.id, row.teamId)}>승인</button>
                        ) : (
                          <b>초대</b>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="om-tournament-wait">참가팀 승인 완료. 승인 완료팀 목록은 접었다.</p>
                )}
              </section>

              {pairingPreview.length ? (
                <section className="om-tournament-modal-section">
                  <div className="om-modal-section-head">
                    <strong>{selectedTournament.format === "tournament" ? "첫 라운드" : "리그 경기"}</strong>
                    <Link to={`/app/tournaments/${selectedTournament.id}`}>전체 대진표</Link>
                  </div>
                  <div className="om-tournament-pairings">
                    {pairingPreview.slice(0, 6).map((pairing) => (
                      <span key={pairing.matchId ?? `${pairing.round}-${pairing.fixture}`}>
                        <TeamHoverCard team={teamById[pairing.teamAId]}>{teamById[pairing.teamAId]?.name ?? "TBD"}</TeamHoverCard>
                        {" vs "}
                        <TeamHoverCard team={teamById[pairing.teamBId]}>{teamById[pairing.teamBId]?.name ?? "TBD"}</TeamHoverCard>
                      </span>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className="om-tournament-modal-section">
                <div className="om-modal-section-head">
                  <strong>경기 일정</strong>
                  <span>{canManageSchedule ? "생성자 수정 가능" : "생성자만 수정"}</span>
                </div>
                {tournamentMatches.length ? (
                  <div className="om-tournament-fixtures">
                    {tournamentMatches.map((match) => (
                      <form key={match.id} className={canManageSchedule ? "om-tournament-fixture-row" : "om-tournament-fixture-row locked"} onSubmit={(event) => saveTournamentSchedule(event, selectedTournament.id, match.id)}>
                        <Link to={`/app/matches/${match.id}`}>
                          <TeamHoverCard team={teamById[match.teamA.teamId]} as="span">{match.teamA.name}</TeamHoverCard>
                          {" vs "}
                          <TeamHoverCard team={teamById[match.teamB.teamId]} as="span">{match.teamB.name}</TeamHoverCard>
                        </Link>
                        <input type="date" name="scheduledDate" min={todayValue} max={maxScheduleDate} defaultValue={match.scheduledDate ?? ""} disabled={!canManageSchedule} aria-label="경기 날짜" />
                        <input type="time" name="scheduledTime" defaultValue={match.scheduledTime ?? ""} disabled={!canManageSchedule} aria-label="경기 시간" />
                        <button type="submit" disabled={!canManageSchedule}>저장</button>
                      </form>
                    ))}
                  </div>
                ) : (
                  <p className="om-tournament-wait">승인 완료 전. 대진과 경기 생성 대기.</p>
                )}
              </section>
            </aside>
          </div>
        );
      })() : null}

      <section className="om-filter-bar" aria-label="경기 필터">
        <div className="segmented-control compact-segments">
          <button type="button" className={kindFilter === "all" ? "active" : ""} onClick={() => setKindFilter("all")}>전체</button>
          <button type="button" className={kindFilter === "ranked" ? "active" : ""} onClick={() => setKindFilter("ranked")}>정규전</button>
          <button type="button" className={kindFilter === "friendly" ? "active" : ""} onClick={() => setKindFilter("friendly")}>친선전</button>
        </div>
        <label>
          모드
          <select value={modeFilter} onChange={(event) => setModeFilter(event.target.value)}>
            <option value="all">전체 모드</option>
            {MATCH_MODES.map((mode) => <option key={mode.id} value={mode.id}>{mode.label}</option>)}
          </select>
        </label>
      </section>

      {visibleRecruitingRooms.length ? (
        <section className="om-match-list" aria-label="확정 전 매칭방">
          <div className="om-list-head">
            <div>
              <span className="om-kicker">OPEN ROOM</span>
              <h2>확정 전 매칭방</h2>
            </div>
            <span>{visibleRecruitingRooms.length}개</span>
          </div>
          {visibleRecruitingRooms.map((post) => {
            const lobby = getRecruitingLobby(post, app.state);
            const myEntry = getRecruitingEntryForUser(lobby, app.currentUser.id, myTeamIds);
            const needConfirm = myEntry && myEntry.status !== "ready";
            const filled = lobby.sides.teamA.projectedFilled + lobby.sides.teamB.projectedFilled;
            const capacity = getRecruitingSideCapacity(post) * 2;
            return (
              <article key={post.id} className="om-match-card om-status-contract">
                <div className="om-card-main">
                  <div className="om-card-kicker">
                    <span className={`om-status-pill ${needConfirm ? "orange" : "blue"}`}>{needConfirm ? "재확인 필요" : "확정 대기"}</span>
                    <span className="om-card-mode">{post.mode}</span>
                    <span className="om-card-official">{post.ranked === false ? "친선" : "정규"}</span>
                  </div>
                  <h3>{post.title}</h3>
                  <p><CalendarDays size={15} />{formatMatchTime(post)} · {post.court}</p>
                </div>
                <div className="om-score-box">
                  <span>A {lobby.sides.teamA.projectedFilled}/{lobby.sides.teamA.capacity}</span>
                  <strong>{filled}/{capacity}</strong>
                  <span>B {lobby.sides.teamB.projectedFilled}/{lobby.sides.teamB.capacity}</span>
                  <span>{lobby.canConfirm ? "방장 확정 가능" : "인원 충원 중"}</span>
                </div>
                <Link className="button button-secondary button-md om-room-link" to={`/app/recruiting?post=${post.id}`}>
                  {needConfirm ? "참여 유지" : "방 보기"}
                </Link>
              </article>
            );
          })}
        </section>
      ) : null}

      {!hideEmptyMatchList ? (
      <section className="om-match-list" aria-label="경기 목록">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">{selectedView.code}</span>
            <h2>{dateFilter ? `${selectedView.title} · ${formatDateLabel(dateFilter)}` : selectedView.title}</h2>
          </div>
          <span>내 일정 {matchesByView.length}개 중 {visibleMatches.length}개 표시</span>
        </div>

        {visibleMatches.length ? visibleMatches.map((match) => {
          const status = getMatchProcessMeta(match);
          const showScoreBox = shouldShowScoreBox(match);
          const scoreA = match.teamA.score ?? match.result?.scoreA ?? 0;
          const scoreB = match.teamB.score ?? match.result?.scoreB ?? 0;
          const winner = getWinner(match);

          return (
            <article key={match.id} className={`om-match-card om-status-${match.status}`}>
              <div className="om-card-main">
                <div className="om-card-kicker">
                  <span className={`om-status-pill ${status.tone}`}>{status.label}</span>
                  <span className="om-card-mode">{match.mode}</span>
                  <span className="om-card-official">{match.official ? "공식" : "일반"}</span>
                </div>
                <h3>{match.title}</h3>
                <p><CalendarDays size={15} />{formatMatchTime(match)} · {match.court}</p>
              </div>
              {showScoreBox ? (
                <div className="om-score-box">
                  <TeamHoverCard team={teamById[match.teamA.teamId]} to={`/app/teams/${match.teamA.teamId}`}>{match.teamA.name}</TeamHoverCard>
                  <strong>{scoreA} : {scoreB}</strong>
                  <TeamHoverCard team={teamById[match.teamB.teamId]} to={`/app/teams/${match.teamB.teamId}`}>{match.teamB.name}</TeamHoverCard>
                  {winner ? <span>{winner} 우세</span> : null}
                </div>
              ) : (
                <div className="om-match-info-box">
                  <div>
                    <TeamHoverCard team={teamById[match.teamA.teamId]} to={`/app/teams/${match.teamA.teamId}`}>{match.teamA.name}</TeamHoverCard>
                    <strong>vs</strong>
                    <TeamHoverCard team={teamById[match.teamB.teamId]} to={`/app/teams/${match.teamB.teamId}`}>{match.teamB.name}</TeamHoverCard>
                  </div>
                  <span>참여 {getMatchPlayerCount(match)}명 · A {match.teamA.players?.length ?? 0} / B {match.teamB.players?.length ?? 0}</span>
                  <span>{formatMatchRules(match)}</span>
                </div>
              )}
              <Link className="button button-secondary button-md om-room-link" to={`/app/matches/${match.id}`}>
                {getMatchActionLabel(match)}
              </Link>
            </article>
          );
        }) : (
          <div className="om-empty-state">
            <strong>해당 큐 없음</strong>
            <p>다른 상태를 선택하거나 새 경기를 만든다.</p>
          </div>
        )}
      </section>
      ) : null}
    </div>
  );
}
