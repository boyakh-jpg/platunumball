import { Link } from "react-router-dom";
import { CalendarDays, ClipboardCheck, ChevronLeft, ChevronRight, PlusCircle, Trophy, UserRound, UsersRound } from "lucide-react";
import Button from "../components/common/Button.jsx";
import EmptyState from "../components/common/EmptyState.jsx";
import CourtHoverCard from "../components/court/CourtHoverCard.jsx";
import MatchListCard, { MatchListSummary } from "../components/match/MatchListCard.jsx";
import PlayerHoverCard from "../components/profile/PlayerHoverCard.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { getUserHashtag } from "../lib/handles.js";
import { getMatchListRoomTypeLabel, getScheduleMatchRosterProjection } from "../lib/matchListProjection.js";
import { getTournamentMatches } from "../lib/tournamentMatches.js";
import { getRoomCompetitionLabel, getRoomRefereeLabel, getRoomVisibilityLabel, MATCH_LIST_STATUSES } from "../lib/matchUtils.js";
import { getRecruitingEntryForUser, getRecruitingListCardCounts, getRecruitingListCardLobby, getRecruitingRoomOwnerId, isPaidRecruitingCourt } from "../lib/recruiting.js";
import { RecruitingRoomModal, getRecruitingRoomListStatus } from "./Recruiting.jsx";
import {
  VIEWS,
  SCHEDULE_BRANCH_FILTERS,
  WEEKDAYS,
  tournamentFormatLabels,
  tournamentMmrLabels,
  tournamentStatusLabels,
  getSafeMatchSide,
  getMonthKey,
  addMonths,
  formatMonthLabel,
  formatDateLabel,
  formatTournamentWindow,
  formatMatchTime,
  getMatchProcessMeta,
  shouldShowScoreBox,
  formatMatchRules,
  getRoomCardTitle,
  getWinner,
  getMatchActionLabel,
  getTournamentTeamRows,
} from "./matchesPageSelectors.js";
import {
  RoomModalErrorBoundary,
  RoomModalErrorView,
  RoomModalLoadingView,
  AttendanceScanResultView,
} from "./MatchesPagePanels.jsx";

export default function MatchesPageView({ controller }) {
  const { app, location, viewId, panelMode, branchFilter, relationFilter, dateFilter, calendarMonth, selectedRecruitingPostId, setSelectedRecruitingPostId, setSelectedRecruitingPostDetailLoadingId, setSelectedRecruitingPostDetailFailedId, attendanceScanState, attendanceQrFlow, activeSelectedMatchId, todayValue, selectedView, teamById, userById, matchesById, courtById, courtByName, activeTournaments, selectedRecruitingPost, selectedRecruitingLobby, selectedRecruitingPostDetailFailed, selectedRecruitingPostDetailLoading, selectedMatch, selectedMatchRoomPost, selectedMatchRoomError, selectedMatchDetailLoading, selectedMatchDetailFailed, applyFilterState, closeSelectedMatch, requestMatchDetail, openSelectedRecruitingPost, openSelectedMatch, matchPagination, teamMatchList, calendarCounts, calendarDays, calendarMonthCount, scheduleLoading, scheduleError, displayScheduleItems, scheduleCountLabel, displayActiveCount, displayTodoCount, displayScheduledCount, getDisplayViewButtonCount, teamScheduleCount } = controller;
return (
    <div className="page-stack om-match-page">
      <section className="om-match-hero ui-page-hero ui-design-app-hero">
        <div className="om-match-copy ui-page-hero__copy">
          <span className="eyebrow">MATCH QUEUE</span>
          <h1>일정</h1>
        </div>
        <div className="om-match-panel ui-liquid-glass">
          <div className="om-match-stats ui-liquid-glass-segments">
            <span><strong>{displayActiveCount}</strong>MY</span>
            <span><strong>{displayTodoCount}</strong>ACTION</span>
            <span><strong>{displayScheduledCount}</strong>SOON</span>
          </div>
          <div className="om-match-actions">
            <Button as={Link} to="/app/create"><PlusCircle size={18} /> 방 만들기</Button>
            <Button as={Link} to="/app/create?intent=record" variant="secondary"><ClipboardCheck size={18} /> 기록하기</Button>
          </div>
        </div>
      </section>

      <div className="om-schedule-workspace">
        <aside className="om-schedule-rail">
          <section className="om-view-grid" aria-label="경기 상태">
            {VIEWS.map((view) => {
          const Icon = view.icon;
          const active = panelMode === "schedule" && view.id === viewId;
          return (
            <button
              key={view.id}
              type="button"
              className={active ? "om-view-card ui-design-filter-tile active" : "om-view-card ui-design-filter-tile"}
              onClick={() => {
                applyFilterState({
                  panelMode: "schedule",
                  relationFilter: relationFilter === "team" ? "all" : relationFilter,
                  viewId: view.id,
                });
              }}
            >
              <span className="om-view-icon"><Icon size={22} /></span>
              <span>
                <small>{view.code}</small>
                <strong>{view.title}</strong>
                <em>{view.desc}</em>
              </span>
              <b>{getDisplayViewButtonCount(view)}</b>
            </button>
          );
            })}
            <button
          type="button"
          className={panelMode === "team" ? "om-view-card ui-design-filter-tile active" : "om-view-card ui-design-filter-tile"}
          onClick={() => {
            applyFilterState({
              panelMode: "team",
              viewId: "active",
              branchFilter: "all",
              relationFilter: "all",
              dateFilter: "",
              calendarMonth: getMonthKey(),
            });
          }}
        >
          <span className="om-view-icon"><UsersRound size={22} /></span>
          <span>
            <small>TEAM</small>
            <strong>내 팀 경기</strong>
            <em>진행·예정</em>
          </span>
          <b>{teamMatchList.status === MATCH_LIST_STATUSES.LOADING ? "..." : teamScheduleCount}</b>
            </button>
            <button
          type="button"
          className={panelMode === "tournament" ? "om-view-card ui-design-filter-tile active" : "om-view-card ui-design-filter-tile"}
          onClick={() => applyFilterState({ panelMode: "tournament" })}
        >
          <span className="om-view-icon"><Trophy size={22} /></span>
          <span>
            <small>EVENT</small>
            <strong>비공개 대회</strong>
            <em>내 대회·초대</em>
          </span>
          <b>{activeTournaments.length}</b>
            </button>
          </section>

          {panelMode !== "tournament" ? (
            <div className="om-calendar-summary">
          <div className="om-calendar-heading">
            <span className="om-view-icon"><CalendarDays size={22} /></span>
            <div>
              <span className="eyebrow">SCHEDULE</span>
              <h2>{panelMode === "team" ? "내 팀 일정" : "내 경기 일정"}</h2>
            </div>
          </div>
          <section className="om-calendar-filter-bar" aria-label="경기 필터">
            {panelMode !== "team" ? <div className="om-calendar-filter-row">
              <span className="om-calendar-filter-label">관계</span>
              <div className="ui-segmented-control segmented-control compact-segments om-relation-filter-grid ui-design-filter-tile" role="group" aria-label="관계 필터">
                <button type="button" className={relationFilter === "all" ? "active" : ""} onClick={() => applyFilterState({ relationFilter: "all" })}>전체</button>
                <button type="button" className={relationFilter === "created" ? "active" : ""} onClick={() => applyFilterState({ relationFilter: "created" })}>내가 만든 방</button>
                <button type="button" className={relationFilter === "joined" ? "active" : ""} onClick={() => applyFilterState({ relationFilter: "joined" })}>내 참여방</button>
                <button type="button" className={relationFilter === "invited" ? "active" : ""} onClick={() => applyFilterState({ relationFilter: "invited" })}>초대받은 방</button>
              </div>
            </div> : null}
            {panelMode !== "team" ? <div className="om-calendar-filter-row">
              <span className="om-calendar-filter-label">유형</span>
              <div className="ui-segmented-control segmented-control compact-segments om-branch-filter-grid ui-design-filter-tile" role="group" aria-label="유형 필터">
                {SCHEDULE_BRANCH_FILTERS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={branchFilter === option.id ? "active" : ""}
                    onClick={() => applyFilterState({ branchFilter: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div> : null}
          </section>
            </div>
          ) : null}
        </aside>

        {panelMode !== "tournament" ? (
          <section className="om-calendar-panel" aria-label="경기 일정 캘린더">
        <div className="om-calendar-box">
          <div className="om-calendar-toolbar">
            <button type="button" aria-label="이전 달" onClick={() => applyFilterState({ calendarMonth: addMonths(calendarMonth, -1) })}>
              <ChevronLeft size={18} />
            </button>
            <strong>
              {formatMonthLabel(calendarMonth)}
              <span>{scheduleLoading ? "확인 중" : `${calendarMonthCount}경기`}</span>
            </strong>
            <button type="button" aria-label="다음 달" onClick={() => applyFilterState({ calendarMonth: addMonths(calendarMonth, 1) })}>
              <ChevronRight size={18} />
            </button>
          </div>
          <div className="om-calendar-weekdays">
            {WEEKDAYS.map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="om-calendar-grid">
            {calendarDays.map((day, index) => {
              const count = scheduleLoading ? 0 : calendarCounts.get(day) ?? 0;
              const selected = day && day === dateFilter;
              const isToday = day && day === todayValue;
              return day ? (
                <button
                  key={day}
                  type="button"
                  className={`${selected ? "active" : ""} ${isToday ? "today" : ""}`}
                  onClick={() => applyFilterState({
                    dateFilter: dateFilter === day ? "" : day,
                    calendarMonth: getMonthKey(day),
                  })}
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
        ) : null}

        {panelMode === "tournament" ? <section className="om-tournament-panel" aria-label="비공개 대회">
        <div className="section-title-row om-list-head">
          <div>
            <span className="eyebrow">PRIVATE EVENT</span>
            <h2>비공개 대회</h2>
          </div>
          <div className="om-tournament-head-actions">
            <span>{activeTournaments.length}개</span>
          </div>
        </div>
        <div id="private-tournament-list" className="om-tournament-grid">
          {activeTournaments.length ? activeTournaments.map((tournament) => {
            const tournamentMatches = getTournamentMatches(tournament, matchesById, app.state.matches);
            const teamRows = getTournamentTeamRows(tournament, teamById, userById, app.currentUser.id);
            const organizer = userById[tournament.createdBy] ?? null;
            const acceptedCount = teamRows.filter((row) => row.status === "accepted").length;
            const pendingRows = teamRows.filter((row) => row.status !== "accepted");
            return (
              <article key={tournament.id} className="om-tournament-card">
                <div className="om-tournament-copy">
                  <span className="eyebrow">{tournamentFormatLabels[tournament.format] ?? "대회"}</span>
                  <h3>{tournament.title}</h3>
                  <p>
                    <span>
                      <CalendarDays size={15} />
                      {formatTournamentWindow(tournament)} · <CourtHoverCard court={courtByName[tournament.court]} courtName={tournament.court}>{tournament.court}</CourtHoverCard>
                    </span>
                    <span>
                      <UserRound size={15} />
                      개최자&nbsp;
                      {organizer ? (
                        <PlayerHoverCard as="span" user={organizer} teams={app.state.teams}>
                          {organizer.name} {getUserHashtag(organizer)}
                        </PlayerHoverCard>
                      ) : "알 수 없음"}
                    </span>
                  </p>
                </div>
                <div className="om-tournament-meta">
                  <span>{tournament.mode}</span>
                  <span>{tournament.ranked === false ? "친선" : "정규"}</span>
                  <span>{tournamentMmrLabels[tournament.mmrPolicy] ?? "MMR 조건 확인"}</span>
                  <strong>{acceptedCount}/{teamRows.length} 승인</strong>
                  <strong>{tournamentMatches.length}경기</strong>
                </div>
                <div className="om-tournament-state">
                  <span>{tournamentStatusLabels[tournament.status] ?? "상태 확인 중"}</span>
                  <em>{pendingRows.length ? `${pendingRows.length}팀 승인 대기` : "참가 승인 완료"}</em>
                </div>
                <div className="om-tournament-actions">
                  <Button
                    as={Link}
                    className="om-tournament-detail-link"
                    to={`/app/tournaments/${tournament.id}`}
                    state={{ from: `${location.pathname}${location.search}` }}
                  >
                    {tournament.format === "tournament" ? "대진표" : "리그표"}
                  </Button>
                </div>
              </article>
            );
          }) : (
            <EmptyState
              title="관련 대회 없음"
              description="내가 만든 대회와 내 팀이 초대된 대회가 여기에 표시됩니다."
            />
          )}
        </div>
        </section> : null}
      </div>

      {attendanceQrFlow ? (
        <AttendanceScanResultView state={attendanceScanState} onClose={closeSelectedMatch} />
      ) : null}

      {!attendanceQrFlow && selectedMatchDetailFailed ? (
        <RoomModalErrorView
          error={new Error("경기를 찾을 수 없거나 열람 권한이 없습니다.")}
          onClose={closeSelectedMatch}
          onRetry={() => requestMatchDetail(activeSelectedMatchId)}
        />
      ) : null}

      {!attendanceQrFlow && !selectedMatchDetailLoading && !selectedMatchDetailFailed && selectedMatch && selectedMatchRoomError ? (
        <RoomModalErrorView error={selectedMatchRoomError} onClose={closeSelectedMatch} />
      ) : null}

      {!attendanceQrFlow && selectedMatchDetailLoading && !selectedMatchDetailFailed ? (
        <RoomModalLoadingView onClose={closeSelectedMatch} />
      ) : !attendanceQrFlow && !selectedMatchDetailFailed && selectedMatch && selectedMatchRoomPost ? (
        <RoomModalErrorBoundary key={selectedMatch.id} onClose={closeSelectedMatch}>
          <RecruitingRoomModal
            app={app}
            post={selectedMatchRoomPost}
            sourceMatch={selectedMatch}
            attendanceScanState={attendanceScanState}
            skipInitialDetailLoad
            onClose={closeSelectedMatch}
          />
        </RoomModalErrorBoundary>
      ) : null}

      {selectedRecruitingPostDetailFailed ? (
        <RoomModalErrorView
          error={new Error("방이 닫혔거나 권한이 없거나 잠시 응답이 비었습니다.")}
          onClose={() => {
            setSelectedRecruitingPostId(null);
            setSelectedRecruitingPostDetailLoadingId(null);
            setSelectedRecruitingPostDetailFailedId(null);
          }}
          onRetry={() => {
            setSelectedRecruitingPostDetailFailedId(null);
            setSelectedRecruitingPostDetailLoadingId(selectedRecruitingPostId);
            Promise.resolve(app.actions.loadRecruitingPost?.(selectedRecruitingPostId)).then((count) => {
              if (!count) setSelectedRecruitingPostDetailFailedId(selectedRecruitingPostId);
            }).finally(() => {
              setSelectedRecruitingPostDetailLoadingId((currentId) => currentId === selectedRecruitingPostId ? null : currentId);
            });
          }}
        />
      ) : selectedRecruitingPostDetailLoading ? (
        <RoomModalLoadingView onClose={() => {
          setSelectedRecruitingPostId(null);
          setSelectedRecruitingPostDetailLoadingId(null);
          setSelectedRecruitingPostDetailFailedId(null);
        }} />
      ) : selectedRecruitingPost && selectedRecruitingLobby ? (
        <RecruitingRoomModal
          app={app}
          post={selectedRecruitingPost}
          skipInitialDetailLoad
          onClose={() => {
            setSelectedRecruitingPostId(null);
            setSelectedRecruitingPostDetailLoadingId(null);
            setSelectedRecruitingPostDetailFailedId(null);
          }}
          onOpenMatch={openSelectedMatch}
        />
      ) : null}

      {panelMode !== "tournament" ? <section className="om-match-list" aria-label="경기 목록">
        <div className="section-title-row om-list-head">
          <div>
            <span className="eyebrow">{selectedView.code}</span>
            <h2>{panelMode === "team" ? "내 팀 경기" : dateFilter ? `${selectedView.title} · ${formatDateLabel(dateFilter)}` : selectedView.title}</h2>
          </div>
          <span>{scheduleCountLabel}</span>
        </div>

        {scheduleError && !displayScheduleItems.length ? (
          <EmptyState
            tone="error"
            title={panelMode === "team" ? "내 팀 경기 조회 실패" : "내 일정 조회 실패"}
            description="경기 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."
            action={(
              <Button
                variant="secondary"
                size="sm"
                onClick={() => (
                  panelMode === "team"
                    ? app.actions.loadMatchTeamSchedule?.({ force: true })
                    : app.actions.loadMatchRecruitingSchedule?.({ force: true })
                )}
              >
                다시 시도
              </Button>
            )}
          />
        ) : displayScheduleItems.length ? (
          <>
        {displayScheduleItems.map(({ type, item }) => {
          if (type === "room") {
            const post = item;
            const lobby = getRecruitingListCardLobby(post, app.state);
            const myEntry = getRecruitingEntryForUser(lobby, app.currentUser.id);
            const mine = getRecruitingRoomOwnerId(post) === app.currentUser.id;
            const needConfirm = !mine && post.visibility !== "public" && myEntry && myEntry.status !== "ready";
            const roomStatus = getRecruitingRoomListStatus(lobby, { post, myEntry, mine });
            const counts = getRecruitingListCardCounts(post, lobby);
            const roomTitle = getRoomCardTitle(post);
            const postCourt = courtById[post.courtId] ?? courtByName[post.court] ?? null;
            return (
              <MatchListCard
                key={`room-${post.id}`}
                status={roomStatus}
                mode={post.mode}
                visibility={getRoomVisibilityLabel(post)}
                roomType={getMatchListRoomTypeLabel(post, lobby)}
                competition={getRoomCompetitionLabel(post)}
                referee={getRoomRefereeLabel(post)}
                extraBadges={isPaidRecruitingCourt(post, postCourt) ? [{ kind: "cost", tone: "orange", label: "유료 구장" }] : []}
                title={roomTitle}
                meta={(
                  <>
                    <CalendarDays size={15} />
                    {formatMatchTime(post)} · <CourtHoverCard court={postCourt} courtName={post.court}>{post.court}</CourtHoverCard>
                  </>
                )}
                summary={(
                  <MatchListSummary
                    left={counts.layout === "sides" ? `A ${counts.teamA.filled}/${counts.teamA.capacity}` : null}
                    center={counts.layout === "unified" ? `참가 ${counts.filled}/${counts.capacity}` : `${counts.filled}/${counts.capacity}`}
                    right={counts.layout === "sides" ? `B ${counts.teamB.filled}/${counts.teamB.capacity}` : null}
                    detail={formatMatchRules(post)}
                    variant={counts.layout === "unified" ? "participant" : "count"}
                  />
                )}
                actionLabel={needConfirm ? "확인하기" : roomStatus.actionLabel}
                onAction={() => openSelectedRecruitingPost(post.id)}
              />
            );
          }
          const match = item;
          const status = getMatchProcessMeta(match);
          const showScoreBox = shouldShowScoreBox(match);
          const scoreA = getSafeMatchSide(match, "teamA").score ?? match.result?.scoreA ?? 0;
          const scoreB = getSafeMatchSide(match, "teamB").score ?? match.result?.scoreB ?? 0;
          const winner = getWinner(match);
          const sourcePost = match.recruitingPostId ? app.state.recruitingPosts.find((post) => post.id === match.recruitingPostId) : null;
          const visibilityLabel = getRoomVisibilityLabel(match, sourcePost);
          const matchTitle = getRoomCardTitle(match);
          const roster = getScheduleMatchRosterProjection(match);

          return (
            <MatchListCard
              key={`match-${match.id}`}
              status={status}
              mode={match.mode}
              visibility={visibilityLabel}
              roomType={getMatchListRoomTypeLabel(match)}
              competition={getRoomCompetitionLabel(match)}
              referee={getRoomRefereeLabel(match)}
              title={matchTitle}
              meta={(
                <>
                  <CalendarDays size={15} />
                  {formatMatchTime(match)} · <CourtHoverCard court={courtByName[match.court]} courtName={match.court}>{match.court}</CourtHoverCard>
                </>
              )}
              summary={(
                <MatchListSummary
                  left={<TeamHoverCard team={teamById[match.teamA?.teamId]} as="span">{match.teamA?.name ?? "A"}</TeamHoverCard>}
                  center={showScoreBox ? `${scoreA} : ${scoreB}` : "vs"}
                  right={<TeamHoverCard team={teamById[match.teamB?.teamId]} as="span">{match.teamB?.name ?? "B"}</TeamHoverCard>}
                  meta={showScoreBox ? null : `참여 ${roster.participantCount}명 · A ${roster.teamACount} / B ${roster.teamBCount}`}
                  detail={showScoreBox && winner ? `${winner} 우세` : formatMatchRules(match)}
                  variant={showScoreBox ? "score" : "matchup"}
                />
              )}
              actionLabel={getMatchActionLabel(match)}
              onAction={() => openSelectedMatch(match.id)}
            />
          );
        })}
        {scheduleError || matchPagination.error ? (
          <div className="om-load-more">
            <span>최신 경기 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                if (scheduleError) {
                  if (panelMode === "team") app.actions.loadMatchTeamSchedule?.({ force: true });
                  else app.actions.loadMatchRecruitingSchedule?.({ force: true });
                }
                if (matchPagination.error) app.actions.loadMoreMatches?.({ force: true });
              }}
            >
              다시 시도
            </Button>
          </div>
        ) : null}
          </>
        ) : scheduleLoading ? null : (
          <EmptyState
            title="해당 일정 없음"
            description="다른 상태를 선택하거나 새 경기를 만들어 보세요."
          />
        )}
      </section> : null}
    </div>
  );
}
