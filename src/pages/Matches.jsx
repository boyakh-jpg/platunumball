import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, PlusCircle, ShieldAlert, Swords, Trophy, X } from "lucide-react";
import Button from "../components/common/Button.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import useBodyScrollLock from "../hooks/useBodyScrollLock.js";
import { MATCH_MODES } from "../lib/constants.js";

const STATUS_META = {
  contract: { label: "동의", tone: "blue" },
  agreed: { label: "예정", tone: "green" },
  approval: { label: "승인", tone: "orange" },
  disputed: { label: "보류", tone: "orange" },
  confirmed: { label: "확정", tone: "green" },
  void: { label: "무효", tone: "neutral" },
  cancelled: { label: "취소", tone: "neutral" },
};

const VIEWS = [
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
    icon: CalendarDays,
    statuses: ["agreed"],
  },
  {
    id: "active",
    code: "LIVE",
    title: "전체 진행",
    desc: "동의, 예정, 승인, 보류",
    icon: Swords,
    statuses: ["contract", "agreed", "approval", "disputed"],
  },
  {
    id: "done",
    code: "DONE",
    title: "기록",
    desc: "확정된 경기",
    icon: Trophy,
    statuses: ["confirmed"],
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

const ACTIVE_STATUSES = new Set(["contract", "agreed", "approval", "disputed"]);
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

function compareRecent(a, b) {
  return String(b.scheduledAt ?? b.createdAt ?? "").localeCompare(String(a.scheduledAt ?? a.createdAt ?? ""));
}

function compareSchedule(a, b) {
  const aKey = `${getMatchDate(a) || "9999-12-31"} ${a.scheduledTime ?? ""} ${a.scheduledAt ?? ""}`;
  const bKey = `${getMatchDate(b) || "9999-12-31"} ${b.scheduledTime ?? ""} ${b.scheduledAt ?? ""}`;
  return aKey.localeCompare(bKey);
}

function formatMatchTime(match) {
  return match.scheduledAt ?? match.createdAt?.slice(0, 16)?.replace("T", " ") ?? "시간 미정";
}

function getWinner(match) {
  const scoreA = Number(match.teamA.score ?? match.result?.scoreA ?? 0);
  const scoreB = Number(match.teamB.score ?? match.result?.scoreB ?? 0);
  if (scoreA === scoreB) return "";
  return scoreA > scoreB ? match.teamA.name : match.teamB.name;
}

function getViewCount(matches, view) {
  return matches.filter((match) => view.statuses.includes(match.status)).length;
}

function matchHasUser(match, userId) {
  return match.teamA.players.includes(userId) || match.teamB.players.includes(userId);
}

function getTeamCaptainId(team) {
  return team?.members?.find((member) => member.role === "captain")?.userId ?? null;
}

function getTournamentTeamStatus(tournament, teamId) {
  return tournament.teamStatuses?.[teamId] ?? "invited";
}

function getTournamentMatches(tournament, matchesById, matches = []) {
  const fromIds = (tournament.matchIds ?? []).map((matchId) => matchesById[matchId]).filter(Boolean);
  const source = fromIds.length ? fromIds : matches.filter((match) => match.tournamentId === tournament.id);
  return [...source].sort((a, b) => (a.tournamentRound ?? 0) - (b.tournamentRound ?? 0) || (a.tournamentFixture ?? 0) - (b.tournamentFixture ?? 0));
}

function getTournamentTeamRows(tournament, teamById, userById, currentUserId) {
  return (tournament.teamIds ?? [])
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
  const [viewId, setViewId] = useState("todo");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [modeFilter, setModeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(getMonthKey());
  const [tournamentPanelOpen, setTournamentPanelOpen] = useState(false);
  const [selectedTournamentId, setSelectedTournamentId] = useState(null);
  const todayValue = toDateInputValue();
  const selectedView = VIEWS.find((view) => view.id === viewId) ?? VIEWS[0];
  const teamById = useMemo(() => Object.fromEntries(app.state.teams.map((team) => [team.id, team])), [app.state.teams]);
  const userById = useMemo(() => Object.fromEntries(app.state.users.map((user) => [user.id, user])), [app.state.users]);
  const matchesById = useMemo(() => Object.fromEntries(app.state.matches.map((match) => [match.id, match])), [app.state.matches]);
  const activeTournaments = useMemo(() => {
    return [...(app.state.tournaments ?? [])]
      .filter((tournament) => !["closed", "cancelled"].includes(tournament.status))
      .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")))
      .slice(0, 4);
  }, [app.state.tournaments]);
  const selectedTournament = useMemo(
    () => activeTournaments.find((tournament) => tournament.id === selectedTournamentId) ?? null,
    [activeTournaments, selectedTournamentId],
  );
  useBodyScrollLock(Boolean(selectedTournament));

  const baseFilteredMatches = useMemo(() => {
    return [...app.state.matches]
      .filter((match) => scopeFilter !== "mine" || matchHasUser(match, app.currentUser.id))
      .filter((match) => kindFilter === "all" || (kindFilter === "ranked" ? match.ranked !== false : match.ranked === false))
      .filter((match) => modeFilter === "all" || match.mode === modeFilter);
  }, [app.currentUser.id, app.state.matches, kindFilter, modeFilter, scopeFilter]);

  const filteredMatches = useMemo(() => {
    return baseFilteredMatches.filter((match) => !dateFilter || getMatchDate(match) === dateFilter);
  }, [baseFilteredMatches, dateFilter]);

  const calendarMatches = useMemo(() => {
    return baseFilteredMatches.filter((match) => ACTIVE_STATUSES.has(match.status) && getMatchDate(match));
  }, [baseFilteredMatches]);

  const calendarCounts = useMemo(() => {
    return calendarMatches.reduce((map, match) => {
      const date = getMatchDate(match);
      map.set(date, (map.get(date) ?? 0) + 1);
      return map;
    }, new Map());
  }, [calendarMatches]);

  const calendarDays = useMemo(() => getCalendarDays(calendarMonth), [calendarMonth]);
  const calendarMonthCount = calendarDays.reduce((sum, day) => sum + (calendarCounts.get(day) ?? 0), 0);

  const matchesByView = useMemo(() => {
    return filteredMatches
      .filter((match) => selectedView.statuses.includes(match.status))
      .sort(selectedView.id === "done" ? compareRecent : compareSchedule);
  }, [filteredMatches, selectedView.statuses]);

  const visibleMatches = matchesByView.slice(0, selectedView.id === "done" ? 80 : 60);
  const todoCount = getViewCount(filteredMatches, VIEWS[0]);
  const scheduledCount = getViewCount(filteredMatches, VIEWS[1]);
  const doneCount = getViewCount(filteredMatches, VIEWS[3]);
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
          <h1>경기 큐</h1>
          <p>지금 처리할 경기만 보고, 지난 기록은 필요할 때만 연다.</p>
        </div>
        <div className="om-match-panel">
          <div className="om-match-stats">
            <span><strong>{todoCount}</strong>ACTION</span>
            <span><strong>{scheduledCount}</strong>SOON</span>
            <span><strong>{doneCount}</strong>DONE</span>
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
              <b>{getViewCount(app.state.matches, view)}</b>
            </button>
          );
        })}
      </section>

      <section className="om-calendar-panel" aria-label="진행 경기 캘린더">
        <div className="om-calendar-summary">
          <span className="om-view-icon"><CalendarDays size={22} /></span>
          <div>
            <span className="om-kicker">SCHEDULE</span>
            <h2>진행 일정</h2>
            <p>{dateFilter ? `${formatDateLabel(dateFilter)} 경기만 표시` : "진행 중이거나 예정된 경기를 날짜별로 본다."}</p>
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
        </div>

        <div className="om-calendar-box">
          <div className="om-calendar-toolbar">
            <button type="button" aria-label="이전 달" onClick={() => setCalendarMonth((month) => addMonths(month, -1))}>
              <ChevronLeft size={18} />
            </button>
            <strong>{formatMonthLabel(calendarMonth)}</strong>
            <button type="button" aria-label="다음 달" onClick={() => setCalendarMonth((month) => addMonths(month, 1))}>
              <ChevronRight size={18} />
            </button>
            <span>{calendarMonthCount}경기</span>
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
                    setViewId("active");
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
                        <input type="date" name="scheduledDate" defaultValue={match.scheduledDate ?? ""} disabled={!canManageSchedule} aria-label="경기 날짜" />
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
          <button type="button" className={scopeFilter === "all" ? "active" : ""} onClick={() => setScopeFilter("all")}>전체 경기</button>
          <button type="button" className={scopeFilter === "mine" ? "active" : ""} onClick={() => setScopeFilter("mine")}>내 경기</button>
        </div>
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

      <section className="om-match-list" aria-label="경기 목록">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">{selectedView.code}</span>
            <h2>{dateFilter ? `${selectedView.title} · ${formatDateLabel(dateFilter)}` : selectedView.title}</h2>
          </div>
          <span>{filteredMatches.length}개 필터 · {matchesByView.length}개 중 {visibleMatches.length}개 표시</span>
        </div>

        {visibleMatches.length ? visibleMatches.map((match) => {
          const status = STATUS_META[match.status] ?? { label: match.status, tone: "blue" };
          const scoreA = match.teamA.score ?? match.result?.scoreA ?? 0;
          const scoreB = match.teamB.score ?? match.result?.scoreB ?? 0;
          const winner = getWinner(match);

          return (
            <article key={match.id} className={`om-match-card om-status-${match.status}`}>
              <div className="om-card-main">
                <div className="om-card-kicker">
                  <span className={`om-status-pill ${status.tone}`}>{status.label}</span>
                  <span>{match.mode}</span>
                  <span>{match.official ? "공식" : "일반"}</span>
                </div>
                <h3>{match.title}</h3>
                <p><CalendarDays size={15} />{formatMatchTime(match)} · {match.court}</p>
              </div>
              <div className="om-score-box">
                <TeamHoverCard team={teamById[match.teamA.teamId]} to={`/app/teams/${match.teamA.teamId}`}>{match.teamA.name}</TeamHoverCard>
                <strong>{scoreA} : {scoreB}</strong>
                <TeamHoverCard team={teamById[match.teamB.teamId]} to={`/app/teams/${match.teamB.teamId}`}>{match.teamB.name}</TeamHoverCard>
                {winner ? <span>{winner} 우세</span> : null}
              </div>
              <Link className="button button-secondary button-md om-room-link" to={`/app/matches/${match.id}`}>
                경기방
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
    </div>
  );
}
