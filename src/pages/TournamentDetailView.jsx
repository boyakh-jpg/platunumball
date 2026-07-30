import { Link } from "react-router-dom";
import { CalendarDays, ChevronLeft, Flag, Save, ShieldCheck, UserRound } from "lucide-react";
import Badge from "../components/common/Badge.jsx";
import Button from "../components/common/Button.jsx";
import SearchPicker from "../components/common/SearchPicker.jsx";
import TierBadge from "../components/rating/TierBadge.jsx";
import TeamEmblem from "../components/team/TeamEmblem.jsx";
import TeamHoverCard from "../components/team/TeamHoverCard.jsx";
import { getUserHashtag } from "../lib/handles.js";
import { TOURNAMENT_SANCTION_STATUS, getTournamentSanctionLabel, isTournamentRefereeAuthorized, isTournamentRefereeNeutral } from "../lib/tournamentGovernance.js";
import { MatchRoomModal } from "./Matches.jsx";
import {
  formatLabels,
  statusLabels,
  mmrPolicyLabels,
  formatWindow,
  isTournamentForfeitAvailable,
  isTournamentScheduleEditable,
  getTournamentSchedulePolicyLabel,
  getLeagueFixtureState,
} from "./tournamentDetailModel.jsx";

import { TournamentCompetitionSection } from "./TournamentCompetitionSection.jsx";
export default function TournamentDetailView({ controller }) {
  const { app, tournament, scheduleDialog, setScheduleDialog, savingScheduleId, forfeitDialog, setForfeitDialog, savingForfeitId, selectedMatchId, setSelectedMatchId, editingScheduleId, setEditingScheduleId, refereeQuery, setRefereeQuery, governanceAction, governanceFeedback, teamById, userById, matchesById, tournamentMatches, teamRows, acceptedCount, hasPendingTeamApprovals, governanceEnabled, requiredRefereeCount, acceptedRefereeIds, refereeRows, eligibleRefereeCandidates, canInviteReferee, canReviewRegion, canStartCommunity, verticalBracket, championTeam, canManageSchedule, todayValue, maxScheduleDate, leagueFixtures, leagueMatchesByFixture, leagueStandings, tournamentCourts, saveSchedule, confirmSchedule, confirmForfeit, runGovernanceAction, saveMatchReferee, renderRefereeInviteItem, organizer, dialogMatch, forfeitMatch, matchesReturnTo } = controller;
return (
    <div className="page-stack tournament-detail-page">
      <Button as={Link} variant="secondary" className="tournament-back-link" to={matchesReturnTo}><ChevronLeft size={17} /> 경기로</Button>

      <section className="tournament-hero">
        <div>
          <span className="om-kicker">PRIVATE EVENT</span>
          <h1>{tournament.title}</h1>
          <p className="tournament-hero-meta">
            <span><CalendarDays size={16} />{formatWindow(tournament)} · {tournament.court}</span>
            <span><UserRound size={16} />개최자 {organizer?.name ?? "알 수 없음"}{organizer ? ` ${getUserHashtag(organizer)}` : ""}</span>
          </p>
        </div>
        <div className="tournament-hero-badges" aria-label="대회 상태">
          <Badge tone="gold">{formatLabels[tournament.format] ?? "대회"}</Badge>
          <Badge tone={tournament.status === "active" ? "green" : "orange"}>
            {tournament.status === "draft" && governanceEnabled
              ? getTournamentSanctionLabel(tournament)
              : statusLabels[tournament.status] ?? "상태 확인 중"}
          </Badge>
          <Badge tone="blue">{tournament.mode}</Badge>
        </div>
      </section>

      <section className={`tournament-summary-grid${governanceEnabled ? " is-governed" : ""}`}>
        <div>
          <span>팀 승인</span>
          <strong>{acceptedCount}/{teamRows.length}</strong>
          <em>모든 팀장 승인 필수</em>
        </div>
        {governanceEnabled ? (
          <div>
            <span>심판 승인</span>
            <strong>{acceptedRefereeIds.length}/{requiredRefereeCount}</strong>
            <em>대진별 중립 심판 필수</em>
          </div>
        ) : null}
        <div>
          <span>생성 경기</span>
          <strong>{tournamentMatches.length}</strong>
          <em>
            {tournament.status === "draft"
              ? governanceEnabled ? "지역 승인 또는 비승인 개최 후 생성" : "승인 후 자동 생성"
              : "일정 입력 가능"}
          </em>
        </div>
        <div>
          <span>MMR</span>
          <strong>{mmrPolicyLabels[tournament.mmrPolicy] ?? "MMR 조건 확인"}</strong>
          <em>
            {tournament.sanctionStatus === TOURNAMENT_SANCTION_STATUS.community
              ? "지역 비승인 · 서버 정책 적용"
              : "서버 검증 후 반영"}
          </em>
        </div>
      </section>

      {hasPendingTeamApprovals ? (
        <section className="tournament-section">
          <div className="om-list-head">
            <div>
              <span className="om-kicker">INVITED TEAMS</span>
              <h2>참가팀</h2>
            </div>
            <span>{acceptedCount}팀 승인</span>
          </div>
          <div className="tournament-team-list">
            {teamRows.map((row) => (
              <article key={row.teamId} className={row.status === "accepted" ? "accepted" : ""}>
                <TeamEmblem team={row.team} size="md" />
                <div className="tournament-team-copy">
                  <TeamHoverCard team={row.team}>{row.team.name}</TeamHoverCard>
                  <span>{row.team.region} · {row.team.homeCourt} · 주장 {row.captainName}</span>
                </div>
                <div className="tournament-team-state">
                  <TierBadge mmr={row.team.mmr} compact />
                  {row.canApprove ? (
                    <button type="button" onClick={() => app.actions.approveTournamentTeam(tournament.id, row.teamId)}>
                      <ShieldCheck size={15} /> 승인
                    </button>
                  ) : (
                    <b>{row.status === "accepted" ? "승인 완료" : row.needsRepresentativeTeam ? "대표팀 설정 필요" : "승인 대기"}</b>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {governanceEnabled ? (
        <section className="tournament-section tournament-governance-section">
        <div className="om-list-head">
          <div>
            <span className="om-kicker">REFEREE APPROVAL</span>
            <h2>대회 심판</h2>
          </div>
          <span>최소 {requiredRefereeCount}명 · 승인 {acceptedRefereeIds.length}명</span>
        </div>
        <div className="tournament-referee-list">
          {refereeRows.map((row) => (
            <article key={row.refereeId} className={row.status === "accepted" ? "accepted" : ""}>
              <div>
                <strong>{row.referee?.name ?? row.refereeId}</strong>
                <span>{row.referee ? `${getUserHashtag(row.referee)} · 신뢰도 ${row.referee.trustScore}` : "심판 정보 확인 중"}</span>
              </div>
              {row.canApprove ? (
                <div className="tournament-referee-actions">
                  <button
                    type="button"
                    disabled={Boolean(governanceAction)}
                    onClick={() => runGovernanceAction(
                      `approve-referee:${row.refereeId}`,
                      () => app.actions.approveTournamentReferee(tournament.id),
                      "대회 심판 참여를 승인했습니다.",
                    )}
                  ><ShieldCheck size={15} /> 승인</button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={Boolean(governanceAction)}
                    onClick={() => runGovernanceAction(
                      `decline-referee:${row.refereeId}`,
                      () => app.actions.declineTournamentReferee(tournament.id),
                      "대회 심판 초대를 거절했습니다.",
                    )}
                  >거절</button>
                </div>
              ) : (
                <b>{row.status === "accepted" ? "승인 완료" : row.status === "declined" ? "거절" : "승인 대기"}</b>
              )}
            </article>
          ))}
        </div>
        {canInviteReferee ? (
          <div className="tournament-referee-invite">
            <SearchPicker
              value={refereeQuery}
              onChange={setRefereeQuery}
              placeholder="교체·추가 심판 검색"
              items={eligibleRefereeCandidates}
              remoteSearchType="referee"
              remoteSearchContext={{ refereeThroughDate: tournament.endDate }}
              title="초대 가능한 심판"
              emptyText="초대 가능한 심판 없음"
              floating
              closeOnResultClick
              renderItem={renderRefereeInviteItem}
            />
          </div>
        ) : null}
        <p className="tournament-governance-note">
          공식 대회와 지역 비승인 대회 모두 필수 심판 전원 승인과 모든 가능한 대진의 중립 심판 커버리지가 필요합니다.
        </p>
        </section>
      ) : null}

      {governanceEnabled && tournament.status === "draft" ? (
        <section className="tournament-section tournament-sanction-panel">
          <div>
            <span className="om-kicker">REGIONAL REVIEW</span>
            <h2>{getTournamentSanctionLabel(tournament)}</h2>
            <p>팀장·심판 승인이 완료된 뒤 지역관리자가 승인하면 공식 대회로, 주최자가 비승인 개최를 선택하면 MMR 0.8 계수 대회로 시작합니다.</p>
          </div>
          <div className="tournament-sanction-actions">
            {canReviewRegion ? (
              <>
                <Button
                  type="button"
                  disabled={Boolean(governanceAction)}
                  onClick={() => runGovernanceAction(
                    "region-approve",
                    () => app.actions.approveTournamentRegion(tournament.id),
                    "지역 승인 공식 대회로 시작했습니다.",
                  )}
                >지역 승인</Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={Boolean(governanceAction)}
                  onClick={() => runGovernanceAction(
                    "region-reject",
                    () => app.actions.rejectTournamentRegion(tournament.id),
                    "지역 비승인 처리했습니다.",
                  )}
                >비승인</Button>
              </>
            ) : null}
            {canStartCommunity ? (
              <Button
                type="button"
                variant="secondary"
                disabled={Boolean(governanceAction)}
                onClick={() => runGovernanceAction(
                  "community-start",
                  () => app.actions.startCommunityTournament(tournament.id),
                  "지역 비승인 대회로 시작했습니다.",
                )}
              >지역 비승인으로 개최</Button>
            ) : null}
          </div>
          {governanceFeedback ? <strong className="tournament-governance-feedback">{governanceFeedback}</strong> : null}
        </section>
      ) : governanceEnabled && governanceFeedback ? (
        <div className="tournament-governance-feedback">{governanceFeedback}</div>
      ) : null}

<TournamentCompetitionSection controller={controller} />

      {governanceEnabled && tournamentMatches.length ? (
        <section className="tournament-section">
          <div className="om-list-head">
            <div>
              <span className="om-kicker">MATCH REFEREES</span>
              <h2>경기별 중립 심판</h2>
            </div>
            <span>{canManageSchedule ? "주최자 배정" : "배정 현황"}</span>
          </div>
          <div className="tournament-match-referee-list">
            {tournamentMatches.map((match) => {
              const teamAId = match.teamA?.teamId ?? match.teamAId;
              const teamBId = match.teamB?.teamId ?? match.teamBId;
              const neutralRefereeIds = acceptedRefereeIds.filter((refereeId) => (
                isTournamentRefereeAuthorized(
                  tournament,
                  userById[refereeId],
                  app.state.settings?.refereeAppointments,
                )
                && isTournamentRefereeNeutral(tournament, refereeId, teamAId, teamBId, app.state.teams)
              ));
              return (
                <form key={`${match.id}:${match.refereeId ?? ""}`} onSubmit={(event) => saveMatchReferee(event, match)}>
                  <strong>{match.teamA?.name ?? "A"} vs {match.teamB?.name ?? "B"}</strong>
                  <select
                    name="refereeId"
                    defaultValue={match.refereeId ?? ""}
                    disabled={!canManageSchedule || Boolean(match.startedAt || match.endedAt)}
                    aria-label={`${match.teamA?.name ?? "A"} 대 ${match.teamB?.name ?? "B"} 심판`}
                  >
                    <option value="">심판 선택</option>
                    {neutralRefereeIds.map((refereeId) => (
                      <option key={refereeId} value={refereeId}>{userById[refereeId]?.name ?? refereeId}</option>
                    ))}
                  </select>
                  {canManageSchedule ? (
                    <button type="submit" disabled={Boolean(governanceAction || match.startedAt || match.endedAt || !neutralRefereeIds.length)}>
                      <ShieldCheck size={14} /> 배정
                    </button>
                  ) : (
                    <span>{userById[match.refereeId]?.name ?? "미배정"}</span>
                  )}
                </form>
              );
            })}
          </div>
        </section>
      ) : null}

      {tournament.format === "tournament" && tournamentMatches.length ? (
        <section className="tournament-section">
          <div className="om-list-head">
            <div>
              <span className="om-kicker">SCHEDULE</span>
              <h2>경기 일정</h2>
            </div>
            <span>{canManageSchedule ? "생성자 일정 입력" : "생성자만 수정 가능"}</span>
          </div>
          <div className="tournament-schedule-list">
            {tournamentMatches.map((match) => (
              <form
                key={match.id}
                className={canManageSchedule && isTournamentScheduleEditable(match) ? "" : "locked"}
                onSubmit={(event) => saveSchedule(event, match.id)}
                title={getTournamentSchedulePolicyLabel(match)}
              >
                <button type="button" className="tournament-match-open" onClick={() => setSelectedMatchId(match.id)}>
                  <TeamHoverCard team={teamById[match.teamA?.teamId]} as="span">{match.teamA?.name ?? "A"}</TeamHoverCard>
                  {" vs "}
                  <TeamHoverCard team={teamById[match.teamB?.teamId]} as="span">{match.teamB?.name ?? "B"}</TeamHoverCard>
                </button>
                <span>{getLeagueFixtureState(match, match.id).label}</span>
                <input type="date" name="scheduledDate" min={todayValue} max={maxScheduleDate} defaultValue={match.scheduledDate ?? ""} disabled={!canManageSchedule || !isTournamentScheduleEditable(match)} aria-label="경기 날짜" />
                <input type="time" name="scheduledTime" defaultValue={match.scheduledTime ?? ""} disabled={!canManageSchedule || !isTournamentScheduleEditable(match)} aria-label="경기 시간" />
                <select name="courtId" defaultValue={match.courtId ?? tournament.courtId ?? tournamentCourts[0]?.id} disabled={!canManageSchedule || !isTournamentScheduleEditable(match)} aria-label="경기 구장">
                  {tournamentCourts.map((court) => <option key={court.id} value={court.id}>{court.name}</option>)}
                </select>
                <button type="submit" disabled={!canManageSchedule || !isTournamentScheduleEditable(match) || savingScheduleId === match.id}><Save size={14} /> {savingScheduleId === match.id ? "저장 중" : isTournamentScheduleEditable(match) ? "저장" : getTournamentSchedulePolicyLabel(match)}</button>
                {canManageSchedule ? (
                  <button
                    type="button"
                    className="tournament-forfeit-button"
                    disabled={!isTournamentForfeitAvailable(match)}
                    title={isTournamentForfeitAvailable(match) ? "팀 불참 처리" : "경기 시작 시각 이후 사용 가능"}
                    onClick={() => setForfeitDialog({ mode: "choose", matchId: match.id })}
                  ><Flag size={14} /> 몰수</button>
                ) : null}
              </form>
            ))}
          </div>
        </section>
      ) : null}

      {scheduleDialog ? (
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !savingScheduleId && setScheduleDialog(null)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="대회 경기 일정 저장" onMouseDown={(event) => event.stopPropagation()}>
            <strong>{scheduleDialog.mode === "confirm" ? "경기 일정을 저장할까요?" : scheduleDialog.mode === "success" ? "일정을 저장했습니다." : scheduleDialog.mode === "notice" ? "일정 정보를 확인해 주세요." : "일정을 저장하지 못했습니다."}</strong>
            <p>
              {scheduleDialog.mode === "confirm"
                ? `${dialogMatch?.teamA?.name ?? "A"} vs ${dialogMatch?.teamB?.name ?? "B"} · ${scheduleDialog.scheduledDate} ${scheduleDialog.scheduledTime} · ${scheduleDialog.courtName}`
                : scheduleDialog.mode === "success"
                  ? "양 팀장에게 출전·후보 명단 구성 알림을 보냈습니다."
                  : scheduleDialog.mode === "notice"
                    ? scheduleDialog.message
                  : scheduleDialog.message}
            </p>
            <div className="app-confirm-actions">
              {scheduleDialog.mode === "confirm" ? (
                <>
                  <Button type="button" variant="secondary" disabled={Boolean(savingScheduleId)} onClick={() => setScheduleDialog(null)}>취소</Button>
                  <Button type="button" disabled={Boolean(savingScheduleId)} onClick={confirmSchedule}>{savingScheduleId ? "저장 중" : "저장"}</Button>
                </>
              ) : (
                <Button type="button" onClick={() => setScheduleDialog(null)}>확인</Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {forfeitDialog ? (
        <div className="app-confirm-backdrop" role="presentation" onMouseDown={() => !savingForfeitId && setForfeitDialog(null)}>
          <div className="app-confirm-dialog" role="dialog" aria-modal="true" aria-label="대회 경기 몰수 처리" onMouseDown={(event) => event.stopPropagation()}>
            <strong>
              {forfeitDialog.mode === "choose"
                ? "불참 팀을 선택해 주세요."
                : forfeitDialog.mode === "confirm"
                  ? "1:0 몰수패로 확정할까요?"
                  : forfeitDialog.mode === "success"
                    ? "몰수패를 확정했습니다."
                    : "몰수패를 확정하지 못했습니다."}
            </strong>
            <p>
              {forfeitDialog.mode === "choose"
                ? `${forfeitMatch?.teamA?.name ?? "A팀"} vs ${forfeitMatch?.teamB?.name ?? "B팀"}`
                : forfeitDialog.mode === "confirm"
                  ? `${forfeitDialog.losingSide === "teamA" ? forfeitMatch?.teamA?.name ?? "A팀" : forfeitMatch?.teamB?.name ?? "B팀"} 불참 · 상대 팀 1:0 몰수승 · MMR 미반영`
                  : forfeitDialog.mode === "success"
                    ? "리그 승패 또는 다음 토너먼트 라운드에 반영했습니다."
                    : forfeitDialog.message}
            </p>
            <div className="app-confirm-actions tournament-forfeit-actions">
              {forfeitDialog.mode === "choose" ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => setForfeitDialog(null)}>취소</Button>
                  <Button type="button" variant="secondary" onClick={() => setForfeitDialog((current) => ({ ...current, mode: "confirm", losingSide: "teamA" }))}>{forfeitMatch?.teamA?.name ?? "A팀"} 불참</Button>
                  <Button type="button" variant="secondary" onClick={() => setForfeitDialog((current) => ({ ...current, mode: "confirm", losingSide: "teamB" }))}>{forfeitMatch?.teamB?.name ?? "B팀"} 불참</Button>
                </>
              ) : forfeitDialog.mode === "confirm" ? (
                <>
                  <Button type="button" variant="secondary" disabled={Boolean(savingForfeitId)} onClick={() => setForfeitDialog((current) => ({ ...current, mode: "choose", losingSide: "" }))}>이전</Button>
                  <Button type="button" disabled={Boolean(savingForfeitId)} onClick={confirmForfeit}>{savingForfeitId ? "처리 중" : "몰수 확정"}</Button>
                </>
              ) : (
                <Button type="button" onClick={() => setForfeitDialog(null)}>확인</Button>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <MatchRoomModal app={app} matchId={selectedMatchId} entryPoint="tournament" onClose={() => setSelectedMatchId("")} />
    </div>
  );
}
